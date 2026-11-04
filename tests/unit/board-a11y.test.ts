import { describe, expect, it } from "vitest";
import { announceMove, describeBoard, parseTypedMove } from "../../src/board/board-a11y";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("parseTypedMove", () => {
  it("reads SAN and square pairs", () => {
    expect(parseTypedMove(START, "e4")).toMatchObject({ ok: true, move: { from: "e2", to: "e4" } });
    expect(parseTypedMove(START, "Nf3")).toMatchObject({
      ok: true,
      move: { from: "g1", to: "f3" },
    });
    expect(parseTypedMove(START, "e2e4")).toMatchObject({ ok: true, move: { san: "e4" } });
    expect(parseTypedMove(START, "g1 f3")).toMatchObject({ ok: true, move: { san: "Nf3" } });
  });
  it("refuses illegal or empty input with a reason", () => {
    expect(parseTypedMove(START, "e5")).toMatchObject({ ok: false });
    expect(parseTypedMove(START, "  ")).toMatchObject({ ok: false });
    expect(parseTypedMove(START, "hello")).toMatchObject({ ok: false });
  });
  it("reads castling and promotion", () => {
    const castle = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    expect(parseTypedMove(castle, "O-O")).toMatchObject({
      ok: true,
      move: { from: "e1", to: "g1" },
    });
    expect(parseTypedMove(castle, "0-0-0")).toMatchObject({ ok: true, move: { to: "c1" } });
    const promo = "8/4P3/8/8/8/8/8/k6K w - - 0 1";
    expect(parseTypedMove(promo, "e8=N")).toMatchObject({ ok: true, move: { promotion: "n" } });
    // No piece named: no promotion yet, so the board asks.
    const bare = parseTypedMove(promo, "e7e8");
    expect(bare).toMatchObject({ ok: true, move: { from: "e7", to: "e8" } });
    expect(bare.ok && bare.move.promotion).toBeUndefined();
    expect(parseTypedMove(promo, "e7e8q")).toMatchObject({ ok: true, move: { promotion: "q" } });
  });
});

describe("announceMove", () => {
  it("says the move in words, with the side", () => {
    const after = "rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 1 1";
    expect(announceMove(START, after, "g1", "f3")).toBe("White played knight f3.");
  });
  it("is null when the move does not follow from the position", () => {
    expect(announceMove(START, START, "e5", "e6")).toBeNull();
  });
  it("names the piece a pawn promoted to", () => {
    const before = "8/4P3/8/8/8/8/8/k6K w - - 0 1";
    const after = "4N3/8/8/8/8/8/8/k6K b - - 0 1";
    expect(announceMove(before, after, "e7", "e8")).toContain("promotes to knight");
  });
});

describe("describeBoard", () => {
  it("lists both sides, whose move it is and the legal moves", () => {
    const text = describeBoard(START);
    expect(text).toContain("White: king e1, queen d1");
    expect(text).toContain("Black: king e8");
    expect(text).toContain("White to move.");
    expect(text).toContain("Legal moves:");
    expect(text).toContain("knight f3");
  });
  it("says check", () => {
    expect(describeBoard("4k3/8/8/8/8/8/4r3/4K3 w - - 0 1")).toContain("Check.");
  });
});
