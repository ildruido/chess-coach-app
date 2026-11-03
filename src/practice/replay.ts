// Stepping through a saved game: the position after any number of moves.
// No DOM, unit tested.
import { gameAt } from "../chess/notation";
import { moveNumber } from "../coach/review";

export interface ReplayStep {
  /** Moves played so far (0 = the starting position). */
  ply: number;
  fen: string;
  lastMove?: [string, string];
  /** "Start position", or "After 12... Nf6". */
  label: string;
}

/** The position after `ply` moves of `moves`, with `ply` kept within the game. */
export function replayAt(moves: readonly string[], ply: number): ReplayStep {
  const n = Math.max(0, Math.min(moves.length, Math.trunc(ply) || 0));
  const game = gameAt({ moves: moves.slice(0, n) });
  if (n === 0) return { ply: 0, fen: game.fen(), label: "Start position" };
  const last = moves[n - 1]!;
  const san = game.history()[n - 1]!;
  return {
    ply: n,
    fen: game.fen(),
    lastMove: [last.slice(0, 2), last.slice(2, 4)],
    label: `After ${moveNumber(n - 1)} ${san}${n === moves.length ? " (the last move)" : ""}`,
  };
}
