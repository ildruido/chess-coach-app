import { describe, expect, it } from "vitest";
import {
  gameAt,
  movesSoFar,
  numberedLine,
  pieceList,
  uciLineToSan,
} from "../../src/chess/notation";

const ITALIAN = { moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"] };

describe("notation", () => {
  it("rebuilds a game from UCI moves", () => {
    expect(movesSoFar(gameAt(ITALIAN))).toBe("1. e4 e5 2. Nf3 Nc6 3. Bc4");
    expect(movesSoFar(gameAt({}))).toBe("(no moves yet)");
  });

  it("converts an engine line to SAN with move numbers from Black's turn", () => {
    const game = gameAt(ITALIAN);
    const line = uciLineToSan(game, ["g8f6", "d2d3", "f8c5", "e1g1"]);
    expect(line).toEqual(["Nf6", "d3", "Bc5", "O-O"]);
    expect(numberedLine(game, line)).toBe("3... Nf6 4. d3 Bc5 5. O-O");
  });

  it("stops at an illegal move instead of inventing one", () => {
    expect(uciLineToSan(gameAt(ITALIAN), ["g8f6", "e1e5", "f8c5"])).toEqual(["Nf6"]);
  });

  it("does not change the game it reads", () => {
    const game = gameAt(ITALIAN);
    uciLineToSan(game, ["g8f6"]);
    expect(game.history()).toHaveLength(5);
  });

  it("lists pieces in words, king first", () => {
    expect(pieceList(gameAt({}), "w")).toBe(
      "king e1; queen d1; rooks a1, h1; bishops c1, f1; knights b1, g1; " +
        "pawns a2, b2, c2, d2, e2, f2, g2, h2",
    );
  });

  it("numbers a line from a FEN with Black to move late in the game", () => {
    const game = gameAt({ fen: "8/5k2/8/8/8/8/4K3/7R b - - 10 42" });
    expect(numberedLine(game, ["Kg6", "Rg1+"])).toBe("42... Kg6 43. Rg1+");
  });

  it("converts promotions", () => {
    const game = gameAt({ fen: "8/4P3/8/8/8/8/k7/4K3 w - - 0 60" });
    expect(uciLineToSan(game, ["e7e8q"])).toEqual(["e8=Q"]);
  });

  it("rejects an illegal game", () => {
    expect(() => gameAt({ moves: ["e2e5"] })).toThrow();
  });
});
