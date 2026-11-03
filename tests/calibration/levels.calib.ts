// Engine-vs-engine matches between neighbouring levels, to check that every
// level is clearly stronger than the one below, and to measure how often each
// level makes real mistakes. Run with: npm run calibrate (GAMES=20 for more).
//
// Two engines per pairing, so measuring never changes what is measured:
// - the player engine makes the levels' moves exactly as the app does
//   (a fresh game each time, and a cleared hash before every level move);
// - the judge engine evaluates every move with a fixed deeper search and
//   adjudicates unfinished games.
//
// Writes docs/CALIBRATION.md only when every pairing passes with at least 10
// games; smaller or failing runs print the report instead.
import { writeFileSync } from "node:fs";
import { Chess } from "chess.js";
import { afterAll, describe, expect, it } from "vitest";
import { gameAt } from "../../src/chess/notation";
import { LEVELS, type Level, moverCp, pickMove, seededRandom } from "../../src/engine/strength";
import { NodeEngine } from "./node-engine";

const GAMES = Number(process.env.GAMES ?? 10);
const MAX_PLIES = 160;
const ADJUDICATE_DEPTH = 12;
/** Every move by every level is judged by a search this deep. */
const REFERENCE_DEPTH = 10;
/** Moves are only counted while the game is still open (within 10 pawns). */
const OPEN_GAME = 1000;
/** A level should score at least this much against the level below it. */
const MIN_SCORE = 0.6;

interface Stats {
  moves: number;
  totalLoss: number;
  mistakes: number; // loss >= 100
  blunders: number; // loss >= 300
}

const stats = new Map<number, Stats>(
  LEVELS.map((l) => [l.id, { moves: 0, totalLoss: 0, mistakes: 0, blunders: 0 }]),
);
const results = new Map<number, { line: string; passed: boolean }>();

/** Evaluation for the side to move, by the judge's fixed reference search. */
async function referenceEval(judge: NodeEngine, moves: string[], game: Chess): Promise<number> {
  if (game.isCheckmate()) return -100_000;
  if (game.isGameOver()) return 0;
  const a = await judge.analyse({ moves }, REFERENCE_DEPTH, 1);
  return moverCp(a.lines[0]?.score, game.turn());
}

async function playGame(
  player: NodeEngine,
  judge: NodeEngine,
  white: Level,
  black: Level,
  seed: number,
) {
  const rng = seededRandom(seed);
  const moves: string[] = [];
  let game: Chess = gameAt({});
  await player.newGame();
  await judge.newGame();
  let before = await referenceEval(judge, moves, game);
  while (!game.isGameOver() && moves.length < MAX_PLIES) {
    const side = game.turn();
    const level = side === "w" ? white : black;
    const a = await player.analyse({ moves }, level.depth, level.multiPv, true);
    const move = pickMove(a.lines, side, level, rng) ?? a.bestMove;
    if (!move) break;
    moves.push(move);
    game = gameAt({ moves });
    // The value before the move, minus the value it left for the mover.
    const after = await referenceEval(judge, moves, game);
    if (Math.abs(before) < OPEN_GAME) {
      const loss = Math.min(Math.max(0, before + after), OPEN_GAME);
      const s = stats.get(level.id)!;
      s.moves++;
      s.totalLoss += loss;
      if (loss >= 100) s.mistakes++;
      if (loss >= 300) s.blunders++;
    }
    before = after;
  }
  if (game.isCheckmate()) return game.turn() === "w" ? 0 : 1; // White's points
  if (game.isGameOver()) return 0.5;
  const final = await judge.analyse({ moves }, ADJUDICATE_DEPTH, 1);
  const cp = moverCp(final.lines[0]?.score, "w");
  return cp > 150 ? 1 : cp < -150 ? 0 : 0.5;
}

describe("level calibration", () => {
  const pairs = LEVELS.slice(0, -1).map((l, i) => [l, LEVELS[i + 1]!] as const);

  for (const [lower, upper] of pairs) {
    it(`${upper.name} beats ${lower.name}`, { timeout: 30 * 60_000 }, async () => {
      const [player, judge] = await Promise.all([NodeEngine.start(), NodeEngine.start()]);
      let upperPoints = 0;
      try {
        for (let g = 0; g < GAMES; g++) {
          const upperWhite = g % 2 === 0;
          const white = upperWhite ? upper : lower;
          const black = upperWhite ? lower : upper;
          const whitePoints = await playGame(player, judge, white, black, 1000 * upper.id + g);
          upperPoints += upperWhite ? whitePoints : 1 - whitePoints;
        }
      } finally {
        player.quit();
        judge.quit();
      }
      const score = upperPoints / GAMES;
      results.set(upper.id, {
        line: `| ${upper.id} ${upper.name} vs ${lower.id} ${lower.name} | ${upperPoints} / ${GAMES} | ${(score * 100).toFixed(0)}% |`,
        passed: score >= MIN_SCORE,
      });
      expect(score).toBeGreaterThanOrEqual(MIN_SCORE);
    });
  }

  afterAll(() => {
    const levelRows = LEVELS.map((l) => {
      const s = stats.get(l.id)!;
      const pct = (n: number) => (s.moves ? ((n / s.moves) * 100).toFixed(1) + "%" : "-");
      const avg = s.moves ? (s.totalLoss / s.moves).toFixed(0) : "-";
      return `| ${l.id} ${l.name} | ${s.moves} | ${avg} | ${pct(s.mistakes)} | ${pct(s.blunders)} |`;
    });
    const rows = [...results.entries()].sort(([a], [b]) => a - b).map(([, r]) => r.line);
    const report = [
      "# Engine level calibration",
      "",
      `Generated by \`npm run calibrate\` on ${new Date().toISOString().slice(0, 10)}: ${GAMES} games per pair of neighbouring levels, colors alternating, Stockfish 19 lite.`,
      "",
      "Method:",
      "- A player engine makes the levels' moves exactly as the app does: a fresh game each time, and a cleared hash before every level move.",
      `- A separate judge engine evaluates every move with a fixed depth-${REFERENCE_DEPTH} search.`,
      `- Games still running after ${MAX_PLIES} plies are adjudicated by a depth-${ADJUDICATE_DEPTH} evaluation: more than 1.5 pawns ahead wins.`,
      "",
      "## Head to head",
      "",
      `Each level should score at least ${MIN_SCORE * 100}% against the level below.`,
      "",
      "| Pairing | Points for the stronger level | Score |",
      "| --- | --- | --- |",
      ...rows,
      "",
      "## How each level plays",
      "",
      `- Loss is measured in centipawns (100 = one pawn) by the judge's depth-${REFERENCE_DEPTH} search, the same for every level.`,
      "- A mistake loses at least a pawn; a blunder at least 3 pawns (about a piece).",
      `- Only moves played while the game is still open (within ${OPEN_GAME / 100} pawns) count, so won or lost positions don't hide mistakes.`,
      "- Levels 1 and 6 play one pairing each, the others two, so their opponents differ.",
      "",
      "| Level | Moves counted | Average loss per move | Mistakes | Blunders |",
      "| --- | --- | --- | --- | --- |",
      ...levelRows,
      "",
    ].join("\n");
    const complete = results.size === pairs.length && [...results.values()].every((r) => r.passed);
    if (complete && GAMES >= 10) {
      writeFileSync(new URL("../../docs/CALIBRATION.md", import.meta.url), report);
    } else {
      console.warn(`Report not written (needs every pairing passing and GAMES >= 10):\n${report}`);
    }
  });
});
