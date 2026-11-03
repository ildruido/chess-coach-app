import { describe, expect, it } from "vitest";
import { GameState, statusText } from "../../src/game/game-state";

/** Plays SAN-free [from, to, promotion?] moves and fails loudly on a bad one. */
function play(game: GameState, ...moves: string[]) {
  for (const m of moves) {
    const r = game.play(m.slice(0, 2), m.slice(2, 4), m[4] as "q" | undefined);
    if (!r.ok) throw new Error(`${m}: ${r.reason}`);
  }
  return game;
}

describe("GameState", () => {
  it("offers legal destinations and refuses illegal moves", () => {
    const g = new GameState();
    expect(g.dests().get("e2")).toEqual(["e3", "e4"]);
    expect(g.dests().get("g1")?.sort()).toEqual(["f3", "h3"]);
    expect(g.play("e2", "e5")).toEqual({ ok: false, reason: "illegal" });
    expect(g.play("e7", "e5")).toEqual({ ok: false, reason: "illegal" }); // not Black's turn
    expect(g.moves).toEqual([]);
  });

  it("records moves in UCI and lists them in standard notation", () => {
    const g = play(new GameState(), "e2e4", "e7e5", "g1f3");
    expect(g.moves).toEqual(["e2e4", "e7e5", "g1f3"]);
    expect(g.moveList()).toBe("1. e4 e5 2. Nf3");
    expect(g.lastMove).toEqual(["g1", "f3"]);
    expect(g.turn).toBe("black");
  });

  it("castles, including through the king's two-square move", () => {
    const g = play(new GameState(), "e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6");
    expect(g.dests().get("e1")).toContain("g1");
    expect(g.play("e1", "g1")).toMatchObject({ ok: true, san: "O-O" });
  });

  it("captures en passant", () => {
    const g = play(new GameState(), "e2e4", "a7a6", "e4e5", "d7d5");
    expect(g.play("e5", "d6")).toMatchObject({ ok: true, san: "exd6" });
  });

  it("asks for the piece before a promotion, then promotes", () => {
    const g = play(new GameState(), "h2h4", "g7g5", "h4g5", "h7h6", "g5h6", "f8g7", "h6g7", "a7a6");
    expect(g.isPromotion("g7", "h8")).toBe(true);
    expect(g.play("g7", "h8")).toEqual({ ok: false, reason: "needs-promotion" });
    expect(g.play("g7", "h8", "n")).toMatchObject({ ok: true, san: "gxh8=N", uci: "g7h8n" });
  });

  it("announces check and checkmate", () => {
    const g = play(new GameState(), "f2f3", "e7e5", "g2g4");
    expect(g.status()).toEqual({ kind: "playing", turn: "black", inCheck: false });
    play(g, "d8h4");
    expect(g.status()).toEqual({ kind: "checkmate", winner: "black" });
    expect(statusText(g.status())).toBe("Checkmate. Black wins.");
    expect(g.dests().size).toBe(0);
    expect(g.play("a2", "a3")).toEqual({ ok: false, reason: "game-over" });
  });

  it("announces stalemate", () => {
    // Shortest known stalemate (Sam Loyd, 10 moves).
    const g = play(
      new GameState(),
      "e2e3",
      "a7a5",
      "d1h5",
      "a8a6",
      "h5a5",
      "h7h5",
      "h2h4",
      "a6h6",
      "a5c7",
      "f7f6",
      "c7d7",
      "e8f7",
      "d7b7",
      "d8d3",
      "b7b8",
      "d3h7",
      "b8c8",
      "f7g6",
      "c8e6",
    );
    expect(g.status()).toEqual({ kind: "stalemate" });
    expect(statusText(g.status())).toMatch(/^Stalemate/);
  });

  it("announces a draw by repetition", () => {
    const g = play(new GameState(), "g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8");
    expect(g.status()).toEqual({ kind: "threefold" });
  });

  it("still sees a repetition after a take-back or a restore", () => {
    const shuffle = ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"];
    const g = play(new GameState(), ...shuffle);
    expect(g.status()).toEqual({ kind: "threefold" });
    g.undo();
    expect(g.status().kind).toBe("playing");
    play(g, "f6g8");
    expect(g.status()).toEqual({ kind: "threefold" });
    expect(new GameState(shuffle).status()).toEqual({ kind: "threefold" });
  });

  it("announces a draw by the 50-move rule", () => {
    // 99 half-moves without a capture or pawn move; one more rook move ends it.
    const g = new GameState([], "4k3/8/8/8/8/8/8/R3K3 w - - 99 80");
    expect(g.status().kind).toBe("playing");
    play(g, "a1a2");
    expect(g.status()).toEqual({ kind: "fifty-moves" });
    expect(statusText(g.status())).toMatch(/50-move rule/);
  });

  it("announces a draw by insufficient material", () => {
    const g = new GameState([], "4k3/8/8/8/8/8/3p4/4K3 w - - 0 60");
    play(g, "e1d2"); // king takes the last pawn
    expect(g.status()).toEqual({ kind: "insufficient-material" });
  });

  it("takes back moves from a set-up position too", () => {
    const g = new GameState(["g1f3"], "4k3/8/8/8/8/8/8/4K1N1 w - - 0 1");
    g.undo();
    expect(g.fen).toBe("4k3/8/8/8/8/8/8/4K1N1 w - - 0 1");
  });

  it("takes back moves", () => {
    const g = play(new GameState(), "e2e4", "e7e5");
    expect(g.undo()).toBe(true);
    expect(g.moves).toEqual(["e2e4"]);
    expect(g.turn).toBe("black");
    expect(new GameState().undo()).toBe(false);
  });

  it("restores a saved game", () => {
    const g = new GameState(["e2e4", "e7e5"]);
    expect(g.moveList()).toBe("1. e4 e5");
    expect(g.turn).toBe("white");
  });
});
