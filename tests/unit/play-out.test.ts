import { Chess, type Square } from "chess.js";
import { describe, expect, it } from "vitest";
import type { Analysis } from "../../src/engine/uci";
import { LESSONS } from "../../src/lessons/catalog";
import { drillLine, pickExercises } from "../../src/lessons/exercises";
import type { DrillStep, Lesson, PlayStep, QuizStep } from "../../src/lessons/lesson";
import {
  development,
  developText,
  goalMet,
  judgePlay,
  leftBookText,
  positionName,
} from "../../src/lessons/play-out";

const lesson = (id: string) => LESSONS.find((l) => l.id === id) as Lesson;
const quizOf = (id: string) => lesson(id).steps.find((s) => s.kind === "quiz") as QuizStep;
const game = (sans: string) => {
  const g = new Chess();
  for (const s of sans.split(" ").filter(Boolean)) g.move(s);
  return g;
};
const analysis = (pv: string[], cp = 0): Analysis => ({
  bestMove: pv[0] ?? null,
  depth: 12,
  score: { cp },
  pv,
  ms: 100,
});

describe("development goal", () => {
  it("counts knights and bishops off their squares, and castling", () => {
    expect(development(new Chess(), "w")).toEqual({ developed: 0, castled: false });
    const g = game("e4 e5 Nf3 Nc6 Bc4 Bc5 O-O");
    expect(development(g, "w")).toEqual({ developed: 2, castled: true });
    expect(development(g, "b")).toEqual({ developed: 2, castled: false });
    expect(goalMet("develop", g, "w")).toBe(false);
    const done = game("e4 e5 Nf3 Nc6 Bc4 Bc5 O-O Nf6 Nc3 d6 d3 O-O Bg5");
    expect(goalMet("develop", done, "w")).toBe(true);
    expect(goalMet("develop", done, "b")).toBe(false);
  });

  it("words the progress", () => {
    expect(developText({ developed: 3, castled: false }, 4)).toBe(
      "3 of 4 knights and bishops out, not castled yet. 4 moves left.",
    );
    expect(developText({ developed: 4, castled: true }, 1)).toBe(
      "4 of 4 knights and bishops out, castled. 1 move left.",
    );
  });

  it("mate counts only when the player gave it", () => {
    const mate = game("f3 e5 g4 Qh4#");
    expect(goalMet("mate", mate, "b")).toBe(true);
    expect(goalMet("mate", mate, "w")).toBe(false);
  });
});

describe("play-it-out safety net", () => {
  const stale = "k7/8/2K5/8/8/4Q3/8/8 w - - 0 1";

  it("stops stalemate without asking the engine", () => {
    const j = judgePlay(stale, [], "e3b6", null);
    expect(j).toMatchObject({ kind: "warn" });
    expect(j.kind === "warn" && j.text).toBe(
      "Careful: this is stalemate. Black has no legal move but isn't in check, so the game is a draw.",
    );
  });

  it("stops a move that leaves too little to mate", () => {
    const drawn = judgePlay("8/8/8/3k4/8/8/3q4/3NK3 w - - 0 1", [], "e1d2", null);
    expect(drawn.kind === "warn" && drawn.text).toContain("nobody has enough pieces");
  });

  it("allows mate, flags a hanging queen, and needs the engine otherwise", () => {
    expect(judgePlay("k7/8/2K5/8/8/8/8/1Q6 w - - 0 1", [], "b1b7", null).kind).toBe("ok");
    const hang = judgePlay("8/8/3k4/8/8/8/8/3QK3 w - - 0 1", [], "d1d5", analysis(["d6d5"], -900));
    expect(hang.kind === "warn" && hang.text).toBe(
      "Careful: after this move, your queen on d5 can be taken.",
    );
    expect(judgePlay("8/8/3k4/8/8/8/8/3QK3 w - - 0 1", [], "d1d4", null).kind).toBe("unknown");
    expect(
      judgePlay("8/8/3k4/8/8/8/8/3QK3 w - - 0 1", [], "d1d4", analysis(["d6e6"], 2000)).kind,
    ).toBe("ok");
  });
});

