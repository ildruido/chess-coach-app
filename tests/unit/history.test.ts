import { describe, expect, it } from "vitest";
import { gameAt } from "../../src/chess/notation";
import type { GameReview, TurningPoint } from "../../src/coach/review";
import { PracticeGame } from "../../src/practice/practice-game";
import {
  type HistoryRecord,
  historyRecord,
  historyRow,
  hintsText,
  newestFirst,
  parseHistoryRecord,
  parseReview,
} from "../../src/storage/history";
import { DbHistoryStore, historyLoadErrorText, historyPath } from "../../src/storage/history-store";
import { fakeDb } from "./fixtures/fake-db";

const MOVES = ["e2e4", "e7e5", "d1h5", "b8c6", "h5f7", "e8f7"];
const t1 = new Date("2026-10-07T09:30:00Z");

const point = (over: Partial<TurningPoint> = {}): TurningPoint => ({
  ply: 4,
  kind: "mistake",
  swing: 60,
  fenBefore: gameAt({ moves: MOVES.slice(0, 4) }).fen(),
  playedUci: "h5f7",
  playedSan: "Qxf7+",
  bestUci: "f1c4",
  bestSan: "Bc4",
  isBest: false,
  bestLine: ["Bc4", "g6"],
  playedFacts: ["It captures a pawn."],
  bestFacts: ["It attacks f7."],
  bestGain: 0,
  bestMates: false,
  evalBefore: "about equal",
  evalAfter: "Black is winning",
  leftHanging: true,
  why: "Coach: your queen could be taken.",
  whyBy: "coach",
  ...over,
});

const review = (points = [point()]): GameReview => ({
  version: 1,
  result: "You resigned. The engine wins.",
  points,
  lesson: "Check what your piece can be captured by.",
  lessonBy: "engine",
});

function finished(): PracticeGame {
  const p = PracticeGame.start(2, "white", "ask");
  for (const m of MOVES) p.game.play(m.slice(0, 2), m.slice(2, 4));
  p.recordHint("question");
  p.resign();
  return p;
}

const roundTrip = (v: unknown) => JSON.parse(JSON.stringify(v));

