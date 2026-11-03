// Which positions an exercise step uses: the bundled puzzles for its theme
// first, then the lesson's own positions to fill any gap. Play and drill steps
// use only their own positions. Pure logic.

import { Chess } from "chess.js";
import { PUZZLES, type Puzzle, type PuzzleFile, puzzlesFor, toPuzzle } from "../puzzles/puzzles";
import type { DrillStep, ExerciseStep, PlayStep } from "./lesson";

/** The book line of a drill as UCI moves, from the start position. */
export function drillLine(step: DrillStep): string[] {
  const game = new Chess();
  return step.line.split(" ").map((san) => {
    const m = game.move(san);
    return m.from + m.to + (m.promotion ?? "");
  });
}

const playPuzzle = ([id, fen]: [string, string]): Puzzle => ({
  id,
  theme: "play",
  fen,
  setup: "",
  solution: [],
  rating: 0,
});

function ownPool(step: PlayStep | DrillStep): Puzzle[] {
  if (step.theme === "play") return step.positions.map(playPuzzle);
  const fen = new Chess().fen();
  return [{ id: "drill", theme: "drill", fen, setup: "", solution: drillLine(step), rating: 0 }];
}

/** Every position the step may use, bundled puzzles first. */
export function exercisePool(step: ExerciseStep, file: PuzzleFile = PUZZLES): Puzzle[] {
  if (step.theme === "play" || step.theme === "drill") return ownPool(step);
  const bundled = puzzlesFor(step.theme, { maxRating: step.maxRating }, file);
  return [...bundled, ...step.fallback.map((t) => toPuzzle(step.theme, t))];
}

/**
 * Picks `step.count` positions, easiest first. `seed` rotates the bundled
 * puzzles so a replayed lesson gets fresh ones; the lesson's own positions
 * only fill a gap.
 */
export function pickExercises(step: ExerciseStep, seed = 0, file: PuzzleFile = PUZZLES): Puzzle[] {
  if (step.theme === "play" || step.theme === "drill") {
    // Written in the lesson's order (easiest first), rotated on a replay.
    const own = ownPool(step);
    const from = (seed * step.count) % own.length;
    return Array.from(
      { length: Math.min(step.count, own.length) },
      (_, i) => own[(from + i) % own.length]!,
    );
  }
  const bundled = puzzlesFor(step.theme, { maxRating: step.maxRating }, file);
  const picked: Puzzle[] = [];
  if (bundled.length) {
    const start = (seed * step.count) % bundled.length;
    for (let i = 0; i < Math.min(step.count, bundled.length); i++) {
      picked.push(bundled[(start + i) % bundled.length]!);
    }
  }
  // The lesson's own positions fill the gap; with no bundled ones they rotate too.
  const own = step.fallback;
  const from = bundled.length || !own.length ? 0 : (seed * step.count) % own.length;
  for (let i = 0; i < own.length && picked.length < step.count; i++) {
    picked.push(toPuzzle(step.theme, own[(from + i) % own.length]!));
  }
  return picked.sort((a, b) => a.rating - b.rating);
}

/** Finds positions by id (saved progress), from the bundled puzzles or the lesson's own. */
export function exercisesById(
  step: ExerciseStep,
  ids: readonly string[],
  file: PuzzleFile = PUZZLES,
): Puzzle[] | null {
  const pool = exercisePool(step, file);
  const found = ids.map((id) => pool.find((p) => p.id === id));
  return found.every(Boolean) ? (found as Puzzle[]) : null;
}
