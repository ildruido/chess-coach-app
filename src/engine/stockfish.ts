// Runs Stockfish 19 (lite, single-threaded WASM) in a Web Worker started from the engine file
// the site serves (the page's CSP has no blob: workers); the script finds its .wasm next to it.
//
// Failure rule: any worker error or timeout tears the worker down and rejects
// everything waiting on it. The next call starts a fresh engine, so a stuck or
// crashed search can never leak its answer into a later one.
//
// Stockfish is GPL-3.0 (https://github.com/nmrugg/stockfish.js).

import {
  type Analysis,
  type Position,
  type SearchInfo,
  isBestMoveLine,
  parseBestMove,
  parseInfo,
  positionCommand,
  sideAfter,
} from "./uci";

export interface SearchLimits {
  /** Think for this many milliseconds. */
  movetime?: number;
  /** Or search to this depth. */
  depth?: number;
  /** Report this many candidate lines (default 1). */
  multiPv?: number;
  /**
   * Forget earlier searches first. Playing levels need this: a shallow search
   * right after a deep one (a hint, an analysis) would otherwise reuse the
   * deep results and play far stronger than its level.
   */
  clearHash?: boolean;
  /**
   * Low priority (running commentary): skipped if another search is waiting
   * when its turn comes, and stopped when one arrives, so play and hints
   * never wait for it. A skipped or stopped search rejects with
   * EngineBusyError: a search cut short is too shallow to judge a move by.
   */
  background?: boolean;
}

/** A background search gave way to a normal one. */
export class EngineBusyError extends Error {
  constructor() {
    super("The engine was needed for something else.");
    this.name = "EngineBusyError";
  }
}

export interface EngineOptions {
  /** Builds the worker script; tests swap in a fake. Setting it always uses a blob worker. */
  source?: () => string;
  /** Max time for the engine to answer `uci`/`isready`: at load and before each search. */
  readyTimeoutMs?: number;
  /** Time allowed on top of `movetime` (or this alone for depth searches). */
  searchTimeoutMs?: number;
}

