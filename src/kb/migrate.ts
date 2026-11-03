// Moves the lesson answers of CC-027 (lesson-answers/<lessonId>/answers) onto
// the knowledge base. Same ids, so running it twice changes nothing; the old
// documents are left in place (a later release can clean them up).

import { type AskPlace, lessonCtx } from "./contexts";
import type { KbEntry } from "./entry";

/** The CC-027 record. */
export interface SavedAnswer {
  v: 1;
  id: string;
  lessonId: string;
  lessonVersion: number;
  kind: "ask" | "reword";
  scope: "idea" | "place";
  place: string;
  bestMove: string | null;
  question: string;
  answer: string;
  createdAt: string;
  reuses: number;
  vote: -1 | 0 | 1;
}

export const oldAnswersPath = (lessonId: string) => `lesson-answers/${lessonId}/answers`;

/** Reads an old record; anything malformed is dropped. */
export function parseSavedAnswer(data: unknown): SavedAnswer | null {
  const d = data as Partial<SavedAnswer> | undefined;
  if (!d || d.v !== 1) return null;
  const str = (x: unknown) => typeof x === "string" && x.length > 0;
  if (![d.id, d.lessonId, d.place, d.question, d.answer, d.createdAt].every(str)) return null;
  if (d.kind !== "ask" && d.kind !== "reword") return null;
  if (d.scope !== "idea" && d.scope !== "place") return null;
  if (typeof d.lessonVersion !== "number" || typeof d.reuses !== "number") return null;
  if (d.vote !== -1 && d.vote !== 0 && d.vote !== 1) return null;
  if (d.bestMove !== null && typeof d.bestMove !== "string") return null;
  return d as SavedAnswer;
}

export function fromSavedAnswer(r: SavedAnswer): KbEntry {
  const at: AskPlace = {
    lessonId: r.lessonId,
    lessonVersion: r.lessonVersion,
    place: r.place,
    bestMove: r.bestMove,
  };
  return {
    v: 2,
    id: r.id,
    kind: r.kind,
    group: r.lessonId,
    ctx: lessonCtx(at),
    wide: r.kind === "ask" && r.scope === "idea",
    text: r.question,
    answer: r.answer,
    createdAt: r.createdAt,
    reuses: r.reuses,
    vote: r.vote,
    meta: { lessonVersion: r.lessonVersion, place: r.place, bestMove: r.bestMove },
  };
}
