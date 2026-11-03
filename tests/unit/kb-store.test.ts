import { describe, expect, it } from "vitest";
import { KnowledgeBase, type NewEntry } from "../../src/kb/book";
import { lessonCtx, lessonQuery } from "../../src/kb/contexts";
import { newEntryId, parseEntry } from "../../src/kb/entry";
import { fromSavedAnswer, parseSavedAnswer, type SavedAnswer } from "../../src/kb/migrate";
import { DbBackend, entriesPath, groupPath } from "../../src/kb/store";
import { fakeDb } from "./fixtures/fake-db";

const at = { lessonId: "free-pieces", lessonVersion: 1, place: "step:1", bestMove: null };
const input = (over: Partial<NewEntry> = {}): NewEntry => ({
  kind: "ask",
  group: "free-pieces",
  ctx: lessonCtx(at),
  wide: false,
  text: "Why is it free?",
  answer: "Nothing defends it.",
  meta: {},
  ...over,
});
const old = (id: string, over: Partial<SavedAnswer> = {}): SavedAnswer => ({
  v: 1,
  id,
  lessonId: "free-pieces",
  lessonVersion: 1,
  kind: "ask",
  scope: "place",
  place: "step:1",
  bestMove: null,
  question: "Why is it free?",
  answer: "Nothing defends it.",
  createdAt: `2026-10-08T10:00:0${id.length}Z`,
  reuses: 2,
  vote: 1,
  ...over,
});

