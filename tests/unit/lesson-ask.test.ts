import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { buildFacts } from "../../src/coach/hint";
import type { Analysis } from "../../src/engine/uci";
import {
  acceptAsk,
  acceptReword,
  type AskContext,
  buildAskPrompt,
  buildRewordPrompt,
  coachErrorText,
  HELD_BACK_TEXT,
  MAX_QUESTION,
  namedMoveFacts,
  namesTheAnswer,
  parseNamedMove,
  plainText,
  splitScope,
  textMoves,
  tidyQuestion,
} from "../../src/lessons/ask";

// Free pieces, step 2: the knight on d5 is defended by the pawn on e6.
const DEFENDED = "4k3/8/4p3/3n4/8/8/8/3QK3 w - - 0 1";
const ctx: AskContext = {
  lessonTitle: "Free pieces",
  kind: "explain",
  text: "Now the pawn on {e6} defends the knight. If your queen takes on {d5}, the pawn takes the queen back.",
  textSans: [],
  position: { fen: DEFENDED },
  secret: false,
};

const analysis = (bestMove: string, pv: string[], cp = 0): Analysis => ({
  bestMove,
  depth: 12,
  score: { cp },
  pv,
  ms: 1000,
});

// The engine's view of the position: Qd3 (made up, but legal), and of Qxd5 exd5.
const facts = buildFacts(new Chess(DEFENDED), analysis("d1d3", ["d1d3", "e8e7"], 300));
const qxd5 = namedMoveFacts(ctx.position, "Qxd5", analysis("e6d5", ["e6d5", "e1e2"], -300));

describe("parseNamedMove", () => {
  const game = new Chess(DEFENDED);
  it.each([
    ["What if Qxd5?", "Qxd5"],
    ["why not qxd5", "Qxd5"],
    ["What about Qd5+?", "Qxd5"],
    ["Can I play Qd3", "Qd3"],
    ["Ke2?", "Ke2"],
  ])("%s names %s", (q, san) => {
    expect(parseNamedMove(q, game)).toBe(san);
  });

  it("ignores plain words, illegal moves and squares named as places", () => {
    expect(parseNamedMove("Why not take with the queen?", game)).toBeNull();
    expect(parseNamedMove("What if Nf3?", game)).toBeNull();
    expect(parseNamedMove("Why is the knight on d5 defended?", game)).toBeNull();
    const start = new Chess();
    expect(parseNamedMove("Can my knight go to f3?", start)).toBeNull();
    expect(parseNamedMove("Is the c3 square weak?", start)).toBeNull();
    expect(parseNamedMove("What if e4?", start)).toBe("e4");
  });

  it("reads pawn moves, pawn captures and castling", () => {
    const g = new Chess("r3k2r/8/8/8/2p5/1P6/8/R3K2R w KQkq - 0 1");
    expect(parseNamedMove("what if b4?", g)).toBe("b4");
    expect(parseNamedMove("why not bxc4", g)).toBe("bxc4");
    expect(parseNamedMove("Can I castle with 0-0?", g)).toBe("O-O");
    expect(parseNamedMove("And O-O-O?", g)).toBe("O-O-O");
  });
});

describe("text helpers", () => {
  it("strips braces and finds the moves the text names", () => {
    expect(plainText("Take on {d5} with {Qxd5}.")).toBe("Take on d5 with Qxd5.");
    expect(textMoves("Take on {d5} with {Qxd5}.")).toEqual(["Qxd5"]);
  });

  it("tidies and cuts the question", () => {
    expect(tidyQuestion("  why\n not  ")).toBe("why not");
    expect(tidyQuestion("x".repeat(500))).toHaveLength(MAX_QUESTION);
  });
});

