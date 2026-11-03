import { describe, expect, it } from "vitest";
import { newSavedGame, parseSavedGame, withMoves } from "../../src/storage/saved-game";

const t0 = new Date("2026-10-04T19:00:00Z");
const t1 = new Date("2026-10-05T08:30:00Z");

describe("saved game", () => {
  it("round-trips a game in progress", () => {
    const g = withMoves(newSavedGame(t0), ["e2e4", "e7e5", "g1f3"], t1);
    expect(parseSavedGame(JSON.parse(JSON.stringify(g)))).toEqual(g);
    expect(g.createdAt).toBe("2026-10-04T19:00:00.000Z");
    expect(g.updatedAt).toBe("2026-10-05T08:30:00.000Z");
  });

  it("does not share the caller's move array", () => {
    const moves = ["e2e4"];
    const g = withMoves(newSavedGame(t0), moves, t1);
    moves.push("e7e5");
    expect(g.moves).toEqual(["e2e4"]);
  });

  it("rejects anything that isn't a valid saved game", () => {
    const good = withMoves(newSavedGame(t0), ["e2e4"], t1);
    expect(parseSavedGame(null)).toBeNull();
    expect(parseSavedGame("e2e4")).toBeNull();
    expect(parseSavedGame({ ...good, version: 2 })).toBeNull();
    expect(parseSavedGame({ ...good, moves: "e2e4" })).toBeNull();
    expect(parseSavedGame({ ...good, moves: ["E2E4"] })).toBeNull();
    expect(parseSavedGame({ ...good, updatedAt: "yesterday" })).toBeNull();
  });

  it("rejects moves that are not legal from the start", () => {
    const g = withMoves(newSavedGame(t0), ["e2e4", "e2e4"], t1);
    expect(parseSavedGame(g)).toBeNull();
  });

  it("ignores unknown extra fields", () => {
    const g = withMoves(newSavedGame(t0), ["d2d4"], t1);
    expect(parseSavedGame({ ...g, injected: "<script>" })).toEqual(g);
  });
});
