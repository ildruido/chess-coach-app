// Stockfish (the same lite single-threaded build the app embeds) as a Node
// child process speaking UCI, for engine-vs-engine calibration matches.
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import {
  type Position,
  type SearchInfo,
  isBestMoveLine,
  parseBestMove,
  parseInfo,
  positionCommand,
  sideAfter,
} from "../../src/engine/uci";

export interface NodeAnalysis {
  bestMove: string | null;
  lines: SearchInfo[];
}

export class NodeEngine {
  private listeners = new Set<(line: string) => void>();
  private multiPv = 1;

  private constructor(private readonly proc: ChildProcessWithoutNullStreams) {
    createInterface({ input: proc.stdout }).on("line", (line) => {
      for (const l of [...this.listeners]) l(line);
    });
  }

  static async start(): Promise<NodeEngine> {
    const script = createRequire(import.meta.url).resolve(
      "stockfish/bin/stockfish-19-lite-single.js",
    );
    const engine = new NodeEngine(spawn(process.execPath, [script]));
    const ok = engine.waitFor((l) => l === "uciok");
    engine.send("uci");
    await ok;
    await engine.ready();
    return engine;
  }

  send(cmd: string) {
    this.proc.stdin.write(cmd + "\n");
  }

  waitFor(match: (line: string) => boolean, timeoutMs = 60_000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(on);
        reject(new Error("engine timeout"));
      }, timeoutMs);
      const on = (line: string) => {
        if (!match(line)) return;
        clearTimeout(timer);
        this.listeners.delete(on);
        resolve(line);
      };
      this.listeners.add(on);
    });
  }

  async ready() {
    const ok = this.waitFor((l) => l === "readyok");
    this.send("isready");
    await ok;
  }

  /** Forgets everything from earlier games. */
  async newGame() {
    this.send("ucinewgame");
    await this.ready();
  }

  /** `clearHash` mirrors the app: playing levels never reuse earlier searches. */
  async analyse(
    position: Position,
    depth: number,
    multiPv = 1,
    clearHash = false,
  ): Promise<NodeAnalysis> {
    await this.ready();
    if (multiPv !== this.multiPv) {
      this.send(`setoption name MultiPV value ${multiPv}`);
      this.multiPv = multiPv;
    }
    if (clearHash) this.send("setoption name Clear Hash");
    const side = sideAfter(position);
    const lines = new Map<number, SearchInfo>();
    const collect = (line: string) => {
      const info = parseInfo(line, side);
      if (info?.pv.length) lines.set(info.multipv, info);
    };
    this.listeners.add(collect);
    try {
      const best = this.waitFor(isBestMoveLine);
      this.send(positionCommand(position));
      this.send(`go depth ${depth}`);
      const bestMove = parseBestMove(await best);
      return { bestMove, lines: [...lines.values()].sort((a, b) => a.multipv - b.multipv) };
    } finally {
      this.listeners.delete(collect);
    }
  }

  quit() {
    this.send("quit");
    this.proc.kill();
  }
}
