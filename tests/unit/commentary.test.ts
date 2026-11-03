import { describe, expect, it } from "vitest";
import {
  INACCURACY,
  MISTAKE,
  acceptComment,
  bestStillThere,
  buildCommentPrompt,
  fallbackText,
  goodMoveText,
  reviewMove,
  winChance,
} from "../../src/coach/commentary";
import type { Analysis, Score } from "../../src/engine/uci";

const line = (multipv: number, move: string, score: Score) => ({
  multipv,
  depth: 12,
  score,
  pv: [move],
});

/** The engine's view of the start position, White to move (scores from White's side). */
const opening: Analysis = {
  bestMove: "e2e4",
  depth: 12,
  score: { cp: 30 },
  pv: ["e2e4"],
  ms: 400,
  lines: [
    line(1, "e2e4", { cp: 30 }),
    line(2, "d2d4", { cp: 25 }),
    line(3, "a2a3", { cp: -150 }),
    line(4, "f2f3", { cp: -300 }),
  ],
};

const after = (score: Score): Analysis => ({ bestMove: "e7e5", depth: 12, score, pv: [], ms: 400 });

describe("winChance", () => {
  it("is 50 when level and saturates for big advantages", () => {
    expect(winChance(0)).toBe(50);
    expect(winChance(1000)).toBeGreaterThan(97);
    expect(winChance(-1000)).toBeLessThan(3);
  });
});

describe("reviewMove", () => {
  it("calls the engine's best move good, and its top choice", () => {
    const r = reviewMove({}, opening, null, "e2e4")!;
    expect(r).toMatchObject({ verdict: "good", isBest: true, loss: 0, playedSan: "e4" });
    expect(goodMoveText(r)).toBe("The engine's top choice.");
  });

  it("judges a candidate within the same search, so search noise isn't a mistake", () => {
    const r = reviewMove({}, opening, after({ cp: -80 }), "d2d4")!;
    expect(r.verdict).toBe("good");
    expect(r.loss).toBeLessThan(INACCURACY);
    expect(goodMoveText(r)).toBe("A good, solid move.");
  });

  it("grades losses in winning chance: inaccuracy, then mistake", () => {
    const inacc = reviewMove({}, opening, null, "a2a3")!;
    expect(inacc.loss).toBeGreaterThanOrEqual(INACCURACY);
    expect(inacc.loss).toBeLessThan(MISTAKE);
    expect(inacc.verdict).toBe("inaccuracy");
    expect(reviewMove({}, opening, null, "f2f3")!.verdict).toBe("mistake");
  });

  it("still calls a hung piece a mistake when the game is already lost (QA)", () => {
    // Black to move, Black already far behind (-540): a blunder to -900 barely moves
    // the win chance, but it is still a mistake.
    const lost: Analysis = {
      bestMove: "e7e5",
      depth: 12,
      score: { cp: 540 },
      pv: ["e7e5"],
      ms: 400,
      lines: [line(1, "e7e5", { cp: 540 }), line(2, "a7a6", { cp: 900 })],
    };
    const r = reviewMove({ moves: ["e2e4"] }, lost, null, "a7a6")!;
    expect(r.loss).toBeLessThan(INACCURACY);
    expect(r.verdict).toBe("mistake");
    // Far ahead and still winning big: a smaller win isn't a mistake.
    const won: Analysis = {
      ...lost,
      score: { cp: -1500 },
      lines: [line(1, "e7e5", { cp: -1500 }), line(2, "a7a6", { cp: -1200 })],
    };
    expect(reviewMove({ moves: ["e2e4"] }, won, null, "a7a6")!.verdict).toBe("good");
  });

  it("uses the analysis after the move when it isn't among the candidates", () => {
    // h2h4 isn't listed: after it, Black to move, the engine says -100 (White's view).
    const r = reviewMove({}, opening, after({ cp: -100 }), "h2h4")!;
    expect(r.verdict).toBe("inaccuracy");
    expect(r.evalAfter).toBe("Black is clearly better");
    // Without that analysis there is nothing to judge.
    expect(reviewMove({}, opening, null, "h2h4")).toBeNull();
  });

  it("calls a missed mate a missed chance", () => {
    const moves = ["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6"];
    const before: Analysis = {
      bestMove: "h5f7",
      depth: 12,
      score: { mate: 1 },
      pv: ["h5f7"],
      ms: 400,
      lines: [line(1, "h5f7", { mate: 1 })],
    };
    const r = reviewMove({ moves }, before, after({ cp: 40 }), "g1f3")!;
    expect(r).toMatchObject({ verdict: "missed", bestSan: "Qxf7#", bestMates: true });
    expect(fallbackText(r, false)).toBe("You missed Qxf7#.");
    // Playing the mate is good, of course.
    expect(reviewMove({ moves }, before, null, "h5f7")!.verdict).toBe("good");
  });

  it("calls passing up a free queen a missed chance, and a plain loss a mistake", () => {
    const moves = ["e2e4", "e7e5", "g1f3", "d8h4"];
    const before: Analysis = {
      bestMove: "f3h4",
      depth: 12,
      score: { cp: 900 },
      pv: ["f3h4"],
      ms: 400,
      lines: [line(1, "f3h4", { cp: 900 })],
    };
    const r = reviewMove({ moves }, before, after({ cp: 50 }), "b1c3")!;
    expect(r).toMatchObject({ verdict: "missed", bestSan: "Nxh4", bestGain: 9 });
    // The same loss without a chance to win material is a mistake.
    const quiet = {
      ...before,
      bestMove: "b1c3",
      pv: ["b1c3"],
      lines: [line(1, "b1c3", { cp: 900 })],
    };
    expect(reviewMove({ moves }, quiet, after({ cp: 50 }), "a2a3")!.verdict).toBe("mistake");
  });
});

