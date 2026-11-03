import { Chess } from "chess.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkPuzzle } from "../../scripts/lib/check-puzzle";
import { NodeEngine } from "../../scripts/lib/uci-node";
import type { Analysis, SearchInfo } from "../../src/engine/uci";
import { LESSONS } from "../../src/lessons/catalog";
import { judgeSafe } from "../../src/lessons/safety-net";

const DEPTH = Number(process.env.PUZZLE_DEPTH ?? 18);
let engine: NodeEngine;

const toAnalysis = (i: SearchInfo): Analysis => ({
  bestMove: i.pv[0] ?? null,
  depth: i.depth,
  score: i.score,
  pv: i.pv,
  ms: 0,
});

/** Centipawns a book move may give away against the engine's best move. */
const BOOK_LOSS = 60;

/** Score in centipawns for the side to move after `moves` (mates count as very large). */
async function scoreFor(fen: string, moves: string[]): Promise<number> {
  const [best] = await engine.search({ fen, moves }, DEPTH);
  const s = best?.score;
  const white = s?.mate !== undefined ? Math.sign(s.mate) * 100000 : (s?.cp ?? 0);
  const game = new Chess(fen);
  for (const m of moves) game.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
  return game.turn() === "w" ? white : -white;
}

/** Each move of an opening line is within BOOK_LOSS of the engine's best: a book move, not a mistake. */
async function bookLossFailures(fen: string, sans: string[]): Promise<string[]> {
  const failures: string[] = [];
  const game = new Chess(fen);
  const moves: string[] = [];
  for (const san of sans) {
    const best = await scoreFor(fen, moves);
    const m = game.move(san);
    moves.push(m.from + m.to + (m.promotion ?? ""));
    // A mate ends the line: nothing is left to compare.
    if (game.isCheckmate()) break;
    const after = -(await scoreFor(fen, moves));
    if (best - after > BOOK_LOSS) failures.push(`${san}: loses ${best - after} cp`);
  }
  return failures;
}

beforeAll(async () => {
  engine = new NodeEngine();
  await engine.init(2);
});
afterAll(() => engine.quit());

/** CI passes the lessons whose content changed (comma-separated); unset checks every lesson. */
const ONLY = process.env.LESSON_IDS?.split(",").filter(Boolean);
const unknown = ONLY?.filter((id) => !LESSONS.some((l) => l.id === id)) ?? [];
if (unknown.length > 0)
  throw new Error(
    `No lesson has the id ${unknown.join(", ")}: rename the content file or check all`,
  );

describe.each(LESSONS.filter((l) => !ONLY || ONLY.includes(l.id)).map((l) => [l.id, l] as const))(
  "lesson %s (engine)",
  (_id, lesson) => {
    it("Stockfish confirms every exercise position the lesson brings", async () => {
      const failures: string[] = [];
      for (const step of lesson.steps) {
        if (step.kind !== "exercise") continue;
        if (step.theme === "play") {
          // The goal can be met against the engine: a forced mate, or for
          // "develop" a position no worse than equal.
          for (const [id, fen] of step.positions) {
            const [best] = await engine.search({ fen, moves: [] }, DEPTH);
            const side = fen.split(" ")[1] === "w" ? 1 : -1;
            const mate = best?.score.mate;
            if (step.goal === "mate" && !(mate !== undefined && mate * side > 0))
              failures.push(`${id}: no forced mate (${JSON.stringify(best?.score)})`);
            if (step.goal === "develop" && side * (best?.score.cp ?? 0) < -50)
              failures.push(`${id}: worse than equal (${JSON.stringify(best?.score)})`);
          }
          continue;
        }
        if (step.theme === "drill") {
          failures.push(...(await bookLossFailures(new Chess().fen(), step.line.split(" "))));
          continue;
        }
        for (const [id, fen, moves] of step.fallback) {
          if (step.theme === "safe") {
            // No single answer: the reference move must be judged safe, as the page
            // would judge it. The rules test checks there is a threat to answer.
            const [setup, reference] = moves.split(" ") as [string, string];
            const [after] = await engine.search({ fen, moves: [setup, reference] }, DEPTH);
            const j = judgeSafe(fen, [setup], reference, after ? toAnalysis(after) : null);
            if (j.kind !== "safe") failures.push(`${id}: reference move ${reference} is ${j.kind}`);
            continue;
          }
          const why = await checkPuzzle(fen, moves.split(" "), (p) => engine.search(p, DEPTH));
          if (why) failures.push(`${id}: ${why}`);
        }
      }
      expect(failures).toEqual([]);
    });

    it("every move a Show step plays is the engine's choice", async () => {
      const failures: string[] = [];
      for (const step of lesson.steps) {
        if (step.kind !== "show") continue;
        if (step.nearBest) {
          failures.push(
            ...(await bookLossFailures(
              step.fen,
              step.line.map((m) => m.san),
            )),
          );
          continue;
        }
        const game = new Chess(step.fen);
        const moves: string[] = [];
        for (const m of step.line) {
          const [best] = await engine.search({ fen: step.fen, moves }, DEPTH);
          const played = game.move(m.san);
          const uci = played.from + played.to + (played.promotion ?? "");
          if (best?.pv[0] !== uci) failures.push(`${m.san}: engine prefers ${best?.pv[0]}`);
          moves.push(uci);
        }
      }
      expect(failures).toEqual([]);
    });
  },
);
