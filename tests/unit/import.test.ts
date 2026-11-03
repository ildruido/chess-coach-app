import { describe, expect, it } from "vitest";
import { collectExport } from "../../src/export/collect";
import { buildExport, serializeExport } from "../../src/export/export-data";
import { countsText, parseImport } from "../../src/export/import-data";
import { outcomeText } from "../../src/export/import-panel";
import { runImport } from "../../src/export/import-run";
import { bucketOf } from "../../src/kb/contexts";
import type { KbEntry } from "../../src/kb/entry";
import { LESSONS } from "../../src/lessons/catalog";
import { newProgress } from "../../src/lessons/progress";
import type { HistoryRecord } from "../../src/storage/history";
import { newSavedGame } from "../../src/storage/saved-game";
import { fakeDb } from "./fixtures/fake-db";

const FROM = "u_old";
const TO = "u_new";
const at = "2026-10-07T09:30:00.000Z";
const lesson = LESSONS[0]!;

const record = (id: string): HistoryRecord => ({
  version: 1,
  id,
  moves: ["e2e4", "e7e5"],
  level: 1,
  color: "white",
  hintMode: "tell",
  hints: [],
  resigned: true,
  createdAt: at,
  finishedAt: at,
  outcome: "loss",
  result: "You resigned. The engine wins.",
});
const entry = (over: Partial<KbEntry> = {}): KbEntry => ({
  v: 2,
  id: "h1",
  kind: "hint",
  group: bucketOf("x"),
  ctx: "c",
  wide: false,
  text: "",
  answer: "Look at the centre.",
  createdAt: at,
  reuses: 2,
  vote: 1,
  meta: {},
  ...over,
});

async function exportedFile() {
  const src = fakeDb();
  await src.db.doc(`data/users/${FROM}/practice-game`).set({ ...newSavedGame(new Date(at)) });
  await src.db.doc(`data/users/${FROM}/history/games/g1`).set({ ...record("g1") });
  await src.db.doc(`data/users/${FROM}/history/games/g2`).set({ ...record("g2") });
  await src.db
    .doc(`data/users/${FROM}/lessons/progress/${lesson.id}`)
    .set({ ...newProgress(lesson) });
  const h = entry();
  await src.db.doc(`coach-kb/hint.${h.group}/entries/h1`).set({ ...h });
  return serializeExport(buildExport(await collectExport(src.db, FROM), "0.18.0", new Date(at)));
}

const noSleep = async () => undefined;

describe("parseImport", () => {
  it("reads the export file and aims every record at the signed-in account", async () => {
    const r = parseImport(await exportedFile(), TO);
    if (!r.ok) throw new Error("expected ok");
    expect(r.plan.docs.map((d) => d.path).sort()).toEqual(
      [
        `data/users/${TO}/practice-game`,
        `data/users/${TO}/history/games/g1`,
        `data/users/${TO}/history/games/g2`,
        `data/users/${TO}/lessons/progress/${lesson.id}`,
      ].sort(),
    );
    expect(r.plan.rejected).toBe(0);
  });

  it("refuses files that are not ours or are from a newer version", () => {
    expect(parseImport("nope", TO)).toEqual({ ok: false, reason: "not_json" });
    expect(parseImport("[]", TO)).toEqual({ ok: false, reason: "not_ours" });
    expect(parseImport('{"format":"other","formatVersion":1}', TO)).toEqual({
      ok: false,
      reason: "not_ours",
    });
    expect(parseImport('{"format":"chess-coach-export","formatVersion":2}', TO)).toEqual({
      ok: false,
      reason: "newer",
    });
  });

  it("leaves out records the page would not accept, and never builds an unsafe path", async () => {
    const file = JSON.parse(await exportedFile());
    file.history.push({ ...record("bad id/../x") }, { nonsense: 1 }, record("g1"));
    file.lessonProgress.push({ lessonId: "no-such-lesson" });
    file.savedGames.currentGame = { moves: "x" };
    file.unreadable = [{ path: "a", data: 1 }];
    const r = parseImport(JSON.stringify(file), TO);
    if (!r.ok) throw new Error("expected ok");
    expect(r.plan.rejected).toBe(5);
    expect(r.plan.unreadable).toBe(1);
    expect(r.plan.docs.every((d) => !d.path.includes(".."))).toBe(true);
    expect(r.plan.docs).toHaveLength(4);
  });

  it("leaves saved coach answers alone: the knowledge base is the server's", async () => {
    const r = parseImport(await exportedFile(), TO);
    if (!r.ok) throw new Error("expected ok");
    expect(r.plan.docs.some((d) => d.path.startsWith("coach-kb/"))).toBe(false);
  });
});

