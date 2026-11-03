// "Coach suggests": which lessons to take next, from the mistakes in Ale's
// reviewed games and the levels played. No coach call; fixed wording only.
// Pure, unit tested.
import { levelById, LEVELS } from "../engine/strength";
import type { HistoryRecord } from "../storage/history";
import type { Lesson } from "./lesson";
import { lessonStatus, nextOnPath } from "./lesson-list";
import { MISTAKES, type MistakeKind, tallyMistakes } from "./mistakes";
import type { LessonProgress } from "./progress";

export const MAX_SUGGESTIONS = 3;

export interface Suggestion {
  lesson: Lesson;
  reason: string;
  practiseAgain: boolean;
}

export interface MistakeLine {
  kind: MistakeKind;
  label: string;
  tip: string;
  games: number;
  of: number;
  lesson: Lesson | null;
}

export interface Advice {
  /** Reviewed games the advice is based on. */
  reviewed: number;
  suggestions: Suggestion[];
  mistakes: MistakeLine[];
  /** Name of the next level when Ale is ready for it, else null. */
  harder: string | null;
  /** Shown when no game is reviewed yet. */
  nextOnPath: Lesson | null;
}

const REASON: Record<MistakeKind, string> = {
  hanging: "You left a piece to be taken",
  "missed-mate": "You missed a checkmate",
  "missed-free-piece": "You missed a free piece",
  "missed-fork": "You missed a fork",
  "opening-slip": "You slipped in the opening",
};

const games = (n: number, of: number) =>
  of === 1 ? "in your reviewed game" : `in ${n} of your last ${of} reviewed games`;

/** The next level up, when the newest 3 games were all wins at the highest level played. */
export function harderOpponent(records: readonly HistoryRecord[]): string | null {
  const newest = [...records].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)).slice(0, 3);
  if (newest.length < 3) return null;
  const max = Math.max(...records.map((r) => r.level));
  if (!newest.every((r) => r.level === max && r.outcome === "win")) return null;
  const next = LEVELS.find((l) => l.id === max + 1);
  return next ? levelById(next.id).name : null;
}

export function buildAdvice(
  records: readonly HistoryRecord[],
  saved: ReadonlyMap<string, LessonProgress>,
  path: readonly Lesson[],
  lessons: readonly Lesson[],
): Advice {
  const { reviewed, tallies } = tallyMistakes(records);
  const byId = (id: string) => lessons.find((l) => l.id === id) ?? null;
  const mistakes: MistakeLine[] = tallies.slice(0, 3).map((t) => ({
    kind: t.kind,
    label: MISTAKES[t.kind].label,
    tip: MISTAKES[t.kind].tip,
    games: t.games,
    of: t.of,
    lesson: byId(MISTAKES[t.kind].lessonId),
  }));
  const suggestions: Suggestion[] = [];
  for (const t of tallies) {
    const lesson = byId(MISTAKES[t.kind].lessonId);
    if (!lesson) continue;
    const p = saved.get(lesson.id);
    const done = lessonStatus(lesson, p).doneBefore;
    if (done && !(p && t.latest > p.updatedAt)) continue;
    suggestions.push({
      lesson,
      reason: `${REASON[t.kind]} ${games(t.games, t.of)}.`,
      practiseAgain: done,
    });
    if (suggestions.length === MAX_SUGGESTIONS) break;
  }
  return {
    reviewed,
    suggestions,
    mistakes,
    harder: harderOpponent(records),
    nextOnPath: reviewed === 0 ? nextOnPath(path, saved) : null,
  };
}
