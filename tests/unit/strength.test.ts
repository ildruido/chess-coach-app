import { describe, expect, it } from "vitest";
import {
  LEVELS,
  candidates,
  levelById,
  moverCp,
  pickMove,
  seededRandom,
} from "../../src/engine/strength";
import type { SearchInfo } from "../../src/engine/uci";

// Candidate lines as the engine reports them (scores from White's view).
const line = (multipv: number, move: string, cp: number): SearchInfo => ({
  depth: 6,
  multipv,
  score: { cp },
  pv: [move],
});

// White to move: best is +100, then small and large losses.
const LINES = [
  line(1, "e2e4", 100),
  line(2, "d2d4", 90),
  line(3, "g1f3", 60),
  line(4, "b1a3", -150),
  line(5, "f2f3", -600),
];

function choices(levelId: number, side: "w" | "b", lines: SearchInfo[], n = 2000) {
  const rng = seededRandom(levelId * 7919);
  const counts = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const m = pickMove(lines, side, levelById(levelId), rng)!;
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  return counts;
}

describe("moverCp", () => {
  it("turns White's view into the mover's view", () => {
    expect(moverCp({ cp: 120 }, "w")).toBe(120);
    expect(moverCp({ cp: 120 }, "b")).toBe(-120);
  });

  it("treats an already-checkmated side as lost", () => {
    expect(moverCp({ mate: 0 }, "w")).toBe(-100_000);
    expect(moverCp({ mate: 0 }, "b")).toBe(-100_000);
  });

  it("ranks mates above any material, quicker mates higher", () => {
    expect(moverCp({ mate: 2 }, "w")).toBeGreaterThan(moverCp({ mate: 5 }, "w"));
    expect(moverCp({ mate: 5 }, "w")).toBeGreaterThan(moverCp({ cp: 5000 }, "w"));
    expect(moverCp({ mate: -3 }, "b")).toBeGreaterThan(50_000);
  });
});

describe("candidates", () => {
  it("measures each move's loss against the best", () => {
    expect(candidates(LINES, "w").map((c) => c.loss)).toEqual([0, 10, 40, 250, 700]);
  });

  it("works from Black's side too", () => {
    // Black to move: White-view -50 is best for Black.
    const lines = [line(1, "e7e5", -50), line(2, "a7a6", 20)];
    expect(candidates(lines, "b")).toEqual([
      { move: "e7e5", loss: 0 },
      { move: "a7a6", loss: 70 },
    ]);
  });
});

describe("pickMove", () => {
  it("returns null with no candidates", () => {
    expect(pickMove([], "w", LEVELS[0]!)).toBeNull();
  });

  it("the club level nearly always plays a top move and never a blunder", () => {
    const c = choices(6, "w", LINES);
    const top = (c.get("e2e4") ?? 0) + (c.get("d2d4") ?? 0);
    expect(top / 2000).toBeGreaterThan(0.95);
    expect(c.get("f2f3") ?? 0).toBe(0);
    expect(c.get("b1a3") ?? 0).toBe(0);
  });

  it("the first-games level makes real mistakes, but still mostly reasonable moves", () => {
    const c = choices(1, "w", LINES);
    const bad = (c.get("b1a3") ?? 0) + (c.get("f2f3") ?? 0);
    expect(bad / 2000).toBeGreaterThan(0.15);
    expect(bad / 2000).toBeLessThan(0.6);
  });

  it("weaker levels pick the best move less often", () => {
    const bestShare = LEVELS.map((l) => (choices(l.id, "w", LINES).get("e2e4") ?? 0) / 2000);
    for (let i = 1; i < bestShare.length; i++) {
      expect(bestShare[i]!).toBeGreaterThan(bestShare[i - 1]! - 0.02);
    }
    expect(bestShare.at(-1)!).toBeGreaterThan(bestShare[0]! + 0.2);
  });

  it("from level 2 up, never misses a mate it sees; the club level takes the quickest", () => {
    // Black to move; scores are from White's view, so Black's mates are negative.
    const blackMates: SearchInfo[] = [
      { depth: 4, multipv: 1, score: { mate: -1 }, pv: ["d8h4"] },
      { depth: 4, multipv: 2, score: { mate: -3 }, pv: ["f8c5"] },
      { depth: 4, multipv: 3, score: { cp: -300 }, pv: ["a7a6"] },
    ];
    for (const id of [2, 3, 4, 5, 6]) {
      expect(choices(id, "b", blackMates, 300).get("a7a6") ?? 0, `level ${id}`).toBe(0);
    }
    expect(choices(6, "b", blackMates, 300).get("d8h4")).toBe(300);
  });

  it("only the first-games level can miss a mate", () => {
    const lines = [
      { depth: 1, multipv: 1, score: { mate: 1 }, pv: ["d1h5"] },
      { depth: 1, multipv: 2, score: { cp: 50 }, pv: ["a2a3"] },
    ];
    expect(choices(1, "w", lines).get("a2a3") ?? 0).toBeGreaterThan(0);
    expect(choices(2, "w", lines).get("a2a3") ?? 0).toBe(0);
  });

  it("never plays a move outside the engine's candidates", () => {
    for (const l of LEVELS) {
      for (const m of choices(l.id, "w", LINES, 200).keys()) {
        expect(LINES.map((x) => x.pv[0])).toContain(m);
      }
    }
  });
});

describe("levels", () => {
  it("are numbered 1 to 6 and get stronger in every setting", () => {
    expect(LEVELS.map((l) => l.id)).toEqual([1, 2, 3, 4, 5, 6]);
    for (let i = 1; i < LEVELS.length; i++) {
      const [a, b] = [LEVELS[i - 1]!, LEVELS[i]!];
      expect(b.depth).toBeGreaterThanOrEqual(a.depth);
      expect(b.maxLoss).toBeLessThan(a.maxLoss);
      expect(b.slipChance).toBeLessThanOrEqual(a.slipChance);
    }
  });

  it("falls back to level 1 for an unknown id", () => {
    expect(levelById(42).id).toBe(1);
  });
});

describe("seededRandom", () => {
  it("repeats for the same seed and stays in [0, 1)", () => {
    const a = seededRandom(5);
    const b = seededRandom(5);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
