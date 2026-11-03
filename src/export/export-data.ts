// The "Export my data" file (CC-043f): everything the player has kept, in one JSON
// file the web app's import (CC-043g) reads. Pure logic, no DOM and no storage.
//
// The file is versioned (`formatVersion`). Each record is the same shape the page
// stores, and was already checked by the page's own parser when it was read, so the
// import can check it again the same way before showing anything.

import type { KbEntry } from "../kb/entry";
import type { LessonProgress } from "../lessons/progress";
import type { HistoryRecord } from "../storage/history";
import type { SavedGame } from "../storage/saved-game";

export const EXPORT_FORMAT = "chess-coach-export";
export const EXPORT_FORMAT_VERSION = 1;

export interface ExportParts {
  currentGame: SavedGame | null;
  practiceGame: SavedGame | null;
  history: HistoryRecord[];
  lessonProgress: LessonProgress[];
  coachAnswers: KbEntry[];
  /** Stored documents that this version could not read, so they are not in the file. */
  skipped: number;
  /** Raw copies of those documents, so nothing is lost; the import decides what to do with them. */
  unreadable: { path: string; data: unknown }[];
}

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  formatVersion: typeof EXPORT_FORMAT_VERSION;
  appVersion: string;
  exportedAt: string;
  counts: {
    games: number;
    history: number;
    lessons: number;
    coachAnswers: number;
    skipped: number;
  };
  savedGames: { currentGame: SavedGame | null; practiceGame: SavedGame | null };
  history: HistoryRecord[];
  lessonProgress: LessonProgress[];
  coachAnswers: KbEntry[];
  unreadable: { path: string; data: unknown }[];
}

export function buildExport(parts: ExportParts, appVersion: string, now: Date): ExportFile {
  // The first copy of an id wins: a migrated answer may have been voted on since.
  const byId = <T extends { id: string }>(xs: T[]) => {
    const seen = new Set<string>();
    return xs.filter((x) => !seen.has(x.id) && !!seen.add(x.id));
  };
  const coachAnswers = byId(parts.coachAnswers).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  const history = byId(parts.history);
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    appVersion,
    exportedAt: now.toISOString(),
    counts: {
      games: Number(!!parts.currentGame) + Number(!!parts.practiceGame),
      history: history.length,
      lessons: parts.lessonProgress.length,
      coachAnswers: coachAnswers.length,
      skipped: parts.skipped,
    },
    savedGames: { currentGame: parts.currentGame, practiceGame: parts.practiceGame },
    history,
    lessonProgress: parts.lessonProgress,
    coachAnswers,
    unreadable: parts.unreadable,
  };
}

/** chess-coach-export-2026-10-11.json (the date in the player's own time zone). */
export function exportFilename(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `chess-coach-export-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`;
}

export function serializeExport(file: ExportFile): string {
  return JSON.stringify(file);
}

/** One plain sentence about what is in the file. */
export function summaryText(c: ExportFile["counts"]): string {
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const parts = [
    n(c.games, "game in progress", "games in progress"),
    n(c.history, "past game", "past games"),
    n(c.lessons, "lesson", "lessons"),
    n(c.coachAnswers, "saved coach answer", "saved coach answers"),
  ];
  const skipped = c.skipped
    ? ` ${n(c.skipped, "item", "items")} could not be read and ${c.skipped === 1 ? "was" : "were"} left out.`
    : "";
  return `${parts.join(", ")}.${skipped}`;
}