describe("runImport", () => {
  it("restores everything, and the account exports the same data again", async () => {
    const r = parseImport(await exportedFile(), TO);
    if (!r.ok) throw new Error("expected ok");
    const dest = fakeDb();
    const seen: number[] = [];
    const out = await runImport(dest.db, r.plan.docs, {
      sleep: noSleep,
      onProgress: (d) => seen.push(d),
    });
    expect(out).toMatchObject({
      added: { games: 1, history: 2, lessons: 1, coachAnswers: 0 },
      existing: 0,
      stoppedBy: null,
    });
    expect(seen.at(-1)).toBe(4);
    const back = await collectExport(dest.db, TO);
    expect(back.history.map((h) => h.id).sort()).toEqual(["g1", "g2"]);
    expect(back.practiceGame).not.toBeNull();
    expect(back.skipped).toBe(0);
  });

  it("keeps what is already there and is safe to run twice", async () => {
    const r = parseImport(await exportedFile(), TO);
    if (!r.ok) throw new Error("expected ok");
    const dest = fakeDb();
    const mine = { ...record("g1"), result: "Mine." };
    await dest.db.doc(`data/users/${TO}/history/games/g1`).set(mine);
    const first = await runImport(dest.db, r.plan.docs, { sleep: noSleep });
    expect(first.existing).toBe(1);
    expect(dest.docs.get(`data/users/${TO}/history/games/g1`)).toEqual(mine);
    const second = await runImport(dest.db, r.plan.docs, { sleep: noSleep });
    expect(second.added).toEqual({ games: 0, history: 0, lessons: 0, coachAnswers: 0 });
    expect(second.existing).toBe(4);
  });

  it("waits and goes on when the server is busy, and says where it stopped otherwise", async () => {
    const r = parseImport(await exportedFile(), TO);
    if (!r.ok) throw new Error("expected ok");
    const busy = fakeDb();
    busy.failNext.push("resource_exhausted");
    const waits: number[] = [];
    const ok = await runImport(busy.db, r.plan.docs, {
      sleep: async (ms) => void waits.push(ms),
    });
    expect(ok.stoppedBy).toBeNull();
    expect(waits.some((w) => w >= 10_000)).toBe(true);

    const broken = fakeDb();
    broken.failNext.push("ok-first", "not_granted");
    // The first call (a query) fails with an unknown code that is not "busy": it stops.
    const stopped = await runImport(broken.db, r.plan.docs, { sleep: noSleep });
    expect(stopped.stoppedBy).toBe("ok-first");
  });
});

describe("wording", () => {
  it("describes counts and outcomes in plain words", () => {
    expect(countsText({ games: 0, history: 2, lessons: 1, coachAnswers: 0 })).toBe(
      "2 past games, 1 lesson",
    );
    expect(outcomeText({ games: 0, history: 2, lessons: 0, coachAnswers: 0 }, 1, null)).toBe(
      "Added 2 past games. 1 already here, so left as they are.",
    );
    expect(
      outcomeText({ games: 0, history: 0, lessons: 0, coachAnswers: 0 }, 0, "not_granted"),
    ).toContain("stopped early");
  });
});
