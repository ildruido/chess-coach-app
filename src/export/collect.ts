// Reads everything the player has kept from the db, for "Export my data" (CC-043f).
// Every record goes through the page's own parser, so the file holds only data the
// page itself would accept. A failed read stops the export: a quietly incomplete file
// is worse than none, because the file may be the player's only copy (the
// preview database can be wiped).

import { LESSONS } from "../lessons/catalog";
import { parseProgress } from "../lessons/progress";
import { currentGamePath, withRetry } from "../storage/game-store";
import { historyPath } from "../storage/history-store";
import { lessonPath } from "../storage/lesson-store";
import { parseHistoryRecord } from "../storage/history";
import { parseSavedGame } from "../storage/saved-game";
import type { ExportParts } from "./export-data";

const MAX_DOCS = 1000;
const PARALLEL = 8;

/** Runs `fn` over `items`, a few at a time. */
async function inBatches<T>(items: readonly T[], fn: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, worker));
}

export async function collectExport(db: DbApi, userId: string): Promise<ExportParts> {
  let skipped = 0;
  const get = (path: string) => withRetry(() => db.doc(path).get());
  const unreadable: ExportParts["unreadable"] = [];
  const drop = (path: string, data: unknown) => {
    skipped++;
    unreadable.push({ path, data });
  };
  /** A full page may be cut short: stop rather than write a file that quietly misses records. */
  const list = async (path: string) => {
    const snap = await withRetry(() => db.collection(path).limit(MAX_DOCS).get());
    if (snap.docs.length >= MAX_DOCS) throw { code: "too_many", message: path };
    return snap;
  };

  const game = async (slot: "current-game" | "practice-game") => {
    const snap = await get(currentGamePath(userId, slot));
    if (!snap.exists) return null;
    const g = parseSavedGame(snap.data());
    if (!g) drop(currentGamePath(userId, slot), snap.data());
    return g;
  };
  const [currentGame, practiceGame] = await Promise.all([
    game("current-game"),
    game("practice-game"),
  ]);

  const history = (await list(historyPath(userId))).docs.flatMap((d) => {
    const r = parseHistoryRecord(d.data());
    if (r && r.id === d.id) return [r];
    drop(`${historyPath(userId)}/${d.id}`, d.data());
    return [];
  });

  const lessonProgress: ExportParts["lessonProgress"] = [];
  await inBatches(LESSONS, async (lesson) => {
    const snap = await get(lessonPath(userId, lesson.id));
    if (!snap.exists) return;
    const p = parseProgress(snap.data(), lesson);
    if (p) lessonProgress.push(p);
    else drop(lessonPath(userId, lesson.id), snap.data());
  });

  const order = (a: { lessonId: string }, b: { lessonId: string }) =>
    a.lessonId.localeCompare(b.lessonId);
  return {
    currentGame,
    practiceGame,
    history,
    lessonProgress: lessonProgress.sort(order),
    // The shared coach answers are the server's, not the player's (CC-067): never exported.
    coachAnswers: [],
    skipped,
    unreadable,
  };
}
