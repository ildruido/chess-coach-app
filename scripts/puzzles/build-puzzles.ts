// Builds src/data/puzzles.json from the lichess puzzle database (CC0).
//
//   curl -sL https://database.lichess.org/lichess_db_puzzle.csv.zst | zstd -dc \
//     | npm run --silent data:puzzles
//
// This container can't reach database.lichess.org; the "Lesson puzzles"
// GitHub workflow (.github/workflows/puzzles.yml) runs it instead.
// Picks candidates with src/puzzles/select.ts (twice as many as needed), then
// keeps those Stockfish confirms (scripts/lib/check-puzzle.ts), in order.

import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { Chess } from "chess.js";
import type { PuzzleFile, PuzzleTuple } from "../../src/puzzles/puzzles";
import {
  LESSON_THEMES,
  THEME_COUNTS,
  parseRow,
  selectPuzzles,
  themeOf,
  type CsvPuzzle,
  type LessonTheme,
} from "../../src/puzzles/select";
import { checkPuzzle } from "../lib/check-puzzle";
import { NodeEngine } from "../lib/uci-node";

const OUT = new URL("../../src/data/puzzles.json", import.meta.url);
const DEPTH = Number(process.env.PUZZLE_DEPTH ?? 18);
const SCALE = Number(process.env.PUZZLE_SCALE ?? 1);
/** A theme that keeps fewer than this share of its target fails the build. */
const MIN_SHARE = 0.8;

function legal(p: CsvPuzzle): boolean {
  try {
    const game = new Chess(p.fen);
    for (const m of p.moves) game.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!Number.isFinite(SCALE) || SCALE <= 0) throw new Error(`Bad PUZZLE_SCALE: ${SCALE}`);
  const candidates: CsvPuzzle[] = [];
  let rows = 0;
  for await (const line of createInterface({ input: process.stdin })) {
    rows++;
    const p = parseRow(line);
    if (p && themeOf(p) && legal(p)) candidates.push(p);
  }
  console.warn(`${rows} rows, ${candidates.length} candidates`);

  const want = {} as Record<LessonTheme, number>;
  for (const t of LESSON_THEMES) want[t] = Math.round(THEME_COUNTS[t] * SCALE);
  const doubled = {} as Record<LessonTheme, number>;
  for (const t of LESSON_THEMES) doubled[t] = want[t] * 2;
  const picked = selectPuzzles(candidates, doubled);

  const engine = new NodeEngine();
  await engine.init(2);
  const file: PuzzleFile = {
    v: 1,
    generated: new Date().toISOString().slice(0, 10),
    source: "lichess.org puzzle database (CC0)",
    t: {},
  };
  for (const theme of LESSON_THEMES) {
    const kept: PuzzleTuple[] = [];
    for (const p of picked[theme]) {
      if (kept.length >= want[theme]) break;
      const why = await checkPuzzle(p.fen, p.moves, (pos) => engine.search(pos, DEPTH));
      if (why) {
        console.warn(`drop ${theme} ${p.id}: ${why}`);
        continue;
      }
      kept.push([p.id, p.fen, p.moves.join(" "), p.rating]);
    }
    kept.sort((a, b) => a[3] - b[3] || a[0].localeCompare(b[0]));
    file.t[theme] = kept;
    console.warn(`${theme}: ${kept.length} of ${want[theme]}`);
  }
  engine.quit();
  const short = LESSON_THEMES.filter((t) => (file.t[t]?.length ?? 0) < want[t] * MIN_SHARE);
  if (short.length) {
    console.error(`Too few puzzles for: ${short.join(", ")}. Nothing written.`);
    process.exit(1);
  }
  writeFileSync(OUT, JSON.stringify(file) + "\n");
}

await main();
