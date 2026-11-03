// Lesson puzzles bundled in the page, from the lichess puzzle database (CC0).
// The file is built by scripts/puzzles/build-puzzles.ts (the "Lesson puzzles"
// GitHub workflow), and every puzzle in it was checked by the rules and by
// Stockfish before it was kept.

import { Chess } from "chess.js";
import data from "../data/puzzles.json";
import type { LessonTheme } from "./select";

/** [id, FEN before the opponent's move, moves (UCI, space separated), rating] */
export type PuzzleTuple = [string, string, string, number];

export interface PuzzleFile {
  v: 1;
  /** Date the file was built; null while no puzzles are bundled yet. */
  generated: string | null;
  source?: string;
  t: Partial<Record<LessonTheme, PuzzleTuple[]>>;
}

/**
 * What a puzzle asks: a lesson theme (find the one best move), "safe": any
 * move that doesn't lose material counts (lesson 2), or "own": find the one
 * best move in a position written for the lesson. Safe and own positions are
 * written in the lesson, never bundled.
 */
export type PuzzleTheme = LessonTheme | "safe" | "own";

/**
 * Every kind of exercise position: a puzzle, a position played out against
 * the engine ("play"), or an opening drill ("drill"). Play and drill positions
 * have no setup move; a drill's solution is the book line.
 */
export type ExerciseTheme = PuzzleTheme | "play" | "drill";

export interface Puzzle {
  id: string;
  theme: ExerciseTheme;
  /** The position before the opponent's move that sets the puzzle up. */
  fen: string;
  /** The opponent's move the page plays first (UCI); "" when there is none (play and drill). */
  setup: string;
  /** The answer: the player's moves and the opponent's replies (UCI). In a "safe" exercise, one safe move. */
  solution: string[];
  rating: number;
}

export const PUZZLES = data as PuzzleFile;

export function toPuzzle(theme: ExerciseTheme, [id, fen, moves, rating]: PuzzleTuple): Puzzle {
  const [setup = "", ...solution] = moves.split(" ");
  return { id, theme, fen, setup, solution, rating };
}

/** The theme's puzzles, easiest first. */
export function puzzlesFor(
  theme: ExerciseTheme,
  opts: { maxRating?: number } = {},
  file: PuzzleFile = PUZZLES,
): Puzzle[] {
  if (theme === "safe" || theme === "own" || theme === "play" || theme === "drill") return [];
  return (file.t[theme] ?? [])
    .map((t) => toPuzzle(theme, t))
    .filter((p) => opts.maxRating === undefined || p.rating <= opts.maxRating);
}

/** The position the player sees: after the opponent's setup move. */
export function startOf(p: Puzzle): string {
  const game = new Chess(p.fen);
  if (!p.setup) return game.fen();
  game.move({ from: p.setup.slice(0, 2), to: p.setup.slice(2, 4), promotion: p.setup[4] });
  return game.fen();
}
