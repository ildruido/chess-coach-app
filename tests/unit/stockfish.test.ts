import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EngineBusyError, StockfishEngine } from "../../src/engine/stockfish";

// A stand-in for the engine worker. `script` decides how it answers `go`.
type Mode =
  | "normal"
  | "no-moves"
  | "silent-search"
  | "crash-on-load"
  | "no-info"
  | "late-score"
  | "multi"
  | "until-stop";

class FakeWorker {
  static mode: Mode = "normal";
  static created: FakeWorker[] = [];
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: { message: string; preventDefault(): void }) => void) | null = null;
  terminated = false;
  received: string[] = [];

  constructor() {
    FakeWorker.created.push(this);
    if (FakeWorker.mode === "crash-on-load") {
      setTimeout(() => this.onerror?.({ message: "boom", preventDefault() {} }), 0);
    }
  }

  postMessage(cmd: string) {
    this.received.push(cmd);
    const reply = (...lines: string[]) =>
      setTimeout(() => {
        if (!this.terminated) for (const l of lines) this.onmessage?.({ data: l });
      }, 0);
    if (FakeWorker.mode === "crash-on-load") return;
    if (cmd === "uci") reply("id name Fakefish 1", "uciok");
    else if (cmd === "isready") reply("readyok");
    else if (cmd === "stop") reply("info depth 3 score cp 10 pv d7d5", "bestmove d7d5");
    else if (cmd.startsWith("go")) {
      if (FakeWorker.mode === "normal")
        reply("info depth 8 score cp 25 pv e7e5 g1f3", "bestmove e7e5 ponder g1f3");
      if (FakeWorker.mode === "no-moves") reply("info depth 0 score mate 0", "bestmove (none)");
      if (FakeWorker.mode === "no-info") reply("bestmove d7d5");
      if (FakeWorker.mode === "late-score")
        reply("info depth 8 score cp 25 pv e7e5 g1f3", "info depth 9 score cp 31", "bestmove e7e5");
      if (FakeWorker.mode === "multi")
        reply(
          "info depth 4 multipv 1 score cp 30 pv e7e5 g1f3",
          "info depth 4 multipv 2 score cp 45 pv c7c5",
          "info depth 4 multipv 3 score cp 90 pv a7a6",
          "bestmove e7e5",
        );
      // "silent-search": never answers, to trigger the timeout.
    }
  }

  terminate() {
    this.terminated = true;
  }
}

const fast = () =>
  new StockfishEngine({ source: () => "", readyTimeoutMs: 200, searchTimeoutMs: 100 });

