// "Play it out" exercises and opening drills (lessons 10 to 12). Pure logic,
// unit tested: the goals, the safety net's extra rules for playing a position
// out, and the opening book of a drill.

import type { Chess } from "chess.js";
import { gameAt } from "../chess/notation";
import type { Analysis } from "../engine/uci";
import { openingFor } from "../openings/opening-name";
import { judgeMiss } from "./safety-net";

/** What a "play it out" exercise asks: checkmate, or develop the knights and bishops and castle. */
export type PlayGoal = "mate" | "develop";

const HOME: Record<"w" | "b", [string, "n" | "b"][]> = {
  w: [
    ["b1", "n"],
    ["g1", "n"],
    ["c1", "b"],
    ["f1", "b"],
  ],
  b: [
    ["b8", "n"],
    ["g8", "n"],
    ["c8", "b"],
    ["f8", "b"],
  ],
};

export interface Development {
  /** Knights and bishops moved off their starting squares (0 to 4). */
  developed: number;
  castled: boolean;
}

/**
 * How far `side` has got with developing: knights and bishops off their
 * starting squares (one that was traded off counts as out), and castling.
 */
export function development(game: Chess, side: "w" | "b"): Development {
  const developed = HOME[side].filter(([sq, type]) => {
    const p = game.get(sq as Parameters<Chess["get"]>[0]);
    return !(p && p.color === side && p.type === type);
  }).length;
  const castled = game
    .history({ verbose: true })
    .some((m) => m.color === side && (m.flags.includes("k") || m.flags.includes("q")));
  return { developed, castled };
}

/** True when the goal is met in the game as played (the player is `side`). */
export function goalMet(goal: PlayGoal, game: Chess, side: "w" | "b"): boolean {
  if (goal === "mate") return game.isCheckmate() && game.turn() !== side;
  const d = development(game, side);
  return d.developed === 4 && d.castled;
}

/** The line shown while a "develop" exercise runs, and when its moves run out. */
export function developText(d: Development, movesLeft: number): string {
  const castled = d.castled ? "castled" : "not castled yet";
  const left = movesLeft === 1 ? "1 move left" : `${movesLeft} moves left`;
  return `${d.developed} of 4 knights and bishops out, ${castled}. ${left}.`;
}

export type PlayJudgement =
  { kind: "ok" } | { kind: "warn"; text: string; replySans: string[] } | { kind: "unknown" };

/**
 * Judges a move in a "play it out" exercise before it is played. Any move is
 * fine unless it throws something away: stalemate or another draw, material,
 * or a mate for the opponent. `after` is the engine's look at the position
 * after the move; the draw rules need no engine.
 */
export function judgePlay(
  fen: string,
  moves: readonly string[],
  played: string,
  after: Analysis | null,
): PlayJudgement {
  const game = gameAt({ fen, moves: [...moves, played] });
  if (game.isCheckmate()) return { kind: "ok" };
  const them = game.turn() === "w" ? "White" : "Black";
  if (game.isStalemate()) {
    return {
      kind: "warn",
      text: `Careful: this is stalemate. ${them} has no legal move but isn't in check, so the game is a draw.`,
      replySans: [],
    };
  }
  if (game.isInsufficientMaterial()) {
    return {
      kind: "warn",
      text: "Careful: after this move nobody has enough pieces left to checkmate, so the game is a draw.",
      replySans: [],
    };
  }
  if (game.isThreefoldRepetition()) {
    return {
      kind: "warn",
      text: "Careful: this repeats the position for the third time, so the game is a draw.",
      replySans: [],
    };
  }
  if (game.isDrawByFiftyMoves()) {
    return {
      kind: "warn",
      text: "Careful: this is the 50th move in a row without a capture or a pawn move, so the game is a draw.",
      replySans: [],
    };
  }
  if (!after) return { kind: "unknown" };
  const j = judgeMiss(fen, moves, played, after);
  return j.kind === "warn" ? j : { kind: "ok" };
}

/** The opening named after these moves (UCI, from the start position), or null. */
export function positionName(uciMoves: readonly string[]): string | null {
  return openingFor(uciMoves)?.name ?? null;
}

/**
 * What a drill says when the player leaves the book: the move the opening
 * plays instead, and the name of the player's move, if it starts a named line. Text with {moves} in braces, shown in bold.
 */
export function leftBookText(
  opening: string,
  moves: readonly string[],
  played: string,
  bookUci: string,
): string {
  const before = gameAt({ moves: [...moves] });
  const bookSan = before.move({
    from: bookUci.slice(0, 2),
    to: bookUci.slice(2, 4),
    promotion: bookUci[4],
  }).san;
  const playedSan = gameAt({ moves: [...moves] }).move({
    from: played.slice(0, 2),
    to: played.slice(2, 4),
    promotion: played[4],
  }).san;
  // The player's move may start a named line of its own (the Ruy Lopez, a gambit…).
  const other = openingFor([...moves, played]);
  const yours =
    other && other.ply === moves.length + 1
      ? ` {${playedSan}} has a name too: the ${other.name}.`
      : "";
  return `That leaves the book. The ${opening} plays {${bookSan}} here.${yours} Take your move back and try {${bookSan}}.`;
}
