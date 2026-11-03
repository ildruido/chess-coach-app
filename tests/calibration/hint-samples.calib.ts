// Hint prompt sampling (CC-018, CC-019): writes the real hint prompts for
// positions from engine games, then fact-checks coach answers to them.
// The quick model can't be called from here, so a small Claude model (e.g. a
// Haiku subagent) answers the prompts; see CLAUDE.md "Domain rules".
//
//   1. SAMPLES=dir STAGES=plan,piece [LEVEL=1] npm run calibrate -- hint-samples
//      writes dir/prompts.json and dir/batch*.txt ("=== PROMPT id:stage ===").
//   2. Have the model answer each batch into dir/answers*.json ({ "id:stage": text }).
//   3. Run step 1 again: with answers present it writes dir/report.md
//      (counts per rule, and every refused answer).
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { gameAt } from "../../src/chess/notation";
import { type HintStage, buildFacts, buildHintPrompt, factCheck } from "../../src/coach/hint";
import { LEVELS, pickMove, seededRandom } from "../../src/engine/strength";
import { NodeEngine } from "./node-engine";

const DIR = process.env.SAMPLES;
const STAGES = (process.env.STAGES ?? "question,plan,piece").split(",") as HintStage[];
const BATCHES = 4;
/** Level both sides play at (1 leaves pieces hanging, as in Ale's games). */
const LEVEL = LEVELS[Number(process.env.LEVEL ?? 2) - 1]!;

interface Item {
  id: string;
  moves: string[];
  facts: ReturnType<typeof buildFacts>;
  prompts: Partial<Record<HintStage, string>>;
}

it.skipIf(!DIR)(
  "hint samples",
  async () => {
    const dir = DIR!;
    const answerFiles = existsSync(dir)
      ? readdirSync(dir).filter((f) => /^answers.*\.json$/.test(f))
      : [];
    if (answerFiles.length && existsSync(`${dir}/prompts.json`)) {
      report(dir, answerFiles);
      return;
    }
    const engine = await NodeEngine.start();
    const items: Item[] = [];
    for (let g = 0; g < 6; g++) {
      const rng = seededRandom(100 + g);
      const moves: string[] = [];
      let game = gameAt({});
      await engine.newGame();
      while (!game.isGameOver() && moves.length < 44) {
        if (moves.length >= 4 && moves.length % 5 === g % 5) {
          const a = await engine.analyse({ moves }, 14, 1);
          const top = a.lines[0];
          const facts = buildFacts(game, {
            bestMove: a.bestMove,
            depth: top?.depth ?? 0,
            score: top?.score,
            pv: top?.pv ?? [],
            ms: 0,
          });
          const prompts = Object.fromEntries(STAGES.map((s) => [s, buildHintPrompt(facts, s)]));
          items.push({ id: `g${g}p${moves.length}`, moves: [...moves], facts, prompts });
        }
        const a = await engine.analyse({ moves }, LEVEL.depth, LEVEL.multiPv, true);
        const move = pickMove(a.lines, game.turn(), LEVEL, rng) ?? a.bestMove;
        if (!move) break;
        moves.push(move);
        game = gameAt({ moves });
      }
    }
    engine.quit();
    writeFileSync(`${dir}/prompts.json`, JSON.stringify(items, null, 1));
    const jobs = items.flatMap((x) =>
      STAGES.map((s) => `=== PROMPT ${x.id}:${s} ===\n${x.prompts[s]}`),
    );
    for (let i = 0; i < BATCHES; i++) {
      writeFileSync(`${dir}/batch${i}.txt`, jobs.filter((_, j) => j % BATCHES === i).join("\n\n"));
    }
  },
  600_000,
);

function report(dir: string, files: string[]) {
  const items: Item[] = JSON.parse(readFileSync(`${dir}/prompts.json`, "utf8"));
  const answers: Record<string, string> = {};
  for (const f of files) Object.assign(answers, JSON.parse(readFileSync(`${dir}/${f}`, "utf8")));
  const counts: Record<string, number> = {};
  const rows: string[] = [];
  for (const item of items) {
    for (const [key, text] of Object.entries(answers)) {
      const [id, stage] = key.split(":") as [string, HintStage];
      if (id !== item.id) continue;
      const allowed = [...gameAt({ moves: item.moves }).history(), ...item.facts.lineSans];
      const fc = factCheck(text, stage, item.facts, allowed);
      const rule = fc.unknownMoves.length ? "unknown-move" : (fc.leak?.rule ?? "pass");
      counts[`${stage}:${rule}`] = (counts[`${stage}:${rule}`] ?? 0) + 1;
      // Captures: the hanging-piece positions of a beginner's games.
      const kind = item.facts.bestMove?.includes("x") ? "capture" : "quiet";
      const byKind = `${stage}:${kind}:${rule === "pass" ? "pass" : "refused"}`;
      counts[byKind] = (counts[byKind] ?? 0) + 1;
      if (rule !== "pass") {
        const match = fc.leak?.match ?? fc.unknownMoves.join(", ");
        rows.push(`## ${key} best=${item.facts.bestMove} [${rule}: ${match}]\n${text}\n`);
      }
    }
  }
  writeFileSync(`${dir}/report.md`, `${JSON.stringify(counts, null, 1)}\n\n${rows.join("\n")}`);
}
