// Saved progress through a lesson, so it resumes at the same step. Pure logic.

import type { HintMode } from "../coach/hint-session";
import type { Lesson } from "./lesson";

/** How an exercise went: solved first try, solved with help (a hint or a wrong try), or skipped. */
export type ExerciseResult = "first" | "help" | "skipped";

export interface LessonProgress {
  v: 1;
  lessonId: string;
  lessonVersion: number;
  /** Index of the current step; steps.length when the lesson is finished. */
  step: number;
  /** For the current exercise step: the positions picked, and which one is next. */
  exerciseIds: string[];
  exercise: number;
  /** Results of every exercise done in this run of the lesson. */
  results: ExerciseResult[];
  /** The results of the last finished run, kept when the lesson is started again (the list shows them). */
  lastResults?: ExerciseResult[];
  hintMode: HintMode;
  /** How many times the lesson was finished; rotates the puzzles on a replay. */
  runs: number;
  updatedAt: string;
}

export function newProgress(
  lesson: Lesson,
  hintMode: HintMode = "tell",
  runs = 0,
  lastResults?: ExerciseResult[],
): LessonProgress {
  return {
    v: 1,
    lessonId: lesson.id,
    lessonVersion: lesson.version,
    step: 0,
    exerciseIds: [],
    exercise: 0,
    results: [],
    hintMode,
    runs,
    ...(lastResults && { lastResults }),
    updatedAt: new Date().toISOString(),
  };
}

const RESULTS = new Set(["first", "help", "skipped"]);

/**
 * Reads stored progress; null when it is unreadable or for another lesson. For
 * an older version of the lesson the place starts again, but the runs and the
 * last score stay, so a finished lesson still shows as done.
 */
export function parseProgress(data: unknown, lesson: Lesson): LessonProgress | null {
  const d = data as Partial<LessonProgress> | null;
  if (!d || d.v !== 1 || d.lessonId !== lesson.id) return null;
  const okInt = (n: unknown, max: number) =>
    Number.isInteger(n) && (n as number) >= 0 && (n as number) <= max;
  const okResults = (r: unknown): r is ExerciseResult[] =>
    Array.isArray(r) && r.every((x) => RESULTS.has(x as string));
  const hintMode: HintMode = d.hintMode === "ask" ? "ask" : "tell";
  if (d.lessonVersion !== lesson.version) {
    const runs = okInt(d.runs ?? 0, 1e6) ? (d.runs ?? 0) : 0;
    const last = okResults(d.lastResults) ? d.lastResults : undefined;
    return runs ? newProgress(lesson, hintMode, runs, last) : null;
  }
  if (!okInt(d.step, lesson.steps.length) || !okInt(d.exercise, 100) || !okInt(d.runs ?? 0, 1e6))
    return null;
  if (!Array.isArray(d.exerciseIds) || !d.exerciseIds.every((x) => typeof x === "string"))
    return null;
  if (!okResults(d.results)) return null;
  return {
    v: 1,
    lessonId: lesson.id,
    lessonVersion: lesson.version,
    step: d.step!,
    exerciseIds: d.exerciseIds,
    exercise: d.exercise!,
    results: d.results,
    ...(okResults(d.lastResults) && { lastResults: d.lastResults }),
    hintMode,
    runs: d.runs ?? 0,
    updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : new Date(0).toISOString(),
  };
}

export function isFinished(p: LessonProgress, lesson: Lesson): boolean {
  return p.step >= lesson.steps.length;
}

/** The score line at the end of a lesson. */
export function scoreText(results: readonly ExerciseResult[]): string {
  if (!results.length) return "No exercises done.";
  const n = (r: ExerciseResult) => results.filter((x) => x === r).length;
  const parts = [`${n("first")} solved first try`];
  if (n("help")) parts.push(`${n("help")} with help`);
  if (n("skipped")) parts.push(`${n("skipped")} skipped`);
  return `${parts.join(", ")}, out of ${results.length}.`;
}