describe("buildAskPrompt", () => {
  it("holds the lesson step, the engine facts and the question", () => {
    const p = buildAskPrompt(ctx, facts, "Is the knight free?", null);
    expect(p).toContain("Lesson: Free pieces");
    expect(p).toContain("Now the pawn on e6 defends the knight");
    expect(p).toContain("Engine best move: Qd3");
    expect(p).toContain('The player\'s question: "Is the knight free?"');
    expect(p).toContain("Do not calculate variations yourself");
  });

  it("gives the engine's answer to a move the question names", () => {
    const p = buildAskPrompt(ctx, facts, "What if Qxd5?", qxd5);
    expect(p).toContain("The player asks about the move Qxd5");
    expect(p).toContain("It captures a knight.");
    expect(p).toContain("The engine's best answer to it: exd5");
  });

  it("keeps the best move secret in an open exercise", () => {
    const p = buildAskPrompt({ ...ctx, kind: "exercise", secret: true }, facts, "Help?", null);
    expect(p).toContain("Don't give the answer away");
    expect(p).not.toContain("Qd3");
  });

  it("keeps the secret even when Ale names the answer, which the page answers itself", () => {
    const open = { ...ctx, secret: true };
    expect(namesTheAnswer(open, facts, "Qd3")).toBe(true);
    expect(namesTheAnswer(open, facts, "Qxd5")).toBe(false);
    expect(namesTheAnswer(ctx, facts, "Qd3")).toBe(false);
    const p = buildAskPrompt(open, facts, "What if Qxd5?", qxd5);
    expect(p).not.toContain("Qd3");
    expect(p).toContain("The engine's best answer to it: exd5");
  });
});

describe("acceptAsk", () => {
  it("shows a complete answer naming only moves it was given", () => {
    expect(acceptAsk("After Qxd5 exd5 you lose the queen.", false, ctx, facts, qxd5)).toBe(true);
    expect(acceptAsk("The engine prefers Qd3.", false, ctx, facts, null)).toBe(true);
  });

  it("holds back empty, cut-off and invented answers", () => {
    expect(acceptAsk("  ", false, ctx, facts, null)).toBe(false);
    expect(acceptAsk("Qd3 is good.", true, ctx, facts, null)).toBe(false);
    expect(acceptAsk("Play Nf3 instead.", false, ctx, facts, null)).toBe(false);
    // The named move's line is only allowed when it was asked about.
    expect(acceptAsk("After Qxd5 exd5 you lose the queen.", false, ctx, facts, null)).toBe(false);
  });

  it("holds back an answer that gives away an open exercise", () => {
    const open = { ...ctx, kind: "exercise" as const, secret: true };
    expect(acceptAsk("Play Qd3.", false, open, facts, null)).toBe(false);
    expect(acceptAsk("Put your queen on d3.", false, open, facts, null)).toBe(false);
    // Which piece moves stays hidden too, as in the early hints.
    expect(acceptAsk("Your queen on d1 can do something here.", false, open, facts, null)).toBe(
      false,
    );
    expect(acceptAsk("Look for a piece nothing defends.", false, open, facts, null)).toBe(true);
  });
});

describe("splitScope", () => {
  it("takes the coach's scope line off the answer", () => {
    expect(splitScope("A pin holds a piece.\nScope: idea")).toEqual({
      answer: "A pin holds a piece.",
      tag: "idea",
    });
    expect(splitScope("The knight is free.\n\n**Scope:** position.")).toEqual({
      answer: "The knight is free.",
      tag: "place",
    });
    expect(splitScope("No tag here.")).toEqual({ answer: "No tag here.", tag: "place" });
    expect(buildAskPrompt(ctx, facts, "Why?", null)).toContain('"Scope: idea"');
  });
});

describe("Explain differently", () => {
  it("asks for the same idea in other words, with the rule facts", () => {
    const p = buildRewordPrompt(ctx);
    expect(p).toContain("Now the pawn on e6 defends the knight");
    expect(p).toContain("Pieces under attack now");
    expect(buildRewordPrompt(ctx, ["First try."])).toContain("- First try.");
  });

  it("allows only the text's own moves", () => {
    const show = { ...ctx, textSans: ["Qxd5"] };
    expect(acceptReword("Qxd5 takes the knight.", false, show)).toBe(true);
    expect(acceptReword("Qxd5 takes the knight.", false, ctx)).toBe(false);
    expect(acceptReword("", false, ctx)).toBe(false);
    expect(acceptReword("Fine.", true, ctx)).toBe(false);
  });
});

describe("coachErrorText", () => {
  it("pauses at the usage limit and explains other failures", () => {
    expect(coachErrorText("rate_limited", "Later.")).toBe(
      "The coach is paused at your usage limit. Later.",
    );
    expect(coachErrorText("refused", "Later.")).toBe("The coach couldn't answer this one. Later.");
    expect(coachErrorText("offline", "Later.")).toBeTruthy();
    expect(HELD_BACK_TEXT).toContain("Ask again");
  });
});