describe("comment prompt and fallback", () => {
  const moves = ["e2e4", "e7e5", "g1f3", "d8h4"];
  const before: Analysis = {
    bestMove: "f3h4",
    depth: 12,
    score: { cp: 900 },
    pv: ["f3h4"],
    ms: 400,
    lines: [line(1, "f3h4", { cp: 900 })],
  };
  const r = reviewMove({ moves }, before, after({ cp: 50 }), "b1c3")!;

  it("gives the coach the engine's facts and verdict, and asks only why", () => {
    const p = buildCommentPrompt(r, false);
    expect(p).toContain('The page already shows the engine\'s verdict ("Missed chance")');
    expect(p).toContain("The player played: Nc3");
    expect(p).toContain("The engine's best move: Nxh4");
    expect(p).toContain("- It captures a queen.");
    expect(p).toContain("In the engine's line it wins 9 points of material.");
    expect(p).toContain("Do not calculate variations yourself");
  });

  it("keeps the better move secret when it may still be on the board", () => {
    const p = buildCommentPrompt(r, true);
    expect(p).not.toMatch(/Nxh4|f3 to h4|On h4/);
    expect(p).toContain("Don't name the better move");
    expect(p).toContain("It captures a queen (don't name its square");
    expect(fallbackText(r, true)).toBe(
      "You missed a chance, and it may still be there. Look again!",
    );
  });
});

describe("spoilers and the coach's line", () => {
  const moves = ["e2e4", "e7e5", "g1f3", "d8h4"];
  const before: Analysis = {
    bestMove: "f3h4",
    depth: 12,
    score: { cp: 900 },
    pv: ["f3h4"],
    ms: 400,
    lines: [line(1, "f3h4", { cp: 900 })],
  };
  const r = reviewMove({ moves }, before, after({ cp: 50 }), "b1c3")!;

  it("keeps the better move hidden while the player could still play it", () => {
    // After 4. Nc3 Qxf2+ the king is in check: Nxh4 can't be played.
    expect(bestStillThere([...moves, "b1c3", "h4f2"], true, "f3h4")).toBe(false);
    // After ...Nc6 the queen still hangs to Nxh4.
    expect(bestStillThere([...moves, "b1c3", "b8c6"], true, "f3h4")).toBe(true);
    // Before the engine has replied, always hidden.
    expect(bestStillThere([...moves, "b1c3"], false, "f3h4")).toBe(true);
  });

  it("accepts a line naming only played moves, and the better move only when allowed", () => {
    const played = ["e4", "e5", "Nf3", "Qh4", "Nc3", "Nc6"];
    expect(acceptComment("Nc3 left the queen on h4 alone.", false, r, false, played)).toBe(true);
    expect(acceptComment("Nxh4 won the queen.", false, r, false, played)).toBe(true);
    // Hidden: neither the move nor its square.
    expect(acceptComment("Nxh4 won the queen.", false, r, true, played)).toBe(false);
    expect(acceptComment("Look at h4 again.", false, r, true, played)).toBe(false);
    expect(acceptComment("Nc3 developed, but a queen was hanging.", false, r, true, played)).toBe(
      true,
    );
    // A move nobody played or the engine gave; an empty or cut-off line.
    expect(acceptComment("Bb5 was better.", false, r, false, played)).toBe(false);
    expect(acceptComment("", false, r, false, played)).toBe(false);
    expect(acceptComment("Nc3 left the", true, r, false, played)).toBe(false);
  });

  it("describes a mate score in words, not as a big number", () => {
    const mating: Analysis = {
      bestMove: "h5f7",
      depth: 12,
      score: { mate: 1 },
      pv: ["h5f7"],
      ms: 400,
      lines: [line(1, "h5f7", { mate: 1 }), line(2, "g1f3", { cp: 40 })],
    };
    const m = reviewMove(
      { moves: ["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6"] },
      mating,
      null,
      "g1f3",
    )!;
    expect(m.evalBefore).toBe("White has a forced mate");
    expect(m.evalAfter).toBe("White is slightly better");
  });
});