describe("history record", () => {
  it("is made only for a finished game, with everything the history needs", () => {
    const p = PracticeGame.start(1, "white");
    expect(historyRecord(p)).toBeNull();
    const r = historyRecord(finished(), t1)!;
    expect(r).toMatchObject({
      version: 1,
      moves: MOVES,
      level: 2,
      color: "white",
      hintMode: "ask",
      hints: [{ ply: 6, step: "question", mode: "ask" }],
      resigned: true,
      finishedAt: "2026-10-07T09:30:00.000Z",
      outcome: "loss",
      result: "You resigned. The engine wins.",
    });
    expect(r.review).toBeUndefined();
    expect(historyRecord(finished(), t1, review())!.review).toEqual(review());
  });

  it("round-trips, with its review", () => {
    const r = historyRecord(finished(), t1, review())!;
    expect(parseHistoryRecord(roundTrip(r))).toEqual(r);
  });

  it("rejects anything that isn't a finished game", () => {
    const r = historyRecord(finished(), t1)!;
    expect(parseHistoryRecord(null)).toBeNull();
    expect(parseHistoryRecord({ ...r, version: 2 })).toBeNull();
    expect(parseHistoryRecord({ ...r, id: "../other" })).toBeNull();
    expect(parseHistoryRecord({ ...r, outcome: "won" })).toBeNull();
    expect(parseHistoryRecord({ ...r, finishedAt: "today" })).toBeNull();
    expect(parseHistoryRecord({ ...r, moves: ["e2e4", "e2e4"] })).toBeNull();
    expect(parseHistoryRecord({ ...r, level: 99 })).toBeNull();
    expect(parseHistoryRecord({ ...r, hintMode: undefined })).toBeNull();
  });

  it("drops a review that doesn't match the game, but keeps the game", () => {
    const r = historyRecord(finished(), t1)!;
    const bad = { ...r, review: review([point({ playedUci: "e2e4" })]) };
    const parsed = parseHistoryRecord(roundTrip(bad))!;
    expect(parsed.id).toBe(r.id);
    expect(parsed.review).toBeUndefined();
  });

  it("checks every turning point against the game's own moves", () => {
    expect(parseReview(review(), MOVES)).toEqual(review());
    expect(parseReview(review([point({ ply: 9 })]), MOVES)).toBeNull();
    expect(
      parseReview(review([point({ fenBefore: "8/8/8/8/8/8/8/8 w - - 0 1" })]), MOVES),
    ).toBeNull();
    expect(parseReview(review([point({ playedSan: "Qf7" })]), MOVES)).toBeNull();
    expect(parseReview(review([point({ kind: "blunder" as never })]), MOVES)).toBeNull();
    expect(parseReview(review([point({ why: 5 as never })]), MOVES)).toBeNull();
    expect(parseReview(review([point({ bestSan: "Nf3" })]), MOVES)).toBeNull();
    expect(parseReview(review([point({ bestUci: "a1a8" })]), MOVES)).toBeNull();
    expect(parseReview({ ...review(), lessonBy: "me" }, MOVES)).toBeNull();
    expect(parseReview({ ...review(), points: Array(6).fill(point()) }, MOVES)).toBeNull();
  });

  it("orders the list newest first", () => {
    const a = { ...historyRecord(finished(), t1)!, id: "a" };
    const b = { ...a, id: "b", finishedAt: "2026-10-08T09:00:00.000Z" };
    const c = { ...a, id: "c" };
    expect(newestFirst([a, b, c]).map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("describes a game in one row", () => {
    const r = historyRecord(finished(), t1)!;
    const row = historyRow(r);
    expect(row.outcome).toBe("Resigned");
    expect(row.details).toBe(
      "Level 2, Beginner · you played white · 3 moves · 1 hint · not reviewed yet",
    );
    expect(
      historyRow({ ...r, resigned: false, outcome: "win", review: review(), hints: [] }),
    ).toMatchObject({
      outcome: "Won",
    });
    expect(historyRow({ ...r, review: review(), hints: [] }).details).toContain(
      "no hints · reviewed",
    );
  });

  it("sums up the hints used", () => {
    const r = { hintMode: "tell" as const, hints: [] as HistoryRecord["hints"] };
    expect(hintsText(r)).toBe("Hints (Tell me): none used.");
    r.hints = [
      { ply: 0, step: "plan", mode: "tell" },
      { ply: 0, step: "piece", mode: "tell" },
      { ply: 4, step: "plan", mode: "tell" },
    ];
    expect(hintsText(r)).toBe("Hints (Tell me): 3 used, 2 plans and 1 piece.");
    expect(hintsText({ hintMode: "ask", hints: [{ ply: 0, step: "question", mode: "ask" }] })).toBe(
      "Hints (Ask me): 1 used, 1 question.",
    );
  });
});

describe("DbHistoryStore", () => {
  it("saves each game under its id and lists them newest first", async () => {
    const { db, docs } = fakeDb();
    const store = new DbHistoryStore(db, "u1");
    const a = historyRecord(finished(), t1)!;
    const b = { ...historyRecord(finished(), new Date("2026-10-08T08:00:00Z"))!, review: review() };
    await store.save(a);
    await store.save(b);
    expect([...docs.keys()].sort()).toEqual(
      [`${historyPath("u1")}/${a.id}`, `${historyPath("u1")}/${b.id}`].sort(),
    );
    expect(historyPath("u1")).toBe("data/users/u1/history/games");
    const got = await store.list();
    expect(got.records).toEqual([b, a]);
    expect(got.skipped).toBe(0);
  });

  it("replaces a game saved again (a review added, or a new ending)", async () => {
    const { db } = fakeDb();
    const store = new DbHistoryStore(db, "u1");
    const a = historyRecord(finished(), t1)!;
    await store.save(a);
    await store.save({ ...a, review: review() });
    const got = await store.list();
    expect(got.records).toHaveLength(1);
    expect(got.records[0]!.review).toEqual(review());
  });

  it("skips documents it can't read, and ones filed under another id", async () => {
    const { db, docs } = fakeDb();
    const a = historyRecord(finished(), t1)!;
    docs.set(`${historyPath("u1")}/junk`, { version: 1, moves: "nope" });
    docs.set(`${historyPath("u1")}/other`, roundTrip(a));
    const got = await new DbHistoryStore(db, "u1").list();
    expect(got).toEqual({ records: [], skipped: 2 });
  });

  it("retries a transient failure once", async () => {
    const { db, failNext } = fakeDb();
    failNext.push("unavailable");
    expect((await new DbHistoryStore(db, "u1").list()).records).toEqual([]);
  });

  it("explains a list that couldn't be read", () => {
    expect(historyLoadErrorText({ code: "not_granted" })).toContain("declined storage");
    expect(historyLoadErrorText({ code: "unavailable" })).toBe(
      "Couldn't load your past games. Reload to try again.",
    );
  });
});
