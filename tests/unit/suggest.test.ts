import { describe, expect, it } from "vitest";
import { LESSONS, PATH } from "../../src/lessons/catalog";
import { newProgress, type LessonProgress } from "../../src/lessons/progress";
import { buildAdvice, harderOpponent } from "../../src/lessons/suggest";
import { point, record } from "./fixtures/advice";

const safe = LESSONS.find((l) => l.id === "safe-moves")!;
const hang = point({ ply: 30 });
const mate = point({ kind: "missed", leftHanging: false, bestMates: true, bestGain: 9 });

const finished = (updatedAt: string): Map<string, LessonProgress> =>
  new Map([[safe.id, { ...newProgress(safe), step: safe.steps.length, runs: 1, updatedAt }]]);

describe("buildAdvice", () => {
  it("with no reviewed game, points to the next lesson on the path", () => {
    const a = buildAdvice([record("a", "2026-10-03T10:00:00Z", null)], new Map(), PATH, LESSONS);
    expect(a.reviewed).toBe(0);
    expect(a.suggestions).toEqual([]);
    expect(a.nextOnPath).toBe(PATH[0]);
  });
  it("suggests the lesson for a recurring mistake, with a reason from the games", () => {
    const records = [
      record("a", "2026-10-03T10:00:00Z", [hang]),
      record("b", "2026-10-02T10:00:00Z", [hang]),
      record("c", "2026-10-01T10:00:00Z", [mate]),
    ];
    const a = buildAdvice(records, new Map(), PATH, LESSONS);
    expect(a.suggestions.map((s) => s.lesson.id)).toEqual(["safe-moves", "mate-in-one"]);
    expect(a.suggestions[0]!.reason).toBe(
      "You left a piece to be taken in 2 of your last 3 reviewed games.",
    );
    expect(a.suggestions[0]!.practiseAgain).toBe(false);
    expect(a.mistakes.map((m) => [m.kind, m.games])).toEqual([
      ["hanging", 2],
      ["missed-mate", 1],
    ]);
  });
  it("does not suggest a finished lesson unless the mistake came after it", () => {
    const records = [record("a", "2026-10-03T10:00:00Z", [hang])];
    expect(
      buildAdvice(records, finished("2026-10-04T10:00:00Z"), PATH, LESSONS).suggestions,
    ).toEqual([]);
    const again = buildAdvice(records, finished("2026-10-02T10:00:00Z"), PATH, LESSONS);
    expect(again.suggestions).toHaveLength(1);
    expect(again.suggestions[0]!.practiseAgain).toBe(true);
  });
  it("suggests nothing when no mistake matches", () => {
    const quiet = point({ leftHanging: false, ply: 40 });
    const a = buildAdvice([record("a", "2026-10-03T10:00:00Z", [quiet])], new Map(), PATH, LESSONS);
    expect(a.reviewed).toBe(1);
    expect(a.suggestions).toEqual([]);
    expect(a.mistakes).toEqual([]);
  });
  it("shows at most 3 suggestions", () => {
    const pts = [
      hang,
      mate,
      point({
        kind: "missed",
        leftHanging: false,
        bestGain: 3,
        bestFacts: ["It captures a rook."],
      }),
      point({
        kind: "missed",
        leftHanging: false,
        bestGain: 5,
        bestFacts: ["After it, the moved piece attacks a, b."],
      }),
    ];
    const a = buildAdvice([record("a", "2026-10-03T10:00:00Z", pts)], new Map(), PATH, LESSONS);
    expect(a.suggestions).toHaveLength(3);
    expect(a.mistakes).toHaveLength(3);
  });
});

describe("harderOpponent", () => {
  const win = (id: string, day: number, level = 2) =>
    record(id, `2026-10-0${day}T10:00:00Z`, null, { level, outcome: "win" });
  it("names the next level after 3 wins at the top level played", () => {
    expect(harderOpponent([win("a", 1), win("b", 2), win("c", 3)])).toBe("Improving beginner");
  });
  it("needs 3 games, all wins, all at the highest level", () => {
    expect(harderOpponent([win("a", 2), win("b", 3)])).toBeNull();
    const loss = record("c", "2026-10-04T10:00:00Z", null, { level: 2, outcome: "loss" });
    expect(harderOpponent([win("a", 1), win("b", 2), loss])).toBeNull();
    expect(harderOpponent([win("a", 1, 3), win("b", 2), win("c", 3)])).toBeNull();
  });
  it("is null at the top level", () => {
    expect(harderOpponent([win("a", 1, 6), win("b", 2, 6), win("c", 3, 6)])).toBeNull();
  });
});
