import { describe, expect, it, vi } from "vitest";
import { gameAt } from "../../src/chess/notation";
import {
  type GameReview,
  LESSON_WORDS,
  MAX_POINTS,
  WHY_WORDS,
  applyCoachAnswer,
  betterText,
  buildReviewPrompt,
  engineLesson,
  engineReview,
  happenedText,
  parseReviewAnswer,
  reviewMovetime,
  turningPoints,
} from "../../src/coach/review";
import { ReviewStopped, analyseGame } from "../../src/coach/review-analysis";
import type { Analysis, Score } from "../../src/engine/uci";

/** The engine's view of one position: its best move and score (White's side), one line. */
const an = (best: string | null, score: Score): Analysis => ({
  bestMove: best,
  depth: 14,
  score,
  pv: best ? [best] : [],
  ms: 200,
  lines: best ? [{ multipv: 1, depth: 14, score, pv: [best] }] : [],
});

/**
 * Analyses for a game where position i is worth evals[i] (White's side). A
 * move that keeps the evaluation was the best; any other gets a different
 * legal quiet move as the engine's best.
 */
function fakeAnalyses(moves: string[], evals: number[]): Analysis[] {
  return evals.map((cp, i) => {
    const game = gameAt({ moves: moves.slice(0, i) });
    const played = moves[i];
    const keeps = played && evals[i + 1] === cp;
    const other = game
      .moves({ verbose: true })
      .find((m) => !m.captured && `${m.from}${m.to}` !== played);
    const best = keeps ? played : other ? `${other.from}${other.to}` : null;
    return an(best, { cp });
  });
}

// 1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6?? 4. Qxf7#: the engine (Black) slips, the player mates.
const SCHOLAR = ["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6", "h5f7"];
const scholarAnalyses: Analysis[] = [
  an("e2e4", { cp: 30 }),
  an("e7e5", { cp: 30 }),
  an("d1h5", { cp: 20 }),
  an("b8c6", { cp: 20 }),
  an("f1c4", { cp: 10 }),
  an("g7g6", { cp: 10 }),
  an("h5f7", { mate: 1 }),
  { bestMove: null, depth: 0, score: { mate: 0 }, pv: [], ms: 1 },
];

// Seven quiet White moves; each drops the evaluation by drops[k], and Black restores it.
const QUIET = [
  "e2e4",
  "e7e5",
  "g1f3",
  "b8c6",
  "f1c4",
  "f8c5",
  "b1c3",
  "g8f6",
  "d2d3",
  "d7d6",
  "a2a3",
  "a7a6",
  "h2h3",
  "h7h6",
];
const DROPS = [150, 250, 100, 400, 200, 300, 500];
const quietEvals = QUIET.map((_, i) => (i % 2 ? -DROPS[(i - 1) / 2]! : 0)).concat(0);

describe("reviewMovetime", () => {
  it("spreads about half a minute over the game, within bounds", () => {
    expect(reviewMovetime(10)).toBe(400);
    expect(reviewMovetime(99)).toBe(300);
    expect(reviewMovetime(400)).toBe(150);
  });
});

