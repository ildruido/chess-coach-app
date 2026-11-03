// Runs the engine over a finished game for the post-game review: one search
// per position, from the start to the final one, with a few candidate lines
// so a played candidate is judged within the search that found it. No DOM,
// unit tested with a fake engine.
import type { SearchLimits } from "../engine/stockfish";
import type { Analysis, Position } from "../engine/uci";
import { REVIEW_LINES, reviewMovetime } from "./review";

export interface Analyser {
  analyse(position: Position, limits: SearchLimits): Promise<Analysis>;
}

/** The review was stopped. */
export class ReviewStopped extends Error {
  constructor() {
    super("The review was stopped.");
    this.name = "ReviewStopped";
  }
}

/**
 * The engine's analysis of every position of the game: `result[i]` is the
 * position after the first `i` moves. Stops between searches when `signal`
 * aborts (rejecting with ReviewStopped).
 */
export async function analyseGame(
  engine: Analyser,
  moves: readonly string[],
  opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<Analysis[]> {
  const movetime = reviewMovetime(moves.length);
  const total = moves.length + 1;
  const out: Analysis[] = [];
  for (let i = 0; i < total; i++) {
    if (opts.signal?.aborted) throw new ReviewStopped();
    opts.onProgress?.(i, total);
    out.push(
      await engine.analyse({ moves: moves.slice(0, i) }, { movetime, multiPv: REVIEW_LINES }),
    );
  }
  if (opts.signal?.aborted) throw new ReviewStopped();
  opts.onProgress?.(total, total);
  return out;
}
