// Where the knowledge base lives (CC-031). Features never touch this file: they
// go through KnowledgeBase (book.ts). Today the backend is the platform `db` (the
// server's database). The knowledge base lives in the shared area (coach-kb/,
// open to every signed-in player), not under data/users/..., so the engineer
// can read the questions asked when updating lessons.
//
// db layout: coach-kb/<domain>.<group>/entries/<id>, one document per entry.
// The document coach-kb/<domain>.<group> itself only carries migration markers.

import { withRetry } from "../storage/game-store";
import { domainOf, type KbEntry, parseEntry } from "./entry";
import { fromSavedAnswer, oldAnswersPath, parseSavedAnswer } from "./migrate";

/** Most entries loaded for one group, newest first. */
export const MAX_LOADED = 500;

export interface KbBackend {
  load(domain: string, group: string): Promise<KbEntry[]>;
  save(entry: KbEntry): Promise<void>;
}

export const groupPath = (domain: string, group: string) => `coach-kb/${domain}.${group}`;
export const entriesPath = (domain: string, group: string) => `${groupPath(domain, group)}/entries`;

export class DbBackend implements KbBackend {
  constructor(private readonly db: DbApi) {}

  async load(domain: string, group: string): Promise<KbEntry[]> {
    // A migration that fails is retried on the next visit; the entries already there still load.
    if (domain === "lesson") await this.migrateLesson(group).catch(() => undefined);
    const q = this.db
      .collection(entriesPath(domain, group))
      .orderBy("createdAt", "desc")
      .limit(MAX_LOADED);
    const snap = await withRetry(() => q.get());
    return snap.docs
      .map((d) => parseEntry(d.data()))
      .filter((e): e is KbEntry => !!e && e.group === group && domainOf(e.kind) === domain);
  }

  save(e: KbEntry): Promise<void> {
    const path = `${entriesPath(domainOf(e.kind), e.group)}/${e.id}`;
    return withRetry(() => this.db.doc(path).set({ ...e }));
  }

  /** Copies a lesson's old saved answers over, once. */
  private async migrateLesson(lessonId: string): Promise<void> {
    const marker = this.db.doc(groupPath("lesson", lessonId));
    const done = await withRetry(() => marker.get());
    if ((done.data() as { migrated?: boolean } | undefined)?.migrated) return;
    const q = this.db
      .collection(oldAnswersPath(lessonId))
      .orderBy("createdAt", "desc")
      .limit(MAX_LOADED);
    const snap = await withRetry(() => q.get());
    // An earlier, interrupted copy may have been voted on since: never overwrite those.
    const have = await withRetry(() =>
      this.db.collection(entriesPath("lesson", lessonId)).limit(MAX_LOADED).get(),
    );
    const ids = new Set(have.docs.map((d) => d.id));
    for (const d of snap.docs) {
      const old = parseSavedAnswer(d.data());
      if (old && old.lessonId === lessonId && !ids.has(old.id)) {
        await this.save(fromSavedAnswer(old));
      }
    }
    await withRetry(() => marker.set({ migrated: true }));
  }
}
