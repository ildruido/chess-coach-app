import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { PUZZLES, puzzlesFor, startOf, type PuzzleFile } from "../../src/puzzles/puzzles";
import {
  LESSON_THEMES,
  RULES,
  THEME_COUNTS,
  parseRow,
  selectPuzzles,
  themeOf,
  winsBiggerPiece,
  type CsvPuzzle,
} from "../../src/puzzles/select";

const HEADER =
  "PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags";
const BACK_RANK = "6k1/1p3ppp/8/8/8/8/5PPP/R5K1 b - - 0 1";

function puzzle(over: Partial<CsvPuzzle> = {}): CsvPuzzle {
  return {
    id: "P1",
    fen: BACK_RANK,
    moves: ["b7b6", "a1a8"],
    rating: 700,
    deviation: 75,
    popularity: 95,
    plays: 1000,
    themes: ["mate", "mateIn1", "oneMove"],
    gameUrl: "https://lichess.org/g1",
    ...over,
  };
}

describe("parseRow", () => {
  it("reads a lichess CSV row and skips the header", () => {
    expect(parseRow(HEADER)).toBeNull();
    const p = parseRow(
      `00008,${BACK_RANK},b7b6 a1a8,1012,75,95,8812,mate mateIn1 short,https://lichess.org/787zsVup/black#48,`,
    );
    expect(p).toMatchObject({
      id: "00008",
      moves: ["b7b6", "a1a8"],
      rating: 1012,
      plays: 8812,
      themes: ["mate", "mateIn1", "short"],
      gameUrl: "https://lichess.org/787zsVup",
    });
  });
});

describe("themeOf", () => {
  it("assigns a mate in one", () => {
    expect(themeOf(puzzle())).toBe("mateIn1");
  });

  it("prefers the rarer back-rank theme", () => {
    expect(themeOf(puzzle({ themes: ["mate", "mateIn1", "backRankMate"] }))).toBe("backRankMate");
  });

  it("applies the rating, popularity, plays and length rules", () => {
    expect(themeOf(puzzle({ rating: RULES.minRating - 1 }))).toBeNull();
    expect(themeOf(puzzle({ rating: RULES.maxRating + 1 }))).toBeNull();
    expect(themeOf(puzzle({ deviation: RULES.maxDeviation + 1 }))).toBeNull();
    expect(themeOf(puzzle({ popularity: RULES.minPopularity - 1 }))).toBeNull();
    expect(themeOf(puzzle({ plays: RULES.minPlays - 1 }))).toBeNull();
    expect(themeOf(puzzle({ moves: ["b7b6", "a1a8", "g8h7", "a8a1", "h7g8", "a1a2"] }))).toBeNull();
  });

  it("keeps hanging-piece puzzles easy", () => {
    const hanging = { themes: ["hangingPiece", "advantage"] };
    expect(themeOf(puzzle({ ...hanging, rating: 800 }))).toBe("hangingPiece");
    expect(themeOf(puzzle({ ...hanging, rating: 900 }))).toBeNull();
  });

  it("only counts a winning capture when a cheaper piece takes a bigger one", () => {
    // After ...Qd5?, the c4 pawn takes the queen.
    const queen = puzzle({
      fen: "4k3/8/8/8/2P5/8/3q4/4K3 b - - 0 1",
      moves: ["d2d5", "c4d5"],
      themes: ["advantage", "oneMove"],
    });
    expect(winsBiggerPiece(queen)).toBe(true);
    expect(themeOf(queen)).toBe("winningCapture");
    const even = puzzle({
      fen: "4k3/8/8/8/2Q5/8/3q4/4K3 b - - 0 1",
      moves: ["d2d5", "c4d5"],
      themes: ["advantage", "oneMove"],
    });
    expect(winsBiggerPiece(even)).toBe(false);
    expect(themeOf(even)).toBeNull();
  });
});

describe("selectPuzzles", () => {
  it("keeps the best-liked puzzles, one per game, spread over ratings", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      puzzle({
        id: `M${String(i).padStart(2, "0")}`,
        rating: 400 + i * 25,
        popularity: 85 + (i % 10),
        gameUrl: `https://lichess.org/g${i % 25}`,
      }),
    );
    const counts = { ...THEME_COUNTS, mateIn1: 9 };
    const picked = selectPuzzles(many, counts).mateIn1;
    expect(picked).toHaveLength(9);
    expect(new Set(picked.map((p) => p.gameUrl)).size).toBe(9);
    const ratings = picked.map((p) => p.rating);
    expect(ratings).toEqual([...ratings].sort((a, b) => a - b));
    expect(ratings.some((r) => r < 667)).toBe(true);
    expect(ratings.some((r) => r > 933)).toBe(true);
  });
});

describe("puzzle loader", () => {
  const file: PuzzleFile = {
    v: 1,
    generated: "2026-10-07",
    t: { mateIn1: [["P1", BACK_RANK, "b7b6 a1a8", 700]] },
  };

  it("splits the setup move from the solution", () => {
    const [p] = puzzlesFor("mateIn1", {}, file);
    expect(p).toMatchObject({ id: "P1", setup: "b7b6", solution: ["a1a8"], rating: 700 });
    expect(startOf(p!)).toBe("6k1/5ppp/1p6/8/8/8/5PPP/R5K1 w - - 0 2");
    expect(puzzlesFor("mateIn1", { maxRating: 600 }, file)).toEqual([]);
    expect(puzzlesFor("fork", {}, file)).toEqual([]);
  });
});

describe("bundled puzzles", () => {
  const themes = Object.keys(PUZZLES.t);

  it("has puzzles for every lesson theme once the file is built", () => {
    if (PUZZLES.generated === null) return expect(themes).toEqual([]);
    for (const t of LESSON_THEMES) expect(puzzlesFor(t).length).toBeGreaterThan(0);
  });

  it("only uses lesson themes", () => {
    for (const t of themes) expect(LESSON_THEMES).toContain(t);
  });

  it("replays every puzzle legally, and every mate in one is mate", () => {
    for (const theme of LESSON_THEMES) {
      for (const p of puzzlesFor(theme)) {
        const game = new Chess(startOf(p));
        for (const m of p.solution) {
          game.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
        }
        if (theme === "mateIn1") expect(game.isCheckmate()).toBe(true);
        expect(p.rating).toBeGreaterThanOrEqual(RULES.minRating);
        expect(p.rating).toBeLessThanOrEqual(RULES.maxRating);
      }
    }
  });
});
