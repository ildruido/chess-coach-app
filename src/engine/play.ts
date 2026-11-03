// The engine's move at a playing level: candidate lines from Stockfish, then
// a human-like choice among them (see strength.ts).
import type { StockfishEngine } from "./stockfish";
import { type Level, pickMove } from "./strength";
import { type Position, sideAfter } from "./uci";

export interface LevelMove {
  /** UCI move, or null when there are no legal moves. */
  move: string | null;
  ms: number;
}

export async function levelMove(
  engine: StockfishEngine,
  position: Position,
  level: Level,
  rng: () => number = Math.random,
): Promise<LevelMove> {
  const t0 = performance.now();
  // A fresh search every time, so the level never borrows a deeper search's results.
  const a = await engine.analyse(position, {
    depth: level.depth,
    multiPv: level.multiPv,
    clearHash: true,
  });
  // If no candidate line could be read, fall back to the engine's own move.
  const move = pickMove(a.lines ?? [], sideAfter(position), level, rng) ?? a.bestMove;
  return { move, ms: performance.now() - t0 };
}
