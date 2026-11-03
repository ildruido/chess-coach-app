// Builds src/data/openings.json from the lichess chess-openings list (CC0).
//
//   npm run data:openings
//
// Downloads a.tsv to e.tsv at a pinned commit, replays each line with chess.js
// and keys the final position (see positionKey), so transpositions get a name.
// When two lines reach the same position, the shorter one keeps it.

import { writeFileSync } from "node:fs";
import { Chess } from "chess.js";
import { positionKey } from "../../src/openings/opening-name";

const SHA = "a6189a30dc273ccb21fc2536a9a2fefd5592a67a";
const BASE = `https://raw.githubusercontent.com/lichess-org/chess-openings/${SHA}`;
const OUT = new URL("../../src/data/openings.json", import.meta.url);

interface Line {
  eco: string;
  name: string;
  sans: string[];
}

function parseTsv(text: string): Line[] {
  const lines: Line[] = [];
  for (const row of text.split("\n").slice(1)) {
    if (!row.trim()) continue;
    const [eco, name, pgn] = row.split("\t");
    if (!eco || !name || !pgn) throw new Error(`Bad row: ${row}`);
    const sans = pgn
      .split(/\s+/)
      .filter((t) => t && !/^\d+\.+$/.test(t))
      .map((t) => t.replace(/^\d+\.+/, ""));
    lines.push({ eco, name, sans });
  }
  return lines;
}

async function main() {
  const lines: Line[] = [];
  for (const f of ["a", "b", "c", "d", "e"]) {
    const res = await fetch(`${BASE}/${f}.tsv`);
    if (!res.ok) throw new Error(`${f}.tsv: HTTP ${res.status}`);
    lines.push(...parseTsv(await res.text()));
  }
  const o: Record<string, string> = {};
  const plyOf: Record<string, number> = {};
  let maxPly = 0;
  for (const line of lines) {
    const game = new Chess();
    for (const san of line.sans) game.move(san);
    const key = positionKey(game.fen());
    const ply = line.sans.length;
    maxPly = Math.max(maxPly, ply);
    if (o[key] && plyOf[key]! <= ply) continue;
    o[key] = `${line.eco}|${line.name}`;
    plyOf[key] = ply;
  }
  const out = { source: `lichess-org/chess-openings@${SHA} (CC0)`, maxPly, o };
  writeFileSync(OUT, JSON.stringify(out) + "\n");
  console.warn(`${lines.length} lines, ${Object.keys(o).length} positions, maxPly ${maxPly}`);
}

await main();
