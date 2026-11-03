import { describe, expect, it } from "vitest";
import { classifyPoint, tallyMistakes } from "../../src/lessons/mistakes";
import { point, record } from "./fixtures/advice";

describe("classifyPoint", () => {
  it("finds a piece left hanging", () => {
    expect(classifyPoint(point({ ply: 30 }))).toBe("hanging");
  });
  it("finds a missed checkmate", () => {
    const p = point({ kind: "missed", leftHanging: false, bestMates: true, bestGain: 9 });
    expect(classifyPoint(p)).toBe("missed-mate");
  });
  it("finds a missed free piece", () => {
    const p = point({
      kind: "missed",
      leftHanging: false,
      bestGain: 3,
      bestFacts: ["It captures a knight."],
    });
    expect(classifyPoint(p)).toBe("missed-free-piece");
  });
  it("finds a missed fork", () => {
    const p = point({
      kind: "missed",
      leftHanging: false,
      bestGain: 5,
      bestFacts: ["After it, the moved piece attacks Black's king on e8, Black's rook on a8."],
    });
    expect(classifyPoint(p)).toBe("missed-fork");
  });
  it("does not call a single attack a fork", () => {
    const p = point({
      leftHanging: false,
      ply: 30,
      bestGain: 5,
      bestFacts: ["After it, the moved piece attacks Black's rook on a8."],
    });
    expect(classifyPoint(p)).toBeNull();
  });
  it("finds an opening slip, but not an early inaccuracy", () => {
    const slip = point({ leftHanging: false, ply: 6 });
    expect(classifyPoint(slip)).toBe("opening-slip");
    expect(classifyPoint({ ...slip, kind: "inaccuracy" })).toBeNull();
  });
  it("never counts a well-spotted point, and invents nothing", () => {
    expect(classifyPoint(point({ kind: "spotted" }))).toBeNull();
    expect(classifyPoint(point({ leftHanging: false, ply: 40 }))).toBeNull();
  });
  it("gives the mate priority over a hanging piece", () => {
    const p = point({ kind: "missed", bestMates: true, bestGain: 9 });
    expect(classifyPoint(p)).toBe("missed-mate");
  });
});

describe("tallyMistakes", () => {
  it("counts each game once per kind and only reviewed games", () => {
    const hang = point({ ply: 30 });
    const records = [
      record("a", "2026-10-03T10:00:00Z", [hang, point({ ply: 32 })]),
      record("b", "2026-10-02T10:00:00Z", [hang]),
      record("c", "2026-10-01T10:00:00Z", null),
    ];
    const t = tallyMistakes(records);
    expect(t.reviewed).toBe(2);
    expect(t.tallies).toEqual([
      { kind: "hanging", games: 2, of: 2, latest: "2026-10-03T10:00:00Z" },
    ]);
  });
  it("orders by count, then by the fixed kind order", () => {
    const records = [
      record("a", "2026-10-03T10:00:00Z", [
        point({ ply: 30 }),
        point({ kind: "missed", leftHanging: false, bestMates: true }),
      ]),
    ];
    expect(tallyMistakes(records).tallies.map((t) => t.kind)).toEqual(["hanging", "missed-mate"]);
  });
  it("is empty with no games", () => {
    expect(tallyMistakes([])).toEqual({ reviewed: 0, tallies: [] });
  });
});
