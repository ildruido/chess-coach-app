import { Chess, type Square } from "chess.js";
import { describe, expect, it } from "vitest";
import { threatenedPieces } from "../../src/coach/move-facts";
import { exercisePool, exercisesById, pickExercises } from "../../src/lessons/exercises";
import { LESSONS } from "../../src/lessons/catalog";
import { FREE_PIECES } from "../../src/lessons/content/free-pieces";
import { type PuzzleStep, isSquare, textParts, textRefs } from "../../src/lessons/lesson";
import { startOf, type PuzzleFile } from "../../src/puzzles/puzzles";

/** Every check a lesson's text must pass, against the position it describes. */
function checkText(text: string, game: Chess, extraSans: string[] = []) {
  // Move-shaped words must be written in braces, so this test sees them.
  const plain = textParts(text)
    .filter((p) => !p.ref)
    .map((p) => p.text)
    .join(" ");
  expect(plain, text).not.toMatch(/\b(?:[KQRBN]x?[a-h][1-8]|[a-h][1-8])\b/);
  for (const ref of textRefs(text)) {
    // A pawn move ("e4") looks like a square: it passes as either.
    const pawnMove = game.moves().includes(ref) || extraSans.includes(ref);
    if (isSquare(ref) && !pawnMove) {
      expect(game.get(ref as Square), `${ref} in "${text}"`).toBeTruthy();
    } else {
      const legal = game.moves().includes(ref) || extraSans.includes(ref);
      expect(legal, `${ref} in "${text}"`).toBe(true);
    }
  }
}

function checkMarks(game: Chess, s: { arrows?: [string, string][]; marks?: string[] }) {
  for (const [from, to] of s.arrows ?? []) {
    expect(isSquare(from) && isSquare(to)).toBe(true);
    expect(game.get(from as Square), `arrow from ${from}`).toBeTruthy();
  }
  for (const m of s.marks ?? []) expect(isSquare(m)).toBe(true);
}

describe.each(LESSONS.map((l) => [l.id, l] as const))("lesson %s", (_id, lesson) => {
  it("has a title, a takeaway, and steps", () => {
    expect(lesson.title).toBeTruthy();
    expect(lesson.takeaway).toBeTruthy();
    expect(lesson.steps.length).toBeGreaterThan(0);
    expect(lesson.steps.at(-1)!.kind).toBe("exercise");
  });

  it("names only real pieces and legal moves", () => {
    for (const step of lesson.steps) {
      if (step.kind === "exercise") continue;
      const game = new Chess(step.fen);
      if (step.kind === "explain") {
        checkText(step.text, game);
        checkMarks(game, step);
      } else if (step.kind === "show") {
        checkText(step.intro, game);
        for (const m of step.line) {
          const before = new Chess(game.fen());
          game.move(m.san); // throws if illegal
          checkText(m.text, before, [m.san]);
          checkMarks(game, m);
        }
      } else {
        checkText(step.prompt, game);
        checkMarks(game, step);
        // The answer's text is read after the right square is clicked.
        checkText(step.right, game);
        checkText(step.wrong, game);
      }
    }
  });
  it("has two or three suggested questions on every step, naming only real pieces and legal moves", () => {
    for (const step of lesson.steps) {
      expect(step.questions.length, step.kind).toBeGreaterThanOrEqual(2);
      expect(step.questions.length, step.kind).toBeLessThanOrEqual(3);
      for (const { q, a } of step.questions) {
        expect(q.trim() && a.trim()).toBeTruthy();
        if (step.kind === "exercise") {
          // The positions rotate, so exercise questions are about the idea only.
          expect(textRefs(q + a), q).toEqual([]);
          continue;
        }
        const game = new Chess(step.fen);
        const extra = step.kind === "show" ? step.line.map((m) => m.san) : [];
        checkText(q, game, extra);
        checkText(a, game, extra);
      }
    }
  });
});