describe("turningPoints", () => {
  it("picks the biggest swings, at most five, in game order", () => {
    const points = turningPoints(QUIET, fakeAnalyses(QUIET, quietEvals), 0);
    expect(points).toHaveLength(MAX_POINTS);
    // The smallest error (1. e4, 1.5 pawns) and the good move (3. Bc4) are left out.
    expect(points.map((p) => p.ply)).toEqual([2, 6, 8, 10, 12]);
    expect(points.map((p) => p.kind)).toEqual([
      "mistake",
      "mistake",
      "inaccuracy",
      "mistake",
      "mistake",
    ]);
    for (const p of points) {
      expect(p.isBest).toBe(false);
      expect(p.bestLine[0]).toBe(p.bestSan);
      expect(p.whyBy).toBe("engine");
      expect(p.why).not.toBe("");
    }
  });

  it("shows fewer than three when the player made few mistakes", () => {
    // Only 2. Nf3 is a mistake; the engine (Black) keeps the advantage.
    const evals = QUIET.map((_, i) => (i >= 3 ? -400 : 0)).concat(-400);
    const points = turningPoints(QUIET, fakeAnalyses(QUIET, evals), 0);
    expect(points.map((p) => [p.ply, p.kind])).toEqual([[2, "mistake"]]);
  });

  it("has none in a clean game, and never counts the engine's own moves as errors", () => {
    const evals = QUIET.map(() => 0).concat(0);
    // The engine (Black) drifts a little: not the player's mistake, not a slip worth showing.
    evals[2] = 60;
    const points = turningPoints(QUIET, fakeAnalyses(QUIET, evals), 0);
    expect(points).toEqual([]);
    expect(engineLesson(points)).toMatch(/No big mistakes/);
  });

  it("reviews Black's moves when the player had Black", () => {
    // 2... Nc6 drops four pawns, and the engine (White) keeps the advantage.
    const evals = QUIET.map((_, i) => (i >= 4 ? 400 : 0)).concat(400);
    const points = turningPoints(QUIET, fakeAnalyses(QUIET, evals), 1);
    expect(points.map((p) => p.ply)).toEqual([3]);
    expect(happenedText(points[0]!)).toMatch(/^You played 2\.\.\. Nc6\. Before it, roughly equal/);
  });

  it("praises a reply that punished the engine's slip ('Well spotted')", () => {
    const points = turningPoints(SCHOLAR, scholarAnalyses, 0);
    expect(points).toHaveLength(1);
    const p = points[0]!;
    expect(p).toMatchObject({ ply: 6, kind: "spotted", playedSan: "Qxf7#", isBest: true });
    expect(p.slipSan).toBe("Nf6");
    expect(p.swing).toBeGreaterThan(40);
    expect(happenedText(p)).toBe("The engine played Nf6, a mistake. You answered 4. Qxf7#.");
    expect(betterText(p)).toBe("Your move was the engine's top choice.");
    expect(p.why).toBe("Qxf7# is checkmate, taking advantage of the engine's slip.");
    expect(engineLesson(points)).toMatch(/punished the engine's slips/);
  });

  it("doesn't call recovering from your own blunder 'Well spotted'", () => {
    // 1. e4 e5 2. Ba6?? (hangs the bishop) Nf6 (the engine lets it be) 3. Bf1 (retreat).
    const moves = ["e2e4", "e7e5", "f1a6", "g8f6", "a6f1", "b8c6"];
    const analyses = [
      an("e2e4", { cp: 30 }),
      an("e7e5", { cp: 30 }),
      an("g1f3", { cp: 30 }),
      an("b7a6", { cp: -300 }),
      an("a6f1", { cp: 20 }),
      an("b8c6", { cp: 20 }),
      an("g1f3", { cp: 20 }),
    ];
    const points = turningPoints(moves, analyses, 0);
    expect(points.map((p) => [p.ply, p.kind])).toEqual([[2, "mistake"]]);
  });

  it("explains a missed mate or material from the engine's facts", () => {
    // The player (White) misses 4. Qxf7# and plays 4. a3 instead.
    const moves = [...SCHOLAR.slice(0, 6), "a2a3"];
    const analyses = [...scholarAnalyses.slice(0, 7), an("c6d4", { cp: 0 })];
    const [p] = turningPoints(moves, analyses, 0);
    expect(p).toMatchObject({ ply: 6, kind: "missed", bestSan: "Qxf7#", bestMates: true });
    expect(betterText(p!)).toBe("Qxf7# was better.");
    expect(p!.why).toBe("Qxf7# leads to a forced mate.");
    expect(engineLesson([p!])).toMatch(/every check and capture/);
  });

  it("warns about a piece left where it can be captured", () => {
    // 1. e4 e5 2. Ba6?: the bishop can be taken.
    const moves = ["e2e4", "e7e5", "f1a6", "b7a6"];
    const analyses = [
      an("e2e4", { cp: 30 }),
      an("e7e5", { cp: 30 }),
      an("g1f3", { cp: 30 }),
      an("b7a6", { cp: -300 }),
      an("g1f3", { cp: -300 }),
    ];
    const [p] = turningPoints(moves, analyses, 0);
    expect(p!.kind).toBe("mistake");
    expect(p!.why).toBe(
      "Nf3 attacks Black's pawn on e5. After Ba6, your piece on a6 could be captured.",
    );
    expect(engineLesson([p!])).toMatch(/can be captured on its new square/);
  });
});

const quietReview = (): GameReview =>
  engineReview(
    "You resigned. The engine wins.",
    turningPoints(QUIET, fakeAnalyses(QUIET, quietEvals), 0),
  );

describe("buildReviewPrompt", () => {
  it("gives the engine's facts, asks for JSON, and forbids calculating", () => {
    const review = quietReview();
    const prompt = buildReviewPrompt(review, QUIET, "white", "3 (Improving beginner)");
    expect(prompt).toContain("Do not calculate variations yourself");
    expect(prompt).toContain(
      '{"points":[{"ply":2,"why":"..."},{"ply":6,"why":"..."},{"ply":8,"why":"..."},{"ply":10,"why":"..."},{"ply":12,"why":"..."}],"lesson":"..."}',
    );
    expect(prompt).toContain("Moves: 1. e4 e5 2. Nf3 Nc6");
    expect(prompt).toContain("Result: You resigned. The engine wins.");
    const p = review.points[0]!;
    expect(prompt).toContain(`The engine's best move: ${p.bestSan}.`);
  });

  it("says so when there are no turning points", () => {
    const prompt = buildReviewPrompt(engineReview("Draw.", []), QUIET, "black", "1");
    expect(prompt).toContain("No turning points");
    expect(prompt).toContain('{"points":[],"lesson":"..."}');
  });
});

describe("parseReviewAnswer", () => {
  it("reads JSON, also inside a code fence", () => {
    const text = '```json\n{"points":[{"ply":2,"why":" Because. "}],"lesson":"Look twice."}\n```';
    expect(parseReviewAnswer(text)).toEqual({
      points: [{ ply: 2, why: "Because." }],
      lesson: "Look twice.",
    });
  });

  it("returns null for text that isn't the answer", () => {
    expect(parseReviewAnswer("Sorry, I can't.")).toBeNull();
    expect(parseReviewAnswer("{not json}")).toBeNull();
    expect(parseReviewAnswer('{"other":1}')).toBeNull();
  });

  it("skips malformed points", () => {
    expect(
      parseReviewAnswer('{"points":[{"ply":"2","why":"x"},{"ply":4,"why":"ok"}],"lesson":""}'),
    ).toEqual({ points: [{ ply: 4, why: "ok" }], lesson: "" });
  });
});

describe("applyCoachAnswer", () => {
  it("uses the coach's words where they pass the check, and the engine's elsewhere", () => {
    const review = quietReview();
    const [a, b, c] = review.points;
    const out = applyCoachAnswer(
      review,
      {
        points: [
          { ply: a!.ply, why: `${a!.bestSan} keeps your pieces working together.` },
          { ply: b!.ply, why: "Qxf7# was there." }, // a move nobody played or gave
          { ply: c!.ply, why: "word ".repeat(WHY_WORDS + 1) }, // too long
        ],
        lesson: "Before each move, ask what it leaves undefended.",
      },
      false,
      QUIET,
    );
    expect(out.points[0]).toMatchObject({
      whyBy: "coach",
      why: `${a!.bestSan} keeps your pieces working together.`,
    });
    expect(out.points[1]).toMatchObject({ whyBy: "engine", why: b!.why });
    expect(out.points[2]).toMatchObject({ whyBy: "engine", why: c!.why });
    expect(out.points[3]!.whyBy).toBe("engine"); // missing from the answer
    expect(out).toMatchObject({
      lessonBy: "coach",
      lesson: "Before each move, ask what it leaves undefended.",
    });
  });

  it("keeps the engine's lesson when the coach's fails", () => {
    const review = quietReview();
    const long = applyCoachAnswer(
      review,
      { points: [], lesson: "x ".repeat(LESSON_WORDS + 1) },
      false,
      QUIET,
    );
    expect(long.lessonBy).toBe("engine");
    const invented = applyCoachAnswer(
      review,
      { points: [], lesson: "Always play Nxe5." },
      false,
      QUIET,
    );
    expect(invented.lesson).toBe(review.lesson);
  });

  it("ignores a truncated or unreadable answer", () => {
    const review = quietReview();
    const answer = { points: [{ ply: 2, why: "Fine." }], lesson: "Fine." };
    expect(applyCoachAnswer(review, answer, true, QUIET)).toEqual(review);
    expect(applyCoachAnswer(review, null, false, QUIET)).toEqual(review);
  });

  it("is plain JSON, so it can be saved with the game", () => {
    const review = quietReview();
    expect(JSON.parse(JSON.stringify(review))).toEqual(review);
  });
});

describe("analyseGame", () => {
  const fakeEngine = () => ({
    analyse: vi.fn(async (pos: { moves?: string[] }, _limits?: unknown) => {
      const game = gameAt(pos);
      const m = game.moves({ verbose: true })[0];
      return an(m ? `${m.from}${m.to}` : null, { cp: 0 });
    }),
  });

  it("searches every position once, with candidate lines, and reports progress", async () => {
    const engine = fakeEngine();
    const progress: number[] = [];
    const out = await analyseGame(engine, SCHOLAR, { onProgress: (d) => progress.push(d) });
    expect(out).toHaveLength(SCHOLAR.length + 1);
    expect(engine.analyse).toHaveBeenCalledTimes(SCHOLAR.length + 1);
    expect(engine.analyse.mock.calls[3]![0]).toEqual({ moves: SCHOLAR.slice(0, 3) });
    expect(engine.analyse.mock.calls[0]![1]).toEqual({ movetime: 400, multiPv: 3 });
    expect(progress).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("stops between searches when asked", async () => {
    const engine = fakeEngine();
    const ctl = new AbortController();
    const run = analyseGame(engine, SCHOLAR, {
      signal: ctl.signal,
      onProgress: (d) => {
        if (d === 2) ctl.abort();
      },
    });
    await expect(run).rejects.toBeInstanceOf(ReviewStopped);
    expect(engine.analyse.mock.calls.length).toBeLessThanOrEqual(3);
  });
});
