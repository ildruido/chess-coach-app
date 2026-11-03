// Each tactics lesson's quiz answer follows from the rules of chess: the squares
// a lesson marks as right are exactly the ones the rule finds (CC-028).

import { Chess, type Color, type Square } from "chess.js";
import { describe, expect, it } from "vitest";
import { threatenedPieces } from "../../src/coach/move-facts";
import { LESSONS } from "../../src/lessons/catalog";
import { exercisePool, pickExercises } from "../../src/lessons/exercises";
import type { Lesson, QuizStep } from "../../src/lessons/lesson";
import { startOf } from "../../src/puzzles/puzzles";

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const lesson = (id: string) => LESSONS.find((l) => l.id === id)!;
const quiz = (l: Lesson) => l.steps.find((s): s is QuizStep => s.kind === "quiz")!;
const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort();
const other = (c: Color): Color => (c === "w" ? "b" : "w");

function pieces(g: Chess, color: Color) {
  return g
    .board()
    .flat()
    .filter((c) => c?.color === color) as { square: Square; type: string; color: Color }[];
}

/** Squares of `color`'s pieces that the piece on `from` attacks. */
function attackedBy(g: Chess, from: Square, color: Color): Square[] {
  return pieces(g, color)
    .map((p) => p.square)
    .filter((sq) => g.attackers(sq, other(color)).includes(from));
}

/** A game with the side to move switched, so attackers can be read for the other side. */
function after(fen: string, from: Square, to: Square): Chess {
  const g = new Chess(fen);
  g.move({ from, to, promotion: "q" });
  return g;
}

function quizSquares(id: string) {
  return sorted(quiz(lesson(id)).squares);
}

describe("the lesson catalogue", () => {
  it("lists the first twelve lessons in the plan's order, with unique ids", () => {
    expect(LESSONS.map((l) => l.id)).toEqual([
      "free-pieces",
      "safe-moves",
      "piece-values",
      "mate-in-one",
      "back-rank",
      "forks",
      "pins",
      "skewers",
      "discovered-attacks",
      "opening-principles",
      "italian-game",
      "queen-mate",
    ]);
  });

  it.each(LESSONS.map((l) => [l.id, l] as const))(
    "%s has enough exercises for a fresh set on a replay",
    (_id, l) => {
      for (const s of l.steps) {
        if (s.kind !== "exercise") continue;
        // A drill and a play-out from the start position have nothing to rotate.
        if (s.theme === "drill" || (s.theme === "play" && s.positions.length === 1)) continue;
        expect(exercisePool(s).length).toBeGreaterThanOrEqual(2 * s.count);
        const a = pickExercises(s, 0).map((p) => p.id);
        const b = pickExercises(s, 1).map((p) => p.id);
        expect(a).toHaveLength(s.count);
        expect(a).not.toEqual(b);
      }
    },
  );
});

describe("Don't leave pieces hanging", () => {
  it("every position starts with one of your pieces under attack", () => {
    const ex = lesson("safe-moves").steps.find((s) => s.kind === "exercise")!;
    if (ex.kind !== "exercise") throw new Error("exercise");
    for (const p of exercisePool(ex)) {
      const g = new Chess(startOf(p));
      const mine = threatenedPieces(g).filter((t) => g.get(t.square as Square)?.color === g.turn());
      expect(mine.length, p.id).toBeGreaterThan(0);
      // The reference move is legal.
      expect(() =>
        g.move({ from: p.solution[0]!.slice(0, 2), to: p.solution[0]!.slice(2, 4) }),
      ).not.toThrow();
    }
  });

  it("quiz: the answer is exactly your piece in danger", () => {
    const g = new Chess(quiz(lesson("safe-moves")).fen);
    const mine = threatenedPieces(g)
      .filter((t) => g.get(t.square as Square)?.color === g.turn())
      .map((t) => t.square);
    expect(sorted(mine)).toEqual(quizSquares("safe-moves"));
  });
});

describe("What pieces are worth", () => {
  it("quiz: the answer is the capture that wins the most after the recapture", () => {
    const fen = quiz(lesson("piece-values")).fen;
    const g = new Chess(fen);
    const gains = g
      .moves({ verbose: true })
      .filter((m) => m.captured)
      .map((m) => {
        const defended = new Chess(fen).attackers(m.to, other(g.turn())).length > 0;
        return { to: m.to, gain: VALUE[m.captured!]! - (defended ? VALUE[m.piece]! : 0) };
      });
    const best = Math.max(...gains.map((x) => x.gain));
    expect(best).toBeGreaterThan(0);
    expect(sorted(gains.filter((x) => x.gain === best).map((x) => x.to))).toEqual(
      quizSquares("piece-values"),
    );
  });
});

