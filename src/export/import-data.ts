// Reading an "Export my data" file back in (CC-043g). Pure logic, no DOM and no storage.
//
// Every record goes through the same parser the page uses when it reads its own storage,
// so a hand-edited or damaged file can only lose records, never put bad data on screen.
// The file's own `unreadable` list is not imported (the exporting version could not read it).

import { LESSONS } from "../lessons/catalog";
import { parseProgress } from "../lessons/progress";
import { currentGamePath, type GameSlot } from "../storage/game-store";
import { historyPath } from "../storage/history-store";
import { lessonPath } from "../storage/lesson-store";
import { parseHistoryRecord } from "../storage/history";
import { parseSavedGame } from "../storage/saved-game";
import { EXPORT_FORMAT, EXPORT_FORMAT_VERSION } from "./export-data";

/** Largest file the page will read; a real export of 1000 games is a few MB. */
export const MAX_IMPORT_BYTES = 30 * 1024 * 1024;
/** The server refuses documents over 64 KB (docs/API.md). */
const MAX_DOC_BYTES = 60 * 1024;

export type Section = "games" | "history" | "lessons" | "coachAnswers";

/** One document to write, and which part of the file it came from. */
export interface PlannedDoc {
  section: Section;
  path: string;
  data: Record<string, unknown>;
}

export interface ImportPlan {
  docs: PlannedDoc[];
  /** Records in the file that failed the page's checks and are left out. */
  rejected: number;
  /** What the exporting version could not read itself; never imported. */
  unreadable: number;
}

export type ParseResult =
  { ok: true; plan: ImportPlan } | { ok: false; reason: "not_json" | "not_ours" | "newer" };

export function importFailureText(reason: "not_json" | "not_ours" | "newer"): string {
  switch (reason) {
    case "not_json":
      return "That file can't be read. Pick the file saved by Export my data.";
    case "newer":
      return "That file comes from a newer version of Chess Coach, so it can't be read here yet.";
    default:
      return "That isn't a Chess Coach export file. Pick the file saved by Export my data.";
  }
}

const isObject = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);

const fits = (data: unknown) => JSON.stringify(data).length <= MAX_DOC_BYTES;

export function parseImport(text: string, userId: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not_json" };
  }
  if (!isObject(raw) || raw.format !== EXPORT_FORMAT) return { ok: false, reason: "not_ours" };
  if (raw.formatVersion !== EXPORT_FORMAT_VERSION) {
    const newer =
      typeof raw.formatVersion === "number" && raw.formatVersion > EXPORT_FORMAT_VERSION;
    return { ok: false, reason: newer ? "newer" : "not_ours" };
  }

  const docs: PlannedDoc[] = [];
  let rejected = 0;
  const add = (section: Section, path: string, record: object) => {
    const data = { ...record } as Record<string, unknown>;
    if (fits(data)) docs.push({ section, path, data });
    else rejected++;
  };
  const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

  const games = isObject(raw.savedGames) ? raw.savedGames : {};
  for (const [key, slot] of [
    ["currentGame", "current-game"],
    ["practiceGame", "practice-game"],
  ] as [string, GameSlot][]) {
    if (games[key] === null || games[key] === undefined) continue;
    const g = parseSavedGame(games[key]);
    if (g) add("games", currentGamePath(userId, slot), g);
    else rejected++;
  }

  const seen = new Set<string>();
  for (const item of list(raw.history)) {
    const r = parseHistoryRecord(item);
    if (r && !seen.has(r.id)) {
      seen.add(r.id);
      add("history", `${historyPath(userId)}/${r.id}`, r);
    } else rejected++;
  }

  const lessonSeen = new Set<string>();
  for (const item of list(raw.lessonProgress)) {
    const id = isObject(item) ? item.lessonId : undefined;
    const lesson = LESSONS.find((l) => l.id === id);
    const p = lesson ? parseProgress(item, lesson) : null;
    if (p && !lessonSeen.has(p.lessonId)) {
      lessonSeen.add(p.lessonId);
      add("lessons", lessonPath(userId, p.lessonId), p);
    } else rejected++;
  }

  // Saved coach answers in an old export are not imported: the knowledge base belongs to the
  // server (CC-131), which keeps only answers it has checked itself.

  return {
    ok: true,
    plan: { docs, rejected, unreadable: list(raw.unreadable).length },
  };
}

export interface ImportCounts {
  games: number;
  history: number;
  lessons: number;
  coachAnswers: number;
}

export const emptyCounts = (): ImportCounts => ({
  games: 0,
  history: 0,
  lessons: 0,
  coachAnswers: 0,
});

export function countDocs(docs: readonly PlannedDoc[]): ImportCounts {
  const c = emptyCounts();
  for (const d of docs) c[d.section]++;
  return c;
}

/** "2 past games, 1 lesson" style sentence; empty sections are left out. */
export function countsText(c: ImportCounts): string {
  const n = (k: number, one: string, many: string) => (k ? [`${k} ${k === 1 ? one : many}`] : []);
  const parts = [
    ...n(c.games, "game in progress", "games in progress"),
    ...n(c.history, "past game", "past games"),
    ...n(c.lessons, "lesson", "lessons"),
    ...n(c.coachAnswers, "saved coach answer", "saved coach answers"),
  ];
  return parts.length ? parts.join(", ") : "nothing";
}
