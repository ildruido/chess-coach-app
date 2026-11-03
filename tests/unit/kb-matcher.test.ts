import { describe, expect, it } from "vitest";
import { type AskPlace, hintQuery, keyQuery, lessonCtx, lessonQuery } from "../../src/kb/contexts";
import type { KbEntry } from "../../src/kb/entry";
import { applies, findEntry, listEntries } from "../../src/kb/matcher";
import { decideScope } from "../../src/lessons/ask";

const at: AskPlace = { lessonId: "free-pieces", lessonVersion: 1, place: "step:1", bestMove: null };
const q = (text: string, over: Partial<AskPlace> = {}) =>
  lessonQuery("ask", { ...at, ...over }, text);

let n = 0;
const entry = (over: Partial<KbEntry> = {}): KbEntry => ({
  v: 2,
  id: `a${++n}`,
  kind: "ask",
  group: "free-pieces",
  ctx: lessonCtx(at),
  wide: false,
  text: "Why can't I take the horse?",
  answer: "Because the pawn on e6 defends it.",
  createdAt: `2026-10-08T10:00:0${n % 10}Z`,
  reuses: 0,
  vote: 0,
  meta: {},
  ...over,
});

describe("findEntry on lesson questions", () => {
  it("a close match on the same step", () => {
    const saved = entry();
    expect(findEntry(q("why not capture the knight"), [saved])).toEqual({
      kind: "close",
      entry: saved,
    });
  });

  it("a near match is only a suggestion; a different question none", () => {
    const saved = entry({ text: "Why can't the knight run away to safety?" });
    expect(findEntry(q("Why can't the knight run?"), [saved]).kind).toBe("near");
    expect(findEntry(q("What does the knight attack?"), [saved]).kind).toBe("none");
  });

  it("a wide answer applies on other steps of the lesson, a place answer doesn't", () => {
    const idea = entry({
      text: "What is a pin?",
      wide: true,
      ctx: lessonCtx({ ...at, place: "step:0" }),
    });
    const place = entry({
      text: "Why is the knight free?",
      ctx: lessonCtx({ ...at, place: "step:0" }),
    });
    expect(findEntry(q("what's a pin"), [idea, place]).kind).toBe("close");
    expect(findEntry(q("Why is the knight free?"), [idea, place]).kind).toBe("none");
    expect(findEntry(q("what's a pin", { lessonId: "forks" }), [idea]).kind).toBe("none");
  });

  it("a 👎 answer is never reused", () => {
    expect(findEntry(q("why not capture the knight"), [entry({ vote: -1 })]).kind).toBe("none");
  });

  it("step answers stop after a new lesson version; position answers need the same best move", () => {
    expect(applies(entry(), q("x", { lessonVersion: 2 }))).toBe(false);
    expect(applies(entry({ wide: true }), q("x", { lessonVersion: 2 }))).toBe(true);
    const where = { place: "fen:x", bestMove: "Rxd8" };
    const pos = entry({ ctx: lessonCtx({ ...at, ...where }) });
    expect(applies(pos, q("x", { ...where, lessonVersion: 2 }))).toBe(true);
    expect(applies(pos, q("x", { place: "fen:x", bestMove: "Qd3" }))).toBe(false);
    expect(applies(pos, q("x", { place: "fen:y", bestMove: "Rxd8" }))).toBe(false);
  });

  it("among equals: the same place, then 👍, then the newest", () => {
    const idea = entry({
      wide: true,
      ctx: lessonCtx({ ...at, place: "step:3" }),
      createdAt: "2026-10-09T00:00:00Z",
    });
    const here = entry();
    expect(findEntry(q("why not capture the knight"), [idea, here])).toMatchObject({ entry: here });
    const liked = entry({ vote: 1, createdAt: "2026-10-01T00:00:00Z" });
    expect(findEntry(q("why not capture the knight"), [here, liked])).toMatchObject({
      entry: liked,
    });
  });

  it("lists the saved rewordings for this step, oldest first, without 👎", () => {
    const reword = (over: Partial<KbEntry>) => entry({ kind: "reword", text: "", ...over });
    const a = reword({ createdAt: "2026-10-08T02:00:00Z" });
    const b = reword({ createdAt: "2026-10-08T01:00:00Z" });
    const bad = reword({ vote: -1 });
    const other = reword({ ctx: lessonCtx({ ...at, place: "step:2" }) });
    expect(listEntries(lessonQuery("reword", at, ""), [a, b, bad, other, entry()])).toEqual([b, a]);
  });

  it("an idea answer naming a square or move stays tied to its place", () => {
    expect(
      decideScope("idea", "What is a pin?", "A pin holds a piece in front of a bigger one."),
    ).toBe("idea");
    expect(decideScope("idea", "What is a pin?", "Like the bishop on b5.")).toBe("place");
    expect(decideScope("idea", "What if Nf3?", "A pin.")).toBe("place");
    expect(decideScope("place", "What is a pin?", "A pin.")).toBe("place");
  });
});

describe("findEntry on engine-driven kinds", () => {
  const moves = ["e2e4", "e7e5"];
  const hint = (over: Partial<KbEntry> = {}) => {
    const k = hintQuery(moves, "question", [], "g1f3");
    return entry({
      kind: "hint",
      group: k.group,
      ctx: k.ctx,
      text: "",
      answer: "What does e5 control?",
      ...over,
    });
  };

  const hintCtx = (stage: string, best: string) => {
    const k = hintQuery(moves, stage, [], best);
    return { group: k.group, ctx: k.ctx };
  };

  it("reuses only on the exact key", () => {
    const saved = hint();
    expect(findEntry(hintQuery(moves, "question", [], "g1f3"), [saved]).kind).toBe("close");
    expect(findEntry(hintQuery(moves, "plan", [], "g1f3"), [saved]).kind).toBe("none");
    expect(findEntry(hintQuery(moves, "question", ["question"], "g1f3"), [saved]).kind).toBe(
      "none",
    );
    // A guiding step survives a different best move; a pointing step does not.
    expect(findEntry(hintQuery(moves, "question", [], "b1c3"), [saved]).kind).toBe("close");
    const move = hint({ ...hintCtx("move", "g1f3") });
    expect(findEntry(hintQuery(moves, "move", [], "g1f3"), [move]).kind).toBe("close");
    expect(findEntry(hintQuery(moves, "move", [], "b1c3"), [move]).kind).toBe("none");
    expect(findEntry(hintQuery(["e2e4"], "question", [], "g1f3"), [saved]).kind).toBe("none");
  });

  it("never mixes kinds, and a 👎 hint is dropped", () => {
    const k = keyQuery("commentary", "x");
    expect(findEntry(k, [hint({ group: k.group, ctx: k.ctx })]).kind).toBe("none");
    expect(findEntry(hintQuery(moves, "question", [], "g1f3"), [hint({ vote: -1 })]).kind).toBe(
      "none",
    );
  });
});
