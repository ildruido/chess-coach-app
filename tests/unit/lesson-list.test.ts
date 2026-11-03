import { describe, expect, it } from "vitest";
import { LESSON_GROUPS, LESSONS, PATH, PATH_IDS } from "../../src/lessons/catalog";
import { FORKS } from "../../src/lessons/content/forks";
import { FREE_PIECES } from "../../src/lessons/content/free-pieces";
import { PINS } from "../../src/lessons/content/pins";
import { textRefs } from "../../src/lessons/lesson";
import { continueTarget, doneCount, lessonStatus, nextOnPath } from "../../src/lessons/lesson-list";
import { type LessonProgress, newProgress } from "../../src/lessons/progress";

const L = FREE_PIECES;
const end = L.steps.length;
const at = (over: Partial<LessonProgress>, lesson = L): LessonProgress => ({
  ...newProgress(lesson),
  ...over,
});

describe("lesson status on the list", () => {
  it("not started: nothing saved, or opened and left on the first step", () => {
    expect(lessonStatus(L, undefined)).toMatchObject({
      state: "notStarted",
      text: "Not started.",
      button: "Start",
    });
    expect(lessonStatus(L, at({})).state).toBe("notStarted");
  });

  it("in progress, from the second step or the second exercise", () => {
    expect(lessonStatus(L, at({ step: 1 }))).toEqual({
      state: "inProgress",
      doneBefore: false,
      text: `In progress: step 2 of ${end}.`,
      button: "Resume",
    });
    expect(lessonStatus(L, at({ exercise: 1 })).state).toBe("inProgress");
  });

  it("done, with the last score", () => {
    const s = lessonStatus(L, at({ step: end, runs: 1, results: ["first", "help", "skipped"] }));
    expect(s).toEqual({
      state: "done",
      doneBefore: true,
      text: "Done. Last time: 1 solved first try, 1 with help, 1 skipped, out of 3.",
      button: "Do it again",
    });
  });

  it("a done lesson started again: done until Ale moves on, then in progress, done before", () => {
    const again = at({ runs: 1, lastResults: ["first"] });
    expect(lessonStatus(L, again)).toMatchObject({
      state: "done",
      text: "Done. Last time: 1 solved first try, out of 1.",
    });
    expect(lessonStatus(L, { ...again, step: 2 })).toMatchObject({
      state: "inProgress",
      doneBefore: true,
      text: `In progress: step 3 of ${end}. Done before.`,
      button: "Resume",
    });
    expect(lessonStatus(L, at({ runs: 1 })).text).toBe("Done.");
  });

  it("counts the lessons done at least once", () => {
    const saved = new Map([
      [L.id, at({ step: end, runs: 1 })],
      [FORKS.id, at({ step: 2, runs: 1 }, FORKS)],
      [PINS.id, at({ step: 2 }, PINS)],
    ]);
    expect(doneCount(LESSONS, saved)).toBe(2);
  });

  it("Continue opens the lesson in progress used last", () => {
    const saved = new Map([
      [L.id, at({ step: 1, updatedAt: "2026-10-09T10:00:00.000Z" })],
      [FORKS.id, at({ step: 2, updatedAt: "2026-10-09T12:00:00.000Z" }, FORKS)],
      [PINS.id, at({ step: PINS.steps.length, updatedAt: "2026-10-09T13:00:00.000Z" }, PINS)],
    ]);
    expect(continueTarget(LESSONS, saved)).toBe(FORKS);
    expect(continueTarget(LESSONS, new Map())).toBeNull();
  });
});

describe("catalog", () => {
  it("lists every lesson once, in its groups, each with a one-line summary", () => {
    expect(LESSON_GROUPS.flatMap((g) => g.lessons)).toEqual(LESSONS);
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(LESSONS.length);
    for (const l of LESSONS) {
      expect(l.summary.trim(), l.id).toBeTruthy();
      expect(textRefs(l.summary), l.id).toEqual([]);
      expect(l.summary, l.id).not.toMatch(/\b[a-h][1-8]\b/);
    }
  });
});

describe("the recommended path", () => {
  it("holds every lesson exactly once, from easiest ideas to the first opening", () => {
    expect([...PATH_IDS].sort()).toEqual(LESSONS.map((l) => l.id).sort());
    expect(PATH).toHaveLength(LESSONS.length);
    expect(PATH[0]!.id).toBe("free-pieces");
    // Material before mate patterns, mate in one before back-rank mate.
    const at = (id: string) => PATH_IDS.indexOf(id);
    expect(at("piece-values")).toBeLessThan(at("mate-in-one"));
    expect(at("mate-in-one")).toBeLessThan(at("back-rank"));
    expect(at("forks")).toBeLessThan(at("pins"));
  });

  it("next lesson is the first one not finished yet", () => {
    const none = new Map<string, LessonProgress>();
    expect(nextOnPath(PATH, none)).toBe(PATH[0]);
    const done = (l: (typeof PATH)[0]) => at({ step: l.steps.length, runs: 1 }, l);
    const saved = new Map([
      [PATH[0]!.id, done(PATH[0]!)],
      [PATH[1]!.id, done(PATH[1]!)],
    ]);
    expect(nextOnPath(PATH, saved)).toBe(PATH[2]);
  });

  it("a lesson in progress is still next; skipping ahead does not move it", () => {
    const saved = new Map([
      [PATH[0]!.id, at({ step: 2 }, PATH[0]!)],
      [PATH[3]!.id, at({ step: PATH[3]!.steps.length, runs: 1 }, PATH[3]!)],
    ]);
    expect(nextOnPath(PATH, saved)).toBe(PATH[0]);
  });

  it("is null once every lesson is finished", () => {
    const saved = new Map(PATH.map((l) => [l.id, at({ step: l.steps.length, runs: 1 }, l)]));
    expect(nextOnPath(PATH, saved)).toBeNull();
  });
});
