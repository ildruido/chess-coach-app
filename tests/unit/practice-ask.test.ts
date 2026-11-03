import { describe, expect, it } from "vitest";
import { gameAt } from "../../src/chess/notation";
import { buildFacts } from "../../src/coach/hint";
import { acceptPracticeAnswer, buildPracticeAskPrompt } from "../../src/coach/practice-ask";

const position = { moves: ["e2e4", "e7e5"] };
const facts = buildFacts(gameAt(position), {
  depth: 12,
  score: { cp: 30 },
  pv: ["g1f3", "b8c6"],
  bestMove: "g1f3",
} as never);

describe("practice question prompt", () => {
  it("hides the best move and quotes the question", () => {
    const p = buildPracticeAskPrompt(facts, "why is my king unsafe?", null);
    expect(p).toContain("why is my king unsafe?");
    expect(p).toContain("kept secret");
    expect(p).not.toContain("Engine best move");
  });
});

describe("practice answer check", () => {
  it("accepts a plain answer", () => {
    expect(acceptPracticeAnswer("Control the centre.", false, position, facts, null)).toBe(true);
  });
  it("accepts moves already played", () => {
    expect(acceptPracticeAnswer("Your e4 opened lines.", false, position, facts, null)).toBe(true);
  });
  it("refuses moves it was not given, empty and cut-off answers", () => {
    expect(acceptPracticeAnswer("Try Qh5 now.", false, position, facts, null)).toBe(false);
    expect(acceptPracticeAnswer("  ", false, position, facts, null)).toBe(false);
    expect(acceptPracticeAnswer("Fine.", true, position, facts, null)).toBe(false);
  });
  it("refuses an answer that names the best move", () => {
    expect(acceptPracticeAnswer("Play Nf3 here.", false, position, facts, null)).toBe(false);
  });
});
