import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkPuzzle } from "../../scripts/lib/check-puzzle";
import { NodeEngine } from "../../scripts/lib/uci-node";
import { PUZZLES } from "../../src/puzzles/puzzles";

const DEPTH = Number(process.env.PUZZLE_DEPTH ?? 18);
let engine: NodeEngine;

beforeAll(async () => {
  engine = new NodeEngine();
  await engine.init(2);
});
afterAll(() => engine.quit());

describe("checkPuzzle (engine)", () => {
  it("accepts a back-rank mate in one", async () => {
    // After Black's setup move ...b6, Ra1-a8 mates on the back rank.
    const why = await checkPuzzle("6k1/1p3ppp/8/8/8/8/5PPP/R5K1 b - - 0 1", ["b7b6", "a1a8"], (p) =>
      engine.search(p, 12),
    );
    expect(why).toBeNull();
  });

  it("rejects an answer that isn't the engine's move", async () => {
    // A quiet king move instead of the mate.
    const why = await checkPuzzle("6k1/1p3ppp/8/8/8/8/5PPP/R5K1 b - - 0 1", ["b7b6", "g1f1"], (p) =>
      engine.search(p, 12),
    );
    expect(why).toMatch(/engine prefers/);
  });
});

describe("bundled puzzles (engine)", () => {
  const all = Object.entries(PUZZLES.t).flatMap(([theme, list]) =>
    (list ?? []).map((t) => ({ theme, t })),
  );
  it(`Stockfish confirms all ${all.length} bundled puzzles`, async () => {
    const failures: string[] = [];
    for (const { theme, t } of all) {
      const why = await checkPuzzle(t[1], t[2].split(" "), (p) => engine.search(p, DEPTH));
      if (why) failures.push(`${theme} ${t[0]}: ${why}`);
    }
    expect(failures).toEqual([]);
  });
});