const matingPieces = (fen: string) =>
  sorted(
    new Chess(fen)
      .moves({ verbose: true })
      .filter((m) => m.san.endsWith("#"))
      .map((m) => m.from),
  );

describe("Checkmate in one", () => {
  it("shows a mate, then a check that isn't mate; the quiz answer is the only mating piece", () => {
    const [mate, check] = lesson("mate-in-one").steps;
    if (mate?.kind !== "explain" || check?.kind !== "explain") throw new Error("explain");
    expect(new Chess(mate.fen).isCheckmate()).toBe(true);
    const c = new Chess(check.fen);
    expect(c.inCheck() && !c.isCheckmate()).toBe(true);
    expect(matingPieces(quiz(lesson("mate-in-one")).fen)).toEqual(quizSquares("mate-in-one"));
  });
});

describe("Back-rank mate", () => {
  it("the mates land on the back rank, and the pawn step gives the king air", () => {
    const [mate, air] = lesson("back-rank").steps;
    if (mate?.kind !== "explain" || air?.kind !== "explain") throw new Error("explain");
    expect(new Chess(mate.fen).isCheckmate()).toBe(true);
    const g = new Chess(air.fen);
    const check = g.move("Ra8+");
    expect(check.to[1]).toBe("8");
    expect(g.isCheckmate()).toBe(false);
    const q = quiz(lesson("back-rank")).fen;
    expect(matingPieces(q)).toEqual(quizSquares("back-rank"));
    const m = new Chess(q).moves({ verbose: true }).filter((x) => x.san.endsWith("#"));
    expect(m.every((x) => x.to[1] === "8")).toBe(true);
  });
});

describe("Forks", () => {
  it("quiz: the answer is the piece that can attack two valuable black pieces at once", () => {
    const fen = quiz(lesson("forks")).fen;
    const g = new Chess(fen);
    const forkers = g
      .moves({ verbose: true })
      .filter((m) => {
        const a = after(fen, m.from, m.to);
        const targets = attackedBy(a, m.to, other(g.turn())).filter((sq) => {
          const t = a.get(sq)!;
          const defended = a.attackers(sq, t.color).length > 0;
          return t.type === "k" || VALUE[t.type]! > VALUE[m.piece]! || !defended;
        });
        return targets.length >= 2;
      })
      .map((m) => m.from);
    expect(sorted(forkers)).toEqual(quizSquares("forks"));
  });
});

/** Black pieces that shield their king from a white piece: removing them puts the king in check. */
function pinnedTo(fen: string, color: Color): string[] {
  const g = new Chess(fen);
  const king = pieces(g, color).find((p) => p.type === "k")!.square;
  return pieces(g, color)
    .filter((p) => p.type !== "k")
    .filter((p) => {
      const t = new Chess(fen);
      t.remove(p.square);
      return t.attackers(king, other(color)).length > g.attackers(king, other(color)).length;
    })
    .map((p) => p.square);
}

describe("Pins", () => {
  it("the explain steps and the quiz show exactly the pinned pieces", () => {
    const [abs] = lesson("pins").steps;
    if (abs?.kind !== "explain") throw new Error("explain");
    expect(pinnedTo(abs.fen, "b")).toEqual(abs.marks);
    expect(sorted(pinnedTo(quiz(lesson("pins")).fen, "b"))).toEqual(quizSquares("pins"));
  });
});

describe("Skewers", () => {
  it("quiz: the answer is the piece whose check has another black piece behind the king", () => {
    const fen = quiz(lesson("skewers")).fen;
    const g = new Chess(fen);
    const skewerers = g
      .moves({ verbose: true })
      .filter((m) => m.san.includes("+") && "brq".includes(m.piece))
      .filter((m) => {
        const a = after(fen, m.from, m.to);
        const before = attackedBy(a, m.to, "b");
        const king = before.find((sq) => a.get(sq)!.type === "k")!;
        a.remove(king);
        return attackedBy(a, m.to, "b").length > before.length - 1;
      })
      .map((m) => m.from);
    expect(sorted(skewerers)).toEqual(quizSquares("skewers"));
  });
});

describe("Discovered attacks", () => {
  it("quiz: the answer is the piece standing between your rook or bishop and the black king", () => {
    const fen = quiz(lesson("discovered-attacks")).fen;
    const g = new Chess(fen);
    const king = pieces(g, "b").find((p) => p.type === "k")!.square;
    const blockers = pieces(g, "w")
      .filter((p) => p.type !== "k")
      .filter((p) => {
        const t = new Chess(fen);
        t.remove(p.square);
        return t.attackers(king, "w").length > g.attackers(king, "w").length;
      })
      .map((p) => p.square);
    expect(sorted(blockers)).toEqual(quizSquares("discovered-attacks"));
  });
});