describe("knowledge base storage", () => {
  it("saves outside the private user area, by kind domain and group", async () => {
    const { db, docs } = fakeDb();
    const kb = new KnowledgeBase(async () => new DbBackend(db));
    await kb.load("ask", "free-pieces");
    const e = kb.save(input());
    kb.save(input({ kind: "hint", group: "ab", ctx: "k", text: "" }));
    await kb.settled();
    const paths = [...docs.keys()].filter((p) => p.includes("/entries/"));
    expect(paths).toHaveLength(2);
    expect(paths[0]).toBe(`coach-kb/lesson.free-pieces/entries/${e.id}`);
    expect(paths[1]).toMatch(/^coach-kb\/hint\.ab\/entries\//);
    expect(entriesPath("lesson", "x").startsWith("data/users")).toBe(false);
  });

  it("survives a reload with its reuses and votes", async () => {
    const { db } = fakeDb();
    const kb = new KnowledgeBase(async () => new DbBackend(db));
    await kb.load("ask", "free-pieces");
    const e = kb.save(input());
    kb.feedback(e, "reused");
    kb.feedback(e, { vote: 1 });
    await kb.settled();
    const again = new KnowledgeBase(async () => new DbBackend(db));
    await again.load("ask", "free-pieces");
    expect(again.entries("ask", "free-pieces")).toEqual([{ ...e, reuses: 1, vote: 1 }]);
    expect(again.find(lessonQuery("ask", at, "why is it free")).kind).toBe("close");
  });

  it("counts reused answers and coach calls per feature", async () => {
    const kb = new KnowledgeBase(async () => null);
    const e = kb.save(input());
    kb.save(input({ kind: "hint", group: "ab", ctx: "k", text: "" }));
    kb.feedback(e, "reused");
    kb.feedback(e, "reused");
    expect(kb.counts("ask")).toEqual({ reused: 2, asked: 1 });
    expect(kb.diagLine("Lesson questions", "ask", "reword")).toBe(
      "Lesson questions: 2 reused, 1 asked the coach.",
    );
    expect(kb.diagLine("Hints", "hint")).toBe("Hints: 0 reused, 1 asked the coach.");
  });

  it("works without storage, and a failed write or load is silent", async () => {
    const none = new KnowledgeBase(async () => null);
    await none.load("ask", "free-pieces");
    expect(none.offline).toBe(true);
    none.save(input());
    await none.settled();
    expect(none.entries("ask", "free-pieces")).toHaveLength(1);

    const { db, failNext } = fakeDb();
    const kb = new KnowledgeBase(async () => new DbBackend(db));
    failNext.push("not_granted", "not_granted");
    await kb.load("ask", "free-pieces");
    expect(kb.problem).toBe("load: not_granted");
    expect(kb.entries("ask", "free-pieces")).toEqual([]);
    failNext.push("quota_exceeded");
    kb.save(input());
    await expect(kb.settled()).resolves.toBeUndefined();
    expect(kb.problem).toBe("save: quota_exceeded");
  });

  it("drops malformed documents and makes ids that sort by time", async () => {
    const { db, docs } = fakeDb();
    docs.set(`${entriesPath("lesson", "free-pieces")}/bad`, { v: 2, id: "bad" });
    const kb = new KnowledgeBase(async () => new DbBackend(db));
    await kb.load("ask", "free-pieces");
    expect(kb.entries("ask", "free-pieces")).toEqual([]);
    expect(newEntryId(1000) < newEntryId(2000)).toBe(true);
    expect(parseEntry(undefined)).toBeNull();
  });
});

describe("moving the lesson answers of CC-027", () => {
  it("maps every old field", () => {
    expect(fromSavedAnswer(old("a"))).toMatchObject({
      v: 2,
      id: "a",
      kind: "ask",
      group: "free-pieces",
      ctx: "step:1|v1",
      wide: false,
      text: "Why is it free?",
      reuses: 2,
      vote: 1,
      meta: { lessonVersion: 1, place: "step:1", bestMove: null },
    });
    expect(fromSavedAnswer(old("b", { scope: "idea" })).wide).toBe(true);
    expect(fromSavedAnswer(old("c", { scope: "idea", kind: "reword" })).wide).toBe(false);
    expect(fromSavedAnswer(old("d", { place: "fen:x", bestMove: "Rxd8" })).ctx).toBe("fen:x|Rxd8");
    expect(parseSavedAnswer({ ...old("e"), vote: 2 })).toBeNull();
  });

  it("copies old answers once, keeps the old ones, and finds them by the new matcher", async () => {
    const { db, docs } = fakeDb();
    docs.set("lesson-answers/free-pieces/answers/a", { ...old("a") });
    docs.set("lesson-answers/free-pieces/answers/bad", { v: 1, id: "bad" });
    const kb = new KnowledgeBase(async () => new DbBackend(db));
    await kb.load("ask", "free-pieces");
    expect(kb.entries("ask", "free-pieces").map((e) => e.id)).toEqual(["a"]);
    expect(kb.find(lessonQuery("ask", at, "why is it free")).kind).toBe("close");
    expect(docs.get(groupPath("lesson", "free-pieces"))).toEqual({ migrated: true });
    expect(docs.has("lesson-answers/free-pieces/answers/a")).toBe(true);

    // A second visit, and an answer changed since: the marker stops a second copy.
    const entryPath = `${entriesPath("lesson", "free-pieces")}/a`;
    docs.set(entryPath, { ...docs.get(entryPath)!, reuses: 9 });
    const again = new KnowledgeBase(async () => new DbBackend(db));
    await again.load("ask", "free-pieces");
    expect(again.entries("ask", "free-pieces")[0]!.reuses).toBe(9);
  });

  it("a failed migration still loads what is there and is tried again next time", async () => {
    const { db, docs, failNext } = fakeDb();
    docs.set("lesson-answers/free-pieces/answers/a", { ...old("a") });
    failNext.push("unavailable", "unavailable", "unavailable");
    const kb = new KnowledgeBase(async () => new DbBackend(db));
    await kb.load("ask", "free-pieces");
    expect(docs.has(groupPath("lesson", "free-pieces"))).toBe(false);
    const later = new KnowledgeBase(async () => new DbBackend(db));
    await later.load("ask", "free-pieces");
    expect(later.entries("ask", "free-pieces").map((e) => e.id)).toEqual(["a"]);
  });

  it("an interrupted copy never overwrites an entry voted on since", async () => {
    const { db, docs } = fakeDb();
    docs.set("lesson-answers/free-pieces/answers/a", { ...old("a") });
    docs.set(`${entriesPath("lesson", "free-pieces")}/a`, {
      ...fromSavedAnswer(old("a")),
      vote: -1,
    });
    const kb = new KnowledgeBase(async () => new DbBackend(db));
    await kb.load("ask", "free-pieces");
    expect(kb.entries("ask", "free-pieces")[0]!.vote).toBe(-1);
    expect(docs.get(groupPath("lesson", "free-pieces"))).toEqual({ migrated: true });
  });
});
