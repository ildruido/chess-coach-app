import { describe, expect, it } from "vitest";
import { PathError, canAccess, collectionPath, docPath, parsePath } from "../src/paths.js";

describe("paths", () => {
  it("accepts the paths the page uses", () => {
    expect(docPath("data/users/u1/current-game")).toHaveLength(4);
    expect(docPath("data/users/u1/history/games/g1")).toHaveLength(6);
    expect(docPath("coach-kb/lesson.l1")).toHaveLength(2);
    expect(collectionPath("coach-kb/lesson.l1/entries")).toHaveLength(3);
  });

  it("rejects bad shapes", () => {
    for (const p of [
      "",
      "a//b",
      "/a/b",
      "a/b/",
      "a/../b",
      "a/./b",
      "a/b c",
      "a/b?x",
      5,
      undefined,
    ]) {
      expect(() => parsePath(p), String(p)).toThrow(PathError);
    }
    expect(() => parsePath("a/".repeat(9) + "b")).toThrow(PathError);
    expect(() => docPath("coach-kb/x/entries")).toThrow(PathError);
    expect(() => collectionPath("coach-kb/x")).toThrow(PathError);
  });

  it("limits a user to their own data and closes every shared path (CC-067)", () => {
    expect(canAccess(["data", "users", "u1", "current-game"], "u1")).toBe(true);
    expect(canAccess(["data", "users", "u1", "history", "games"], "u1")).toBe(true);
    expect(canAccess(["data", "users", "u2", "current-game"], "u1")).toBe(false);
    expect(canAccess(["data", "users", "u1"], "u1")).toBe(false);
    expect(canAccess(["data", "other", "u1", "x"], "u1")).toBe(false);
    expect(canAccess(["coach-kb", "lesson.l1"], "u1")).toBe(false);
    expect(canAccess(["lesson-answers", "l1", "answers", "a"], "u1")).toBe(false);
    expect(canAccess(["secrets", "x"], "u1")).toBe(false);
  });
});
