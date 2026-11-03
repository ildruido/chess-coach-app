// What the lesson list shows for each lesson: done, in progress or not
// started, and which lesson "Continue" opens. Pure logic, no DOM.

import type { Lesson } from "./lesson";
import { isFinished, type LessonProgress, scoreText } from "./progress";

export type LessonState = "done" | "inProgress" | "notStarted";

export interface LessonStatus {
  state: LessonState;
  /** Finished at least once, even if started again since. */
  doneBefore: boolean;
  /** The status line on the lesson's card. */
  text: string;
  /** The card's button. */
  button: "Start" | "Resume" | "Do it again";
}

/** A lesson counts as started once Ale has moved past its first step or exercise. */
function started(p: LessonProgress): boolean {
  return p.step > 0 || p.exercise > 0;
}

export function lessonStatus(lesson: Lesson, p: LessonProgress | undefined): LessonStatus {
  const finished = !!p && isFinished(p, lesson);
  const doneBefore = !!p && (finished || p.runs > 0);
  if (p && !finished && started(p)) {
    const where = `In progress: step ${p.step + 1} of ${lesson.steps.length}.`;
    return {
      state: "inProgress",
      doneBefore,
      text: doneBefore ? `${where} Done before.` : where,
      button: "Resume",
    };
  }
  if (p && doneBefore) {
    const last = finished ? p.results : p.lastResults;
    return {
      state: "done",
      doneBefore,
      text: last?.length ? `Done. Last time: ${lowerFirst(scoreText(last))}` : "Done.",
      button: "Do it again",
    };
  }
  return { state: "notStarted", doneBefore, text: "Not started.", button: "Start" };
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** How many of the lessons have been finished at least once. */
export function doneCount(
  lessons: readonly Lesson[],
  saved: ReadonlyMap<string, LessonProgress>,
): number {
  return lessons.filter((l) => lessonStatus(l, saved.get(l.id)).doneBefore).length;
}

/** The lesson in progress that Ale used last, for the "Continue" button; null when none. */
export function continueTarget(
  lessons: readonly Lesson[],
  saved: ReadonlyMap<string, LessonProgress>,
): Lesson | null {
  let best: { lesson: Lesson; at: string } | null = null;
  for (const l of lessons) {
    const p = saved.get(l.id);
    if (!p || lessonStatus(l, p).state !== "inProgress") continue;
    if (!best || p.updatedAt > best.at) best = { lesson: l, at: p.updatedAt };
  }
  return best?.lesson ?? null;
}

/** The first lesson on the path that has not been finished yet (null when the whole path is done). */
export function nextOnPath(
  path: readonly Lesson[],
  saved: ReadonlyMap<string, LessonProgress>,
): Lesson | null {
  return path.find((l) => !lessonStatus(l, saved.get(l.id)).doneBefore) ?? null;
}
