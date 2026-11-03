import { describe, expect, it } from "vitest";
import { levelMove } from "../../src/engine/play";
import type { SearchLimits, StockfishEngine } from "../../src/engine/stockfish";
import { levelById } from "../../src/engine/strength";
import type { Analysis, Position } from "../../src/engine/uci";

/** An engine stand-in that records the search it was asked for. */
function fakeEngine(result: Analysis) {
  const calls: { position: Position; limits: SearchLimits }[] = [];
  const engine = {
    analyse: async (position: Position, limits: SearchLimits) => {
      calls.push({ position, limits });
      return result;
    },
  } as unknown as StockfishEngine;
  return { engine, calls };
}

describe("levelMove", () => {
  it("searches fresh at the level's depth and width, and picks a candidate", async () => {
    const { engine, calls } = fakeEngine({
      bestMove: "e7e5",
      depth: 4,
      pv: ["e7e5"],
      ms: 5,
      lines: [{ depth: 4, multipv: 1, score: { cp: -20 }, pv: ["e7e5"] }],
    });
    const level = levelById(3);
    const r = await levelMove(engine, { moves: ["e2e4"] }, level, () => 0.5);
    expect(r.move).toBe("e7e5");
    expect(calls[0]!.limits).toEqual({
      depth: level.depth,
      multiPv: level.multiPv,
      clearHash: true,
    });
  });

  it("falls back to the engine's own move when no candidate line was read", async () => {
    const { engine } = fakeEngine({ bestMove: "g8f6", depth: 0, pv: [], ms: 1 });
    expect((await levelMove(engine, { moves: ["e2e4"] }, levelById(1))).move).toBe("g8f6");
  });

  it("reports no move when there are no legal moves", async () => {
    const { engine } = fakeEngine({ bestMove: null, depth: 0, pv: [], ms: 1, lines: [] });
    expect((await levelMove(engine, {}, levelById(6))).move).toBeNull();
  });
});
