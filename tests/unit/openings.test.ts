import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { OPENINGS, openingFor, positionKey } from "../../src/openings/opening-name";

const ITALIAN = ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"];

describe("opening names", () => {
  it("names the Italian Game", () => {
    expect(openingFor(ITALIAN)).toEqual({ eco: "C50", name: "Italian Game", ply: 5 });
  });

  it("names a transposition the same way", () => {
    // 1. Nf3 Nc6 2. e4 e5 3. Bc4 reaches the Italian Game by another order.
    expect(openingFor(["g1f3", "b8c6", "e2e4", "e7e5", "f1c4"])?.name).toBe("Italian Game");
  });

  it("keeps the last name after the game leaves the book", () => {
    const o = openingFor([...ITALIAN, "a7a6", "h2h4", "h7h5", "a2a4", "a6a5"]);
    expect(o).toEqual(openingFor([...ITALIAN, "a7a6"]));
    expect(o!.name).toMatch(/^Italian Game/);
    expect(o!.eco).toMatch(/^C5/);
  });

  it("gives no name before any book position", () => {
    expect(openingFor([])).toBeNull();
  });

  it("stops at an illegal move", () => {
    expect(openingFor(["e2e4", "e2e4"])?.ply).toBe(1);
  });

  it("keys positions without the move counters", () => {
    expect(positionKey("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1")).toBe(
      "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -",
    );
  });
});

describe("bundled openings list", () => {
  const entries = Object.entries(OPENINGS.o);

  it("has the lichess list, about 3,800 positions", () => {
    expect(entries.length).toBeGreaterThan(3500);
    expect(OPENINGS.maxPly).toBeGreaterThan(10);
  });

  it("has a valid position, ECO code and name in every entry", () => {
    for (const [key, value] of entries) {
      expect(() => new Chess(`${key} 0 1`)).not.toThrow();
      expect(value).toMatch(/^[A-E]\d\d\|.+/);
    }
  });
});