beforeEach(() => {
  FakeWorker.mode = "normal";
  FakeWorker.created = [];
  vi.stubGlobal("Worker", FakeWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StockfishEngine", () => {
  it("skips a background search when a normal one is waiting behind it", async () => {
    const engine = fast();
    const bg = engine.analyse({}, { movetime: 50, background: true });
    const normal = engine.analyse({}, { movetime: 50 });
    await expect(bg).rejects.toBeInstanceOf(EngineBusyError);
    await expect(normal).resolves.toMatchObject({ bestMove: "e7e5" });
    // On its own, a background search runs as usual.
    await expect(engine.analyse({}, { movetime: 50, background: true })).resolves.toMatchObject({
      bestMove: "e7e5",
    });
  });

  it("stops a running background search when a normal one arrives, and drops its result", async () => {
    const engine = fast();
    FakeWorker.mode = "until-stop";
    const bg = engine.analyse({}, { movetime: 5000, background: true });
    await vi.waitFor(() => expect(FakeWorker.created[0]?.received.at(-1)).toMatch(/^go/));
    FakeWorker.mode = "normal";
    const normal = engine.analyse({ moves: ["e2e4"] }, { movetime: 50 });
    // Cut short, the search is too shallow to judge by.
    await expect(bg).rejects.toBeInstanceOf(EngineBusyError);
    await expect(normal).resolves.toMatchObject({ bestMove: "e7e5" });
    // A normal search is never cut short by another one.
    expect(FakeWorker.created[0]!.received.filter((c) => c === "stop")).toHaveLength(1);
  });

  it("returns several candidate lines with MultiPV, setting the option only when it changes", async () => {
    FakeWorker.mode = "multi";
    const engine = fast();
    const a = await engine.analyse({ moves: ["e2e4"] }, { depth: 4, multiPv: 3 });
    expect(a.lines?.map((l) => [l.multipv, l.pv[0], l.score])).toEqual([
      [1, "e7e5", { cp: -30 }],
      [2, "c7c5", { cp: -45 }],
      [3, "a7a6", { cp: -90 }],
    ]);
    await engine.analyse({ moves: ["e2e4"] }, { depth: 4, multiPv: 3 });
    await engine.analyse({ moves: ["e2e4"] }, { depth: 4 });
    const options = FakeWorker.created[0]!.received.filter((c) => c.startsWith("setoption"));
    expect(options).toEqual(["setoption name MultiPV value 3", "setoption name MultiPV value 1"]);
  });

  it("sets MultiPV again on a fresh worker after a crash", async () => {
    const engine = fast();
    FakeWorker.mode = "multi";
    await engine.analyse({}, { depth: 4, multiPv: 3 });
    FakeWorker.mode = "silent-search";
    await expect(engine.analyse({}, { depth: 4, multiPv: 3 })).rejects.toThrow(/in time/);
    FakeWorker.mode = "multi";
    await engine.analyse({}, { depth: 4, multiPv: 3 });
    expect(FakeWorker.created).toHaveLength(2);
    expect(FakeWorker.created[1]!.received).toContain("setoption name MultiPV value 3");
  });

  it("clears the hash before a search only when asked", async () => {
    const engine = fast();
    await engine.analyse({}, { depth: 4 });
    await engine.analyse({}, { depth: 4, clearHash: true });
    const cmds = FakeWorker.created[0]!.received;
    expect(cmds.filter((c) => c === "setoption name Clear Hash")).toHaveLength(1);
    expect(cmds.lastIndexOf("setoption name Clear Hash")).toBeLessThan(
      cmds.lastIndexOf("go depth 4"),
    );
  });

  it("loads, then reports move, score from White's view, and line", async () => {
    const engine = fast();
    const a = await engine.analyse({ moves: ["e2e4"] }, { movetime: 10 });
    expect(engine.name).toBe("Fakefish 1");
    expect(a.bestMove).toBe("e7e5");
    expect(a.score).toEqual({ cp: -25 }); // Black to move: +25 for Black is -25 for White
    expect(a.pv).toEqual(["e7e5", "g1f3"]);
  });

  it("checks the engine is idle before every search", async () => {
    const engine = fast();
    await engine.analyse({}, { movetime: 10 });
    await engine.analyse({}, { movetime: 10 });
    const cmds = FakeWorker.created[0]!.received;
    const gos = cmds.map((c, i) => (c.startsWith("go") ? i : -1)).filter((i) => i >= 0);
    for (const i of gos) expect(cmds.slice(0, i).lastIndexOf("isready")).toBeGreaterThan(-1);
    expect(cmds.filter((c) => c === "isready")).toHaveLength(3); // load + 2 searches
  });

  it("answers 'no legal moves' instead of hanging on a finished game", async () => {
    FakeWorker.mode = "no-moves";
    const a = await fast().analyse({ moves: ["f2f3", "e7e5", "g2g4", "d8h4"] }, { movetime: 10 });
    expect(a.bestMove).toBeNull();
    expect(a.score).toEqual({ mate: 0 });
    expect(a.pv).toEqual([]);
  });

  it("never invents a score when the engine reports none", async () => {
    FakeWorker.mode = "no-info";
    const a = await fast().analyse({}, { movetime: 10 });
    expect(a.bestMove).toBe("d7d5");
    expect(a.score).toBeUndefined();
  });

  it("keeps the best line when a later report has only a score", async () => {
    FakeWorker.mode = "late-score";
    const a = await fast().analyse({}, { movetime: 10 });
    expect(a.depth).toBe(9);
    expect(a.score).toEqual({ cp: 31 });
    expect(a.pv).toEqual(["e7e5", "g1f3"]);
  });

  it("restarts with a fresh worker after a search times out", async () => {
    const engine = fast();
    FakeWorker.mode = "silent-search";
    await expect(engine.analyse({}, { movetime: 10 })).rejects.toThrow(/in time/);
    expect(FakeWorker.created[0]!.terminated).toBe(true);

    FakeWorker.mode = "normal";
    const a = await engine.analyse({}, { movetime: 10 });
    expect(a.bestMove).toBe("e7e5");
    expect(FakeWorker.created).toHaveLength(2);
  });

  it("reports a load failure and can retry", async () => {
    const engine = fast();
    FakeWorker.mode = "crash-on-load";
    await expect(engine.start()).rejects.toThrow("boom");

    FakeWorker.mode = "normal";
    await expect(engine.start()).resolves.toBeUndefined();
    expect(FakeWorker.created).toHaveLength(2);
  });

  it("stop() rejects a pending search without breaking the next start", async () => {
    const engine = fast();
    await engine.start();
    FakeWorker.mode = "silent-search";
    const pending = engine.analyse({}, { movetime: 10 });
    await new Promise((r) => setTimeout(r, 5));
    engine.stop();
    await expect(pending).rejects.toThrow(/stopped/);

    FakeWorker.mode = "normal";
    await expect(engine.analyse({}, { movetime: 10 })).resolves.toMatchObject({
      bestMove: "e7e5",
    });
  });
});