interface Waiter {
  match: (line: string) => boolean;
  resolve: (line: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class StockfishEngine {
  /** Engine name as it reports itself, e.g. "Stockfish 19 Lite". */
  name = "";
  /** How long the last successful load took, in ms. */
  loadMs = 0;

  private worker: Worker | null = null;
  private loading: Promise<void> | null = null;
  private waiters = new Set<Waiter>();
  private infoListener: ((line: string) => void) | null = null;
  /** The engine's current MultiPV setting; a fresh worker starts at 1. */
  private multiPv = 1;
  private queue: Promise<unknown> = Promise.resolve();
  /** Normal searches queued or running: a background search gives way to them. */
  private waitingNormal = 0;
  private runningBackground = false;
  /** The running background search was told to stop: its result doesn't count. */
  private preempted = false;
  private readonly source: (() => string) | null;
  private readonly readyTimeoutMs: number;
  private readonly searchTimeoutMs: number;

  constructor(options: EngineOptions = {}) {
    this.source = options.source ?? null;
    this.readyTimeoutMs = options.readyTimeoutMs ?? 20_000;
    this.searchTimeoutMs = options.searchTimeoutMs ?? 30_000;
  }

  /** Loads the engine once. Safe to call repeatedly; retries after a failure. */
  start(): Promise<void> {
    this.loading ??= this.load();
    return this.loading;
  }

  /** Best move and evaluation for a position. Searches run one at a time. */
  analyse(position: Position, limits: SearchLimits = { movetime: 1000 }): Promise<Analysis> {
    if (!limits.background) {
      this.waitingNormal++;
      // A running background search stops now; its result is dropped.
      if (this.runningBackground) {
        this.preempted = true;
        this.send("stop");
      }
    }
    const run = this.queue.then(() => {
      if (!limits.background) this.waitingNormal--;
      return this.search(position, limits);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Shuts the engine down. Anything waiting on it rejects. */
  stop() {
    this.fail(new Error("The engine was stopped."));
  }

  private async load(): Promise<void> {
    const t0 = performance.now();
    // Tests inject a blob source; the site serves the engine as a file.
    const url = this.source
      ? URL.createObjectURL(new Blob([this.source()], { type: "text/javascript" }))
      : new URL("engine/stockfish-19-lite-single.js", document.baseURI).href;
    const worker = new Worker(url);
    this.worker = worker;
    try {
      worker.onmessage = (e: MessageEvent) => {
        if (this.worker === worker) this.emit(String(e.data));
      };
      worker.onerror = (e) => {
        e.preventDefault();
        if (this.worker === worker) {
          this.fail(new Error(e.message || "The engine could not start in this page."));
        }
      };
      const nameLine = this.waitFor((l) => l.startsWith("id name "), this.readyTimeoutMs);
      const uciok = this.waitFor((l) => l === "uciok", this.readyTimeoutMs);
      this.send("uci");
      this.name = (await nameLine).slice("id name ".length);
      await uciok;
      await this.handshake();
      this.loadMs = performance.now() - t0;
    } catch (err) {
      // Only tear down our own worker: stop() + start() may already have made a new one.
      if (this.worker === worker) this.fail(err as Error);
      throw err;
    } finally {
      if (this.source) URL.revokeObjectURL(url);
    }
  }

  private async search(position: Position, limits: SearchLimits): Promise<Analysis> {
    await this.start();
    // The engine must be idle before a new search starts.
    await this.handshake();
    const multiPv = limits.multiPv ?? 1;
    if (multiPv !== this.multiPv) {
      this.send(`setoption name MultiPV value ${multiPv}`);
      this.multiPv = multiPv;
    }
    if (limits.clearHash) this.send("setoption name Clear Hash");
    const side = sideAfter(position);
    // Latest report for each candidate line; line 1 is the best.
    const lines = new Map<number, SearchInfo>();
    this.infoListener = (line) => {
      const info = parseInfo(line, side);
      if (!info) return;
      // A score-only line must not wipe the best line already reported.
      const prev = lines.get(info.multipv);
      lines.set(info.multipv, info.pv.length || !prev ? info : { ...info, pv: prev.pv });
    };
    const t0 = performance.now();
    try {
      const timeout = (limits.movetime ?? 0) + this.searchTimeoutMs;
      if (limits.background && this.waitingNormal > 0) throw new EngineBusyError();
      const bestLine = this.waitFor(isBestMoveLine, timeout);
      this.send(positionCommand(position));
      this.send(
        limits.depth ? `go depth ${limits.depth}` : `go movetime ${limits.movetime ?? 1000}`,
      );
      this.runningBackground = !!limits.background;
      this.preempted = false;
      const bestMove = parseBestMove(await bestLine);
      if (limits.background && this.preempted) throw new EngineBusyError();
      const info = lines.get(1);
      return {
        bestMove,
        depth: info?.depth ?? 0,
        score: info?.score,
        pv: info?.pv.length ? info.pv : bestMove ? [bestMove] : [],
        ms: performance.now() - t0,
        ...(multiPv > 1 && {
          lines: [...lines.values()]
            .filter((l) => l.pv.length)
            .sort((a, b) => a.multipv - b.multipv),
        }),
      };
    } finally {
      this.infoListener = null;
      this.runningBackground = false;
    }
  }

  private async handshake() {
    const readyok = this.waitFor((l) => l === "readyok", this.readyTimeoutMs);
    this.send("isready");
    await readyok;
  }

  /** Tears the worker down and rejects every pending waiter. */
  private fail(err: Error) {
    this.worker?.terminate();
    this.worker = null;
    this.loading = null;
    this.infoListener = null;
    this.multiPv = 1;
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.reject(err);
    }
    this.waiters.clear();
  }

  private send(command: string) {
    this.worker?.postMessage(command);
  }

  private emit(data: string) {
    for (const line of data.split("\n")) {
      if (!line) continue;
      this.infoListener?.(line);
      for (const w of [...this.waiters]) {
        if (!w.match(line)) continue;
        clearTimeout(w.timer);
        this.waiters.delete(w);
        w.resolve(line);
      }
    }
  }

  private waitFor(match: (line: string) => boolean, timeoutMs: number): Promise<string> {
    const promise = new Promise<string>((resolve, reject) => {
      const waiter: Waiter = {
        match,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          this.fail(new Error("The engine did not answer in time."));
          reject(new Error("The engine did not answer in time."));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
    // A waiter that loses a race to another failure must not surface as unhandled.
    promise.catch(() => undefined);
    return promise;
  }
}
