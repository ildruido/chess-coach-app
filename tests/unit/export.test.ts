import { describe, expect, it } from "vitest";
import { collectExport } from "../../src/export/collect";
import {
  buildExport,
  EXPORT_FORMAT,
  exportFilename,
  serializeExport,
  summaryText,
} from "../../src/export/export-data";
import { bucketOf } from "../../src/kb/contexts";
import type { KbEntry } from "../../src/kb/entry";
import { LESSONS } from "../../src/lessons/catalog";
import { newProgress } from "../../src/lessons/progress";
import { parseHistoryRecord, type HistoryRecord } from "../../src/storage/history";
import { saveFailureText } from "../../src/export/export-panel";
import { newSavedGame } from "../../src/storage/saved-game";
import { fakeDb } from "./fixtures/fake-db";

const U = "u_ale";
const at = "2026-10-07T09:30:00.000Z";

const record = (id: string, finishedAt = at): HistoryRecord => ({
  version: 1,
  id,
  moves: ["e2e4", "e7e5"],
  level: 1,
  color: "white",
  hintMode: "tell",
  hints: [],
  resigned: true,
  createdAt: at,
  finishedAt,
  outcome: "loss",
  result: "You resigned. The engine wins.",
});

const entry = (over: Partial<KbEntry> = {}): KbEntry => ({
  v: 2,
  id: "a1",
  kind: "hint",
  group: "ab",
  ctx: "c",
  wide: false,
  text: "",
  answer: "Look at the centre.",
  createdAt: at,
  reuses: 0,
  vote: 0,
  meta: {},
  ...over,
});

describe("export file", () => {
  it("names the file after the day and counts what is inside", () => {
    expect(exportFilename(new Date(2026, 9, 11))).toBe("chess-coach-export-2026-10-11.json");
    const g = newSavedGame(new Date(at));
    const f = buildExport(
      {
        currentGame: g,
        practiceGame: null,
        history: [record("g1"), record("g1"), record("g2")],
        lessonProgress: [],
        coachAnswers: [entry({ vote: 1 }), entry({ vote: -1 })],
        skipped: 2,
        unreadable: [],
      },
      "0.18.0",
      new Date(at),
    );
    expect(f).toMatchObject({
      format: EXPORT_FORMAT,
      formatVersion: 1,
      appVersion: "0.18.0",
      exportedAt: at,
    });
    expect(f.counts).toEqual({ games: 1, history: 2, lessons: 0, coachAnswers: 1, skipped: 2 });
    expect(f.coachAnswers[0]!.vote).toBe(1);
    expect(JSON.parse(serializeExport(f))).toEqual(JSON.parse(JSON.stringify(f)));
  });

  it("summarises in plain words", () => {
    expect(summaryText({ games: 1, history: 1, lessons: 0, coachAnswers: 3, skipped: 0 })).toBe(
      "1 game in progress, 1 past game, 0 lessons, 3 saved coach answers.",
    );
    expect(
      summaryText({ games: 0, history: 0, lessons: 0, coachAnswers: 0, skipped: 1 }),
    ).toContain("1 item could not be read and was left out.");
  });
});

describe("collectExport", () => {
  it("gathers games, history and lessons, never the shared coach answers, and counts what it cannot read", async () => {
    const fake = fakeDb();
    const db = fake.db;
    const lesson = LESSONS[0]!;
    await db.doc(`data/users/${U}/practice-game`).set({ ...newSavedGame(new Date(at)) });
    await db.doc(`data/users/${U}/current-game`).set({ nonsense: true });
    await db.doc(`data/users/${U}/history/games/g1`).set({ ...record("g1") });
    await db.doc(`data/users/${U}/history/games/g2`).set({ ...record("g2"), outcome: "won" });
    await db.doc(`data/users/${U}/lessons/progress/${lesson.id}`).set({ ...newProgress(lesson) });
    const hint = entry({ id: "h1", group: bucketOf("x") });
    await db.doc(`coach-kb/hint.${hint.group}/entries/h1`).set({ ...hint });
    const ask = entry({ id: "q1", kind: "ask", group: lesson.id });
    await db.doc(`coach-kb/lesson.${lesson.id}/entries/q1`).set({ ...ask });
    // Another user's data and the shared areas are not picked up.
    await db.doc(`data/users/other/history/games/g9`).set({ ...record("g9") });
    await db.doc(`coach-kb/hint.00/entries/bad`).set({ ...hint, id: "bad", group: "zz" });
    // An old (CC-027) answer that the knowledge base never received.
    await db.doc(`lesson-answers/${lesson.id}/answers/old1`).set({
      v: 1,
      id: "old1",
      lessonId: lesson.id,
      lessonVersion: 1,
      kind: "ask",
      scope: "idea",
      place: "step:0",
      bestMove: null,
      question: "Why?",
      answer: "Because.",
      createdAt: at,
      reuses: 0,
      vote: 0,
    });

    const parts = await collectExport(db, U);
    expect(parts.practiceGame?.moves).toEqual([]);
    expect(parts.currentGame).toBeNull();
    expect(parts.history.map((r) => r.id)).toEqual(["g1"]);
    expect(parts.lessonProgress.map((p) => p.lessonId)).toEqual([lesson.id]);
    expect(parts.coachAnswers).toEqual([]);
    expect(parts.skipped).toBe(2);
    expect(parts.unreadable.map((u) => u.path).sort()).toEqual(
      [`data/users/${U}/current-game`, `data/users/${U}/history/games/g2`].sort(),
    );
    expect(parts.unreadable.find((u) => u.path.endsWith("current-game"))?.data).toEqual({
      nonsense: true,
    });
    for (const r of parts.history)
      expect(parseHistoryRecord(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });

  it("stops when a collection may have been cut short", async () => {
    const fake = fakeDb();
    for (let i = 0; i < 1000; i++) {
      await fake.db.doc(`data/users/${U}/history/games/g${i}`).set({ ...record(`g${i}`) });
    }
    await expect(collectExport(fake.db, U)).rejects.toMatchObject({ code: "too_many" });
  });

  it("stops when a read fails, instead of producing an incomplete file", async () => {
    const fake = fakeDb();
    const db = fake.db;
    fake.failNext.push("not_granted");
    await expect(collectExport(db, U)).rejects.toMatchObject({ code: "not_granted" });
  });
});

describe("save failures", () => {
  it("only invites a retry where one can help", () => {
    expect(saveFailureText("declined")).toContain("try again");
    expect(saveFailureText("unavailable")).not.toContain("try again");
    expect(saveFailureText("too_large")).toContain("too big");
  });
});
