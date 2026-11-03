import { describe, expect, it } from "vitest";
import { replayAt } from "../../src/practice/replay";

const MOVES = ["e2e4", "e7e5", "g1f3"];
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("replayAt", () => {
  it("shows the start position before any move", () => {
    expect(replayAt(MOVES, 0)).toEqual({ ply: 0, fen: START, label: "Start position" });
  });

  it("shows the position after a move, with that move highlighted", () => {
    const s = replayAt(MOVES, 2);
    expect(s.ply).toBe(2);
    expect(s.fen.startsWith("rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w")).toBe(true);
    expect(s.lastMove).toEqual(["e7", "e5"]);
    expect(s.label).toBe("After 1... e5");
  });

  it("marks the last move of the game", () => {
    expect(replayAt(MOVES, 3).label).toBe("After 2. Nf3 (the last move)");
  });

  it("keeps the step inside the game", () => {
    expect(replayAt(MOVES, -1).ply).toBe(0);
    expect(replayAt(MOVES, 99).ply).toBe(3);
    expect(replayAt(MOVES, Number.NaN).ply).toBe(0);
    expect(replayAt([], 5)).toEqual({ ply: 0, fen: START, label: "Start position" });
  });
});
