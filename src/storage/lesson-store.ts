// Lesson progress in the player's private db area:
// data/users/<id>/lessons/progress/<lessonId>, one document per lesson. A
// document path has an even number of segments (collection/document pairs).

import type { Lesson } from "../lessons/lesson";
import { type LessonProgress, parseProgress } from "../lessons/progress";
import { openUserDb, type StoreUnavailable, withRetry } from "./game-store";

export function lessonPath(userId: string, lessonId: string): string {
  return `data/users/${userId}/lessons/progress/${lessonId}`;
}

export interface LessonStore {
  load(lesson: Lesson): Promise<LessonProgress | null>;
  save(p: LessonProgress): Promise<void>;
}

export class DbLessonStore implements LessonStore {
  constructor(
    private readonly db: DbApi,
    private readonly userId: string,
  ) {}

  async load(lesson: Lesson): Promise<LessonProgress | null> {
    const snap = await withRetry(() => this.db.doc(lessonPath(this.userId, lesson.id)).get());
    return snap.exists ? parseProgress(snap.data(), lesson) : null;
  }

  save(p: LessonProgress): Promise<void> {
    return withRetry(() => this.db.doc(lessonPath(this.userId, p.lessonId)).set({ ...p }));
  }
}

export async function openLessonStore(): Promise<
  { ok: true; store: LessonStore } | { ok: false; reason: StoreUnavailable }
> {
  const u = await openUserDb();
  return u.ok ? { ok: true, store: new DbLessonStore(u.db, u.userId) } : u;
}
