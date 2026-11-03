// The exercise safety net: before Ale's move is played, the engine looks at
// the position after it. A move that loses material or lets the opponent mate
// is held back with a warning worded from the rules, with no coach call.
// Pure logic, unit tested.

import { gameAt, uciLineToSan } from "../chess/notation";
import { materialGain } from "../coach/commentary";
import type { Analysis } from "../engine/uci";

/** Material lost on the engine's line (in points) from which a move is a mistake. */
export const LOSS_POINTS = 2;
/** How far into the engine's reply line material is counted, in half-moves. */
const LINE_PLIES = 4;

export type Judgement =
  { kind: "correct" } | { kind: "notQuite" } | { kind: "warn"; text: string; replySans: string[] };

const PIECE: Record<string, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
};

/** True when the move is the answer, or any checkmate. */
export function isAnswer(fen: string, moves: readonly string[], played: string, expected: string) {
  if (played === expected) return true;
  return gameAt({ fen, moves: [...moves, played] }).isCheckmate();
}

/**
 * Judges a move that isn't the answer. `after` is the engine's analysis of the
 * position after it (the opponent to move).
 */
export function judgeMiss(
  fen: string,
  moves: readonly string[],
  played: string,
  after: Analysis | null,
): Judgement {
  if (!after) return { kind: "notQuite" };
  const before = gameAt({ fen, moves: [...moves] });
  const mover = before.turn();
  const afterGame = gameAt({ fen, moves: [...moves, played] });
  const replySans = uciLineToSan(afterGame, after.pv.slice(0, LINE_PLIES));
  const playedSan = uciLineToSan(before, [played])[0];
  if (!playedSan) return { kind: "notQuite" };
  const them = mover === "w" ? "Black" : "White";
  // The engine's score is from White's side; a mate for the opponent has their sign.
  const mate = after.score?.mate;
  if (mate !== undefined && mate !== 0 && mate > 0 === (mover === "b")) {
    return { kind: "warn", text: `Careful: this move lets ${them} checkmate.`, replySans };
  }
  const gain = materialGain(before, [playedSan, ...replySans]);
  if (gain > -LOSS_POINTS) return { kind: "notQuite" };
  const reply = after.pv[0]
    ? afterGame.move({
        from: after.pv[0].slice(0, 2),
        to: after.pv[0].slice(2, 4),
        promotion: after.pv[0][4],
      })
    : null;
  if (reply?.captured && reply.captured !== "k") {
    return {
      kind: "warn",
      text: `Careful: after this move, your ${PIECE[reply.captured]} on ${reply.to} can be taken.`,
      replySans,
    };
  }
  return { kind: "warn", text: "Careful: the engine thinks this move loses something.", replySans };
}

export type SafeJudgement =
  { kind: "safe" } | Extract<Judgement, { kind: "warn" }> | { kind: "unknown" };

/**
 * A "safe" exercise (lesson 2): any move that doesn't lose material or allow
 * mate is right, and checkmate always is. Without the engine's look the move
 * can't be judged.
 */
export function judgeSafe(
  fen: string,
  moves: readonly string[],
  played: string,
  after: Analysis | null,
): SafeJudgement {
  if (gameAt({ fen, moves: [...moves, played] }).isCheckmate()) return { kind: "safe" };
  if (!after) return { kind: "unknown" };
  const j = judgeMiss(fen, moves, played, after);
  return j.kind === "warn" ? j : { kind: "safe" };
}
