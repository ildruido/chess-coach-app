import { describe, expect, it } from "vitest";
import type { Analysis } from "../../src/engine/uci";
import { FREE_PIECES } from "../../src/lessons/content/free-pieces";
import { isFinished, newProgress, parseProgress, scoreText } from "../../src/lessons/progress";
import { isAnswer, judgeMiss, judgeSafe } from "../../src/lessons/safety-net";
import { acceptWhy, buildWhyPrompt } from "../../src/lessons/why";
import { DbLessonStore, lessonPath } from "../../src/storage/lesson-store";
import { fakeDb } from "./fixtures/fake-db";

const analysis = (pv: string[], score: Analysis["score"]): Analysis => ({
  bestMove: pv[0] ?? null,
  depth: 12,
  score,
  pv,
  ms: 100,
});

describe("lesson progress", () => {
  it("round-trips, and starts again for another lesson version", () => {
    const p = { ...newProgress(FREE_PIECES, "ask"), step: 2, results: ["first" as const] };
    expect(parseProgress(JSON.parse(JSON.stringify(p)), FREE_PIECES)).toEqual(p);
    expect(parseProgress({ ...p, lessonVersion: 99 }, FREE_PIECES)).toBeNull();
    expect(parseProgress({ ...p, step: 99 }, FREE_PIECES)).toBeNull();
    expect(parseProgress({ ...p, results: ["great"] }, FREE_PIECES)).toBeNull();
    expect(parseProgress(null, FREE_PIECES)).toBeNull();
  });

  it("keeps the runs and the last score when the lesson version changes", () => {
    const old = {
      ...newProgress(FREE_PIECES, "ask", 2, ["first", "help"]),
      lessonVersion: 0,
      step: 3,
      results: ["skipped" as const],
    };
    const p = parseProgress(JSON.parse(JSON.stringify(old)), FREE_PIECES)!;
    expect(p).toMatchObject({
      lessonVersion: FREE_PIECES.version,
      step: 0,
      results: [],
      runs: 2,
      hintMode: "ask",
      lastResults: ["first", "help"],
    });
    expect(parseProgress({ ...old, lastResults: ["great"] }, FREE_PIECES)!.lastResults).toBe(
      undefined,
    );
    // Never finished: an old version simply starts again.
    expect(parseProgress({ ...old, runs: 0 }, FREE_PIECES)).toBeNull();
  });

  it("knows when the lesson is finished", () => {
    const p = newProgress(FREE_PIECES);
    expect(isFinished(p, FREE_PIECES)).toBe(false);
    expect(isFinished({ ...p, step: FREE_PIECES.steps.length }, FREE_PIECES)).toBe(true);
  });

  it("words the score", () => {
    expect(scoreText(["first", "first", "help", "skipped", "first"])).toBe(
      "3 solved first try, 1 with help, 1 skipped, out of 5.",
    );
    expect(scoreText(["first"])).toBe("1 solved first try, out of 1.");
    expect(scoreText([])).toBe("No exercises done.");
  });

  it("is saved in the player's private area", async () => {
    const { db, docs } = fakeDb();
    const store = new DbLessonStore(db, "u1");
    const p = newProgress(FREE_PIECES);
    await store.save(p);
    expect([...docs.keys()]).toEqual([lessonPath("u1", "free-pieces")]);
    expect(lessonPath("u1", "free-pieces")).toBe("data/users/u1/lessons/progress/free-pieces");
    expect(await store.load(FREE_PIECES)).toEqual(p);
  });
});

describe("safety net", () => {
  // White to move after ...Nd5: Nxd5 wins the free knight.
  const fen = "4k3/8/8/3n4/8/2N5/8/4K3 w - - 0 1";

  it("accepts the answer, and any checkmate", () => {
    expect(isAnswer(fen, [], "c3d5", "c3d5")).toBe(true);
    expect(isAnswer(fen, [], "e1d2", "c3d5")).toBe(false);
    const mateFen = "6k1/1p3ppp/8/8/8/8/5PPP/R5K1 w - - 0 1";
    expect(isAnswer(mateFen, [], "a1a8", "h2h3")).toBe(true);
  });

  it("says 'not quite' for a miss that loses nothing", () => {
    expect(judgeMiss(fen, [], "e1d2", analysis(["d5c3", "d2c3"], { cp: 0 }))).toEqual({
      kind: "notQuite",
    });
    expect(judgeMiss(fen, [], "e1d2", null)).toEqual({ kind: "notQuite" });
  });

  it("warns when the reply takes a piece for nothing", () => {
    // Qa4?? walks into a knight fork: ...Nc3+ and ...Nxa4.
    const qFen = "7k/8/8/3n4/8/8/8/1K1Q4 w - - 0 1";
    const j = judgeMiss(qFen, [], "d1a4", analysis(["d5c3", "b1c2", "c3a4"], { cp: -900 }));
    expect(j.kind).toBe("warn");
    // The first reply isn't a capture, so the general wording is used.
    expect(j.kind === "warn" && j.text).toBe(
      "Careful: the engine thinks this move loses something.",
    );
    const hang = judgeMiss(
      "4k3/8/4p3/8/8/8/8/3QK3 w - - 0 1",
      [],
      "d1d5",
      analysis(["e6d5"], { cp: -900 }),
    );
    expect(hang).toEqual({
      kind: "warn",
      text: "Careful: after this move, your queen on d5 can be taken.",
      replySans: ["exd5"],
    });
  });

  it("warns when the move lets the opponent mate", () => {
    // White's Kg1 boxed in by its pawns; Ra1-b1 leaves the back rank to ...Re1#.
    const j = judgeMiss(
      "4r1k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1",
      [],
      "a1b1",
      analysis(["e8e1", "b1e1"], { mate: -1 }),
    );
    expect(j).toMatchObject({ kind: "warn", text: "Careful: this move lets Black checkmate." });
  });

  it("in a safe exercise, any move that loses nothing is right", () => {
    const q = "4k3/8/4p3/8/8/8/8/3QK3 w - - 0 1";
    expect(judgeSafe(q, [], "d1d2", analysis(["e8e7"], { cp: 900 }))).toEqual({ kind: "safe" });
    expect(judgeSafe(q, [], "d1d5", analysis(["e6d5"], { cp: -900 }))).toMatchObject({
      kind: "warn",
    });
    expect(judgeSafe(q, [], "d1d2", null)).toEqual({ kind: "unknown" });
    // Checkmate needs no engine.
    expect(judgeSafe("6k1/1p3ppp/8/8/8/8/5PPP/R5K1 w - - 0 1", [], "a1a8", null)).toEqual({
      kind: "safe",
    });
  });
});

describe("Why? prompt", () => {
  const facts = {
    fen: "4k3/8/4p3/8/8/8/8/3QK3 w - - 0 1",
    moves: [],
    playedSan: "Qd5",
    replySans: ["exd5"],
    warning: "Careful: after this move, your queen on d5 can be taken.",
  };

  it("gives only engine and rule facts", () => {
    const prompt = buildWhyPrompt(facts);
    expect(prompt).toContain("The player wanted to play: Qd5");
    expect(prompt).toContain("The engine's best reply line: exd5");
    expect(prompt).toContain("Do not calculate variations yourself");
  });

  it("accepts an answer naming the given moves, and refuses others", () => {
    expect(acceptWhy("After Qd5, the pawn takes it with exd5.", false, facts)).toBe(true);
    expect(acceptWhy("Better was Qd4.", false, facts)).toBe(false);
    expect(acceptWhy("Cut off", true, facts)).toBe(false);
    expect(acceptWhy("  ", false, facts)).toBe(false);
  });
});
