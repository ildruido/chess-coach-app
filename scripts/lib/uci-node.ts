// Runs Stockfish (the same stockfish.js build the page embeds) under Node for
// build scripts and engine tests. Not used by the page.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import {
  isBestMoveLine,
  parseInfo,
  positionCommand,
  sideAfter,
  type Position,
  type SearchInfo,
} from "../../src/engine/uci";

const require = createRequire(import.meta.url);

export class NodeEngine {
  private proc: ChildProcessWithoutNullStreams;
  private waiters: {
    test: (line: string) => boolean;
    resolve: () => void;
    reject: (e: Error) => void;
  }[] = [];
  private listener: ((line: string) => void) | null = null;

  constructor() {
    const bin = require.resolve("stockfish/bin/stockfish-19-lite-single.js");
    this.proc = spawn(process.execPath, [bin]);
    const fail = (why: string) => {
      for (const w of this.waiters) w.reject(new Error(`Stockfish stopped: ${why}`));
      this.waiters = [];
    };
    this.proc.on("exit", (code) => fail(`exit code ${code}`));
    this.proc.on("error", (e) => fail(e.message));
    createInterface({ input: this.proc.stdout }).on("line", (line) => {
      this.listener?.(line);
      this.waiters = this.waiters.filter((w) => {
        if (!w.test(line)) return true;
        w.resolve();
        return false;
      });
    });
  }

  private send(cmd: string) {
    this.proc.stdin.write(cmd + "\n");
  }

  private until(test: (line: string) => boolean): Promise<void> {
    return new Promise((resolve, reject) => this.waiters.push({ test, resolve, reject }));
  }

  async init(multiPv = 2) {
    this.send("uci");
    await this.until((l) => l === "uciok");
    this.send(`setoption name MultiPV value ${multiPv}`);
    this.send("isready");
    await this.until((l) => l === "readyok");
  }

  /** The deepest line for each MultiPV slot, best first. Scores from White's view. */
  async search(pos: Position, depth: number): Promise<SearchInfo[]> {
    const side = sideAfter(pos);
    const lines = new Map<number, SearchInfo>();
    this.listener = (line) => {
      const info = parseInfo(line, side);
      if (info && info.pv.length) lines.set(info.multipv, info);
    };
    const done = this.until(isBestMoveLine);
    this.send("ucinewgame");
    this.send(positionCommand(pos));
    this.send(`go depth ${depth}`);
    await done;
    this.listener = null;
    return [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  }

  quit() {
    this.send("quit");
    this.proc.kill();
  }
}