describe("opening drill", () => {
  const drill = lesson("italian-game").steps.find(
    (s) => s.kind === "exercise" && s.theme === "drill",
  ) as DrillStep;

  it("names every position of the Italian Game line once it is reached", () => {
    const uci = drillLine(drill);
    expect(uci).toHaveLength(12);
    const names = uci.map((_, i) => positionName(uci.slice(0, i + 1)));
    expect(names.slice(4).every((n) => n?.startsWith("Italian Game"))).toBe(true);
    expect(names.at(-1)).toBe("Italian Game: Classical Variation, Giuoco Pianissimo");
  });

  it("is one exercise from the start position, with no setup move", () => {
    const [p] = pickExercises(drill, 3);
    expect(p).toMatchObject({ id: "drill", theme: "drill", setup: "", fen: new Chess().fen() });
  });

  it("says what the book plays when the player leaves it, and names the player's opening", () => {
    const moves = drillLine(drill).slice(0, 4);
    expect(leftBookText("Italian Game", moves, "f1b5", "f1c4")).toBe(
      "That leaves the book. The Italian Game plays {Bc4} here. {Bb5} has a name too: the Ruy Lopez. Take your move back and try {Bc4}.",
    );
    expect(leftBookText("Italian Game", moves, "h2h3", "f1c4")).toBe(
      "That leaves the book. The Italian Game plays {Bc4} here. Take your move back and try {Bc4}.",
    );
  });
});

describe("lessons 10 to 12: answers follow from the rules", () => {
  it("opening principles: the quiz squares are White's undeveloped knights and bishops", () => {
    const q = quizOf("opening-principles");
    const g = new Chess(q.fen);
    const home = ["b1", "g1", "c1", "f1"].filter((sq) => {
      const p = g.get(sq as Square);
      return p?.color === "w" && (p.type === "n" || p.type === "b");
    });
    expect(home.sort()).toEqual([...q.squares].sort());
  });

  it("opening principles: one start position, 10 moves to develop and castle", () => {
    const play = lesson("opening-principles").steps.at(-1) as PlayStep;
    expect(play).toMatchObject({ theme: "play", goal: "develop", maxMoves: 10 });
    expect(play.positions[0]![1]).toBe(new Chess().fen());
  });

  it("Italian Game: only the knight's jump adds a second attacker on f7", () => {
    const q = quizOf("italian-game");
    const g = new Chess(q.fen);
    expect(g.attackers("f7", "w")).toEqual(["c4"]);
    const jumps = g
      .moves({ verbose: true })
      .filter((m) => m.piece === "n")
      .filter((m) => {
        const h = new Chess(q.fen);
        h.move(m.san);
        return h.attackers("f7", "w").length === 2;
      });
    expect([...new Set(jumps.map((m) => m.from))]).toEqual(q.squares);
    expect(jumps.map((m) => m.san)).toContain("Ng5");
  });

  it("queen mate: the quiz square is the only queen move that stalemates", () => {
    const q = quizOf("queen-mate");
    const g = new Chess(q.fen);
    const stalemates = g
      .moves({ verbose: true })
      .filter((m) => m.piece === "q")
      .filter((m) => {
        const h = new Chess(q.fen);
        h.move(m.san);
        return h.isStalemate();
      })
      .map((m) => m.to);
    expect(stalemates).toEqual(q.squares);
  });

  it("queen mate: every position is legal, White to move, and not check", () => {
    const play = lesson("queen-mate").steps.at(-1) as PlayStep;
    for (const [id, fen] of play.positions) {
      const g = new Chess(fen);
      expect(g.turn(), id).toBe("w");
      expect(g.inCheck(), id).toBe(false);
      // Nor is Black's king attacked: that position could never happen.
      const bk = g
        .board()
        .flat()
        .find((p) => p?.type === "k" && p.color === "b")!;
      expect(g.attackers(bk.square, "w"), id).toEqual([]);
      expect(g.board().flat().filter(Boolean)).toHaveLength(3);
    }
  });
});
