import { describe, expect, it } from "vitest";
import {
  START_FEN,
  formatScore,
  isBestMoveLine,
  parseBestMove,
  parseInfo,
  positionCommand,
  sideAfter,
} from "../../src/engine/uci";

const INFO =
  "info depth 12 seldepth 16 multipv 1 score cp 34 nodes 51234 nps 900000 time 57 pv e7e5 g1f3 b8c6";

describe("parseInfo", () => {
  it("reads depth, score and best line", () => {
    expect(parseInfo(INFO, "w")).toEqual({
      depth: 12,
      multipv: 1,
      score: { cp: 34 },
      pv: ["e7e5", "g1f3", "b8c6"],
    });
  });

  it("reads which candidate line it is", () => {
    expect(parseInfo("info depth 8 multipv 3 score cp -12 pv d2d4", "w")?.multipv).toBe(3);
  });

  it("flips the score to White's view when Black is to move", () => {
    expect(parseInfo(INFO, "b")?.score).toEqual({ cp: -34 });
    expect(parseInfo("info depth 9 score mate 3 pv d8h4", "b")?.score).toEqual({ mate: -3 });
  });

  it("reads a score without a line, and checkmate as mate 0", () => {
    expect(parseInfo("info depth 0 score mate 0", "b")).toEqual({
      depth: 0,
      multipv: 1,
      score: { mate: 0 },
      pv: [],
    });
    expect(formatScore({ mate: 0 })).toBe("Checkmate");
  });

  it("ignores lines without a usable score", () => {
    expect(parseInfo("info depth 10 score cp 20 upperbound pv e2e4", "w")).toBeNull();
    expect(parseInfo("info depth 5 currmove e2e4 currmovenumber 1", "w")).toBeNull();
    expect(parseInfo("info depth 10 score cp 20 lowerbound pv e2e4", "w")).toBeNull();
    expect(parseInfo("info string NNUE evaluation enabled", "w")).toBeNull();
    expect(parseInfo("bestmove e2e4", "w")).toBeNull();
  });
});

describe("parseBestMove", () => {
  it("reads the move and ignores ponder", () => {
    expect(parseBestMove("bestmove e7e5 ponder g1f3")).toBe("e7e5");
  });

  it("reads a move without ponder", () => {
    expect(parseBestMove("bestmove g8f6")).toBe("g8f6");
  });

  it("returns null when there is no move", () => {
    expect(parseBestMove("bestmove (none)")).toBeNull();
    expect(parseBestMove("readyok")).toBeNull();
  });

  it("recognises every bestmove line, including no legal moves", () => {
    expect(isBestMoveLine("bestmove (none)")).toBe(true);
    expect(isBestMoveLine("bestmove e2e4 ponder e7e5")).toBe(true);
    expect(isBestMoveLine("info depth 1 score cp 0 pv e2e4")).toBe(false);
  });
});

describe("positions", () => {
  it("builds UCI position commands", () => {
    expect(positionCommand({})).toBe("position startpos");
    expect(positionCommand({ moves: ["e2e4", "e7e5"] })).toBe("position startpos moves e2e4 e7e5");
    expect(positionCommand({ fen: START_FEN })).toBe(`position fen ${START_FEN}`);
  });

  it("tracks the side to move", () => {
    expect(sideAfter({})).toBe("w");
    expect(sideAfter({ moves: ["e2e4"] })).toBe("b");
    expect(sideAfter({ fen: START_FEN.replace(" w ", " b "), moves: ["e7e5"] })).toBe("w");
  });
});

describe("formatScore", () => {
  it("formats centipawns as pawns with a sign", () => {
    expect(formatScore({ cp: 35 })).toBe("+0.35");
    expect(formatScore({ cp: -120 })).toBe("-1.20");
    expect(formatScore({ cp: 0 })).toBe("0.00");
  });

  it("formats mates", () => {
    expect(formatScore({ mate: 3 })).toBe("White mates in 3");
    expect(formatScore({ mate: -2 })).toBe("Black mates in 2");
  });
});