describe("Free pieces", () => {
  it("quiz: the answer squares are exactly the free black pieces", () => {
    const quiz = FREE_PIECES.steps.find((s) => s.kind === "quiz")!;
    const game = new Chess(quiz.fen);
    const free = threatenedPieces(game)
      .filter((t) => game.get(t.square as Square)?.color === "b")
      .map((t) => t.square);
    expect(free.sort()).toEqual([...quiz.squares].sort());
  });

  it("the explain steps show a free piece, then a defended one", () => {
    const [free, defended] = FREE_PIECES.steps;
    const blackThreats = (fen: string) => {
      const g = new Chess(fen);
      return threatenedPieces(g).filter((t) => g.get(t.square as Square)?.color === "b");
    };
    if (free?.kind !== "explain" || defended?.kind !== "explain") throw new Error("explain steps");
    expect(blackThreats(free.fen).map((t) => t.square)).toEqual(["d5"]);
    expect(blackThreats(defended.fen)).toEqual([]);
  });

  it("each exercise position's answer takes an undefended piece", () => {
    const ex = FREE_PIECES.steps.find((s) => s.kind === "exercise") as PuzzleStep;
    for (const p of exercisePool(ex, { v: 1, generated: null, t: {} })) {
      const game = new Chess(startOf(p));
      const [answer] = p.solution;
      const target = answer!.slice(2, 4) as Square;
      const piece = game.get(target);
      expect(piece, p.id).toBeTruthy();
      expect(game.attackers(target, piece!.color), p.id).toEqual([]);
      game.move({ from: answer!.slice(0, 2), to: target });
    }
  });
});

describe("exercise picking", () => {
  const ex = FREE_PIECES.steps.find((s) => s.kind === "exercise") as PuzzleStep;
  const empty: PuzzleFile = { v: 1, generated: null, t: {} };
  const some: PuzzleFile = {
    v: 1,
    generated: "2026-10-07",
    t: {
      hangingPiece: [
        ["A", "4k3/8/8/8/1n6/2N5/8/4K3 b - - 0 1", "b4d5 c3d5", 500],
        ["B", "4k3/8/8/8/1n6/2N5/8/4K3 b - - 0 1", "b4d5 c3d5", 600],
        ["C", "4k3/8/8/8/1n6/2N5/8/4K3 b - - 0 1", "b4d5 c3d5", 900],
      ],
    },
  };

  it("uses the lesson's own positions when no puzzles are bundled", () => {
    expect(pickExercises(ex, 0, empty).map((p) => p.id)).toEqual([
      "fp-1",
      "fp-2",
      "fp-3",
      "fp-4",
      "fp-5",
    ]);
  });

  it("uses bundled puzzles first, within the rating limit, then fills the gap", () => {
    const ids = pickExercises(ex, 0, some).map((p) => p.id);
    expect(ids).toHaveLength(5);
    expect(ids).toContain("A");
    expect(ids).toContain("B");
    expect(ids).not.toContain("C");
  });

  it("rotates the lesson's own positions on a replay when none are bundled", () => {
    const first = pickExercises(ex, 0, empty).map((p) => p.id);
    const safe: PuzzleStep = { ...ex, theme: "safe", count: 2 };
    expect(pickExercises(safe, 0, some).map((p) => p.id)).toEqual(["fp-1", "fp-2"]);
    expect(pickExercises(safe, 1, some).map((p) => p.id)).toEqual(["fp-3", "fp-4"]);
    expect(pickExercises(safe, 2, some).map((p) => p.id)).toEqual(["fp-5", "fp-1"]);
    expect(first).toHaveLength(5);
  });

  it("finds saved positions by id, or null when one is gone", () => {
    expect(exercisesById(ex, ["fp-2", "A"], some)!.map((p) => p.id)).toEqual(["fp-2", "A"]);
    expect(exercisesById(ex, ["A"], empty)).toBeNull();
  });
});
