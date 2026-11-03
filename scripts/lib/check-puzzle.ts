// Confirms a lesson puzzle with Stockfish: every move the player must find is
// the engine's best (or, on the last move, any checkmate), and it is clearly
// better than the next best move, so the puzzle has one answer.

import { Chess } from "chess.js";
import type { Score, SearchInfo } from "../../src/engine/uci";

/** Centipawns the answer must beat the second-best move by. */
export const MIN_GAP = 150;

type Search = (pos: { fen: string; moves: string[] }) => Promise<SearchInfo[]>;

/** A score as centipawns for the side to move; mates count as very large. */
function forMover(score: Score, mover: "w" | "b"): number {
  const sign = mover === "w" ? 1 : -1;
  if (score.mate !== undefined)
    return sign * Math.sign(score.mate) * (100000 - Math.abs(score.mate));
  return sign * (score.cp ?? 0);
}

function givesMate(fen: string, moves: string[]): boolean {
  const game = new Chess(fen);
  for (const m of moves) game.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
  return game.isCheckmate();
}

/** Null when the puzzle passes; otherwise why it was rejected. */
export async function checkPuzzle(
  fen: string,
  moves: string[],
  search: Search,
): Promise<string | null> {
  // moves[0] is the opponent's setup move; the player moves at odd indexes.
  for (let i = 1; i < moves.length; i += 2) {
    const played = moves.slice(0, i);
    const answer = moves[i]!;
    const last = i >= moves.length - 2;
    const mates = givesMate(fen, [...played, answer]);
    if (last && mates) continue;
    const lines = await search({ fen, moves: played });
    const [best, second] = lines;
    if (!best) return `move ${i}: no engine line`;
    if (best.pv[0] !== answer) return `move ${i}: engine prefers ${best.pv[0]} to ${answer}`;
    if (second) {
      const mover = new Chess(fen);
      for (const m of played)
        mover.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
      const side = mover.turn();
      const gap = forMover(best.score, side) - forMover(second.score, side);
      if (gap < MIN_GAP) return `move ${i}: ${second.pv[0]} is about as good (gap ${gap})`;
    }
  }
  return null;
}
