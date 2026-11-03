// The saved shape of a game in progress, and a strict reader for it.
// Stored data comes back from outside the page, so it is validated, never
// trusted. Pure, unit tested.
import { gameAt } from "../chess/notation";
import type { HintStage } from "../coach/hint";
import type { HintMode } from "../coach/hint-session";
import { LEVELS } from "../engine/strength";

export const SAVED_GAME_VERSION = 1;

/** One hint the player used: before which half-move, which step, in which mode. */
export interface HintRecord {
  /** Moves played when the hint was given (0 = the starting position). */
  ply: number;
  step: HintStage;
  mode: HintMode;
}

export interface SavedGame {
  version: typeof SAVED_GAME_VERSION;
  /** Practice games: stable id, also the game's document id in the history. */
  id?: string;
  /** Moves from the start position, in UCI ("e2e4"). */
  moves: string[];
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
  /** Practice games: the engine's level (1-6) and the player's color. */
  level?: number;
  color?: "white" | "black";
  /** Practice games: the player resigned. */
  resigned?: boolean;
  /** Practice games: hints used, in order. Kept after a take back: they were still used. */
  hints?: HintRecord[];
  /** Practice games: Tell me or Ask me, chosen at the start and fixed for the game. */
  hintMode?: HintMode;
}

const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
/** A game id: also a db path segment, so letters, digits, `_` and `-` only. */
export const GAME_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_MOVES = 1000;
/** Hints kept per game; older ones are dropped beyond this (take backs can repeat them). */
export const MAX_HINTS = 5 * MAX_MOVES;
const STEPS: readonly string[] = ["question", "plan", "piece", "move"];

const isHintRecord = (v: unknown): v is HintRecord => {
  if (!v || typeof v !== "object") return false;
  const h = v as Record<string, unknown>;
  return (
    Number.isInteger(h.ply) &&
    (h.ply as number) >= 0 &&
    (h.ply as number) <= MAX_MOVES &&
    STEPS.includes(h.step as string) &&
    (h.mode === "tell" || h.mode === "ask")
  );
};

export function newSavedGame(now: Date): SavedGame {
  const at = now.toISOString();
  return { version: SAVED_GAME_VERSION, moves: [], createdAt: at, updatedAt: at };
}

/** A new game id: the time, then random letters, so ids sort roughly by age. */
export function newGameId(now: Date = new Date(), rng: () => number = Math.random): string {
  const rand = Array.from({ length: 6 }, () => Math.floor(rng() * 36).toString(36)).join("");
  return `g-${now.getTime().toString(36)}-${rand}`;
}

export function withMoves(game: SavedGame, moves: string[], now: Date): SavedGame {
  return { ...game, moves: [...moves], updatedAt: now.toISOString() };
}

const isIsoDate = (v: unknown): v is string =>
  typeof v === "string" && !Number.isNaN(Date.parse(v));

/**
 * Returns the saved game if `data` is a valid one, else null. A game whose
 * moves are not legal from the start position is rejected as a whole, so a
 * corrupted save can never put an impossible position on the board.
 */
export function parseSavedGame(data: unknown): SavedGame | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.version !== SAVED_GAME_VERSION) return null;
  if (!Array.isArray(d.moves) || d.moves.length > MAX_MOVES) return null;
  if (!d.moves.every((m) => typeof m === "string" && UCI.test(m))) return null;
  if (!isIsoDate(d.createdAt) || !isIsoDate(d.updatedAt)) return null;
  if (d.id !== undefined && (typeof d.id !== "string" || !GAME_ID.test(d.id))) return null;
  if (d.level !== undefined && !LEVELS.some((l) => l.id === d.level)) return null;
  if (d.color !== undefined && d.color !== "white" && d.color !== "black") return null;
  if (d.resigned !== undefined && typeof d.resigned !== "boolean") return null;
  if (d.hints !== undefined && (!Array.isArray(d.hints) || !d.hints.every(isHintRecord))) {
    return null;
  }
  if (d.hintMode !== undefined && d.hintMode !== "tell" && d.hintMode !== "ask") return null;
  const moves = d.moves as string[];
  try {
    gameAt({ moves });
  } catch {
    return null;
  }
  return {
    version: SAVED_GAME_VERSION,
    ...(d.id !== undefined && { id: d.id as string }),
    moves,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    ...(d.level !== undefined && { level: d.level as number }),
    ...(d.color !== undefined && { color: d.color as "white" | "black" }),
    ...(d.resigned !== undefined && { resigned: d.resigned as boolean }),
    ...(d.hints !== undefined && {
      hints: (d.hints as HintRecord[])
        .slice(-MAX_HINTS)
        .map(({ ply, step, mode }) => ({ ply, step, mode })),
    }),
    ...(d.hintMode !== undefined && { hintMode: d.hintMode as HintMode }),
  };
}

/** "4 Oct 2026, 21:40" in the player's locale and time zone. */
export function formatSavedAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
