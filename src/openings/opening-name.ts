// Names the opening of a game from the bundled lichess openings list (CC0).
// Pure logic, no DOM: the data file is built by scripts/openings/build-openings.ts.

import { Chess } from "chess.js";
import data from "../data/openings.json";

export interface OpeningBook {
  /** Deepest ply (half-move) of any named line; no need to look further. */
  maxPly: number;
  /** Position key (see positionKey) -> "ECO|Name". */
  o: Record<string, string>;
}

export interface Opening {
  eco: string;
  name: string;
  /** Half-move at which this name was reached. */
  ply: number;
}

export const OPENINGS: OpeningBook = data;

/**
 * A FEN without the two move counters, so the same position reached by a
 * different move order (a transposition) gets the same key. The en passant
 * field is chess.js's own, which only lists a square when a capture is legal.
 */
export function positionKey(fen: string): string {
  return fen.trim().split(/\s+/).slice(0, 4).join(" ");
}

function uciMove(uci: string) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] };
}

/**
 * The deepest named position reached by these moves (UCI, from the start
 * position). Once the game leaves the book, the last name reached stays.
 * Null when no position along the way has a name.
 */
export function openingFor(
  uciMoves: readonly string[],
  book: OpeningBook = OPENINGS,
): Opening | null {
  const game = new Chess();
  let found: Opening | null = null;
  const limit = Math.min(uciMoves.length, book.maxPly);
  for (let i = 0; i < limit; i++) {
    try {
      game.move(uciMove(uciMoves[i]!));
    } catch {
      break;
    }
    const entry = book.o[positionKey(game.fen())];
    if (entry) {
      const [eco = "", name = ""] = entry.split("|");
      found = { eco, name, ply: i + 1 };
    }
  }
  return found;
}
