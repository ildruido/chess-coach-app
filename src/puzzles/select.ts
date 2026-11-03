// Picks lesson puzzles from the lichess puzzle database (CC0). Pure logic, used
// by scripts/puzzles/build-puzzles.ts; the page only reads the result.
//
// CSV columns: PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,
// Themes,GameUrl,OpeningTags. FEN is the position before the opponent's move;
// Moves starts with that move, then the solution (the player's moves and the
// opponent's forced replies).

import { Chess } from "chess.js";

/** Lesson themes, rarest first: a puzzle goes to the first that fits. */
export const LESSON_THEMES = [
  "backRankMate",
  "skewer",
  "discoveredAttack",
  "pin",
  "fork",
  "hangingPiece",
  "mateIn1",
  "winningCapture",
] as const;
export type LessonTheme = (typeof LESSON_THEMES)[number];

/** How many puzzles to keep per theme: several times a lesson's exercises. */
export const THEME_COUNTS: Record<LessonTheme, number> = {
  mateIn1: 50,
  backRankMate: 30,
  hangingPiece: 40,
  fork: 40,
  pin: 40,
  skewer: 30,
  discoveredAttack: 30,
  winningCapture: 30,
};

export const RULES = {
  minRating: 400,
  maxRating: 1200,
  maxHangingRating: 850,
  maxDeviation: 90,
  minPopularity: 85,
  minPlays: 300,
  /** Solution plies after the opponent's first move. */
  maxSolutionPlies: 4,
};

export interface CsvPuzzle {
  id: string;
  fen: string;
  moves: string[];
  rating: number;
  deviation: number;
  popularity: number;
  plays: number;
  themes: string[];
  gameUrl: string;
}

export function parseRow(row: string): CsvPuzzle | null {
  const c = row.trim().split(",");
  if (c.length < 9 || c[0] === "PuzzleId") return null;
  const [id, fen, moves, rating, deviation, popularity, plays, themes, gameUrl] = c as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  return {
    id,
    fen,
    moves: moves.split(" ").filter(Boolean),
    rating: Number(rating),
    deviation: Number(deviation),
    popularity: Number(popularity),
    plays: Number(plays),
    themes: themes.split(" ").filter(Boolean),
    gameUrl: gameUrl.replace(/#.*$/, "").replace(/\/(white|black)$/, ""),
  };
}

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** True when the first solution move captures a piece worth more than the capturer. */
export function winsBiggerPiece(p: CsvPuzzle): boolean {
  try {
    const game = new Chess(p.fen);
    game.move(uci(p.moves[0]!));
    const m = game.move(uci(p.moves[1]!));
    return !!m.captured && VALUE[m.captured]! > VALUE[m.piece]!;
  } catch {
    return false;
  }
}

function uci(u: string) {
  return { from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] };
}

/** The lesson theme a puzzle belongs to, or null if it fails the filters. */
export function themeOf(p: CsvPuzzle): LessonTheme | null {
  if (p.rating < RULES.minRating || p.rating > RULES.maxRating) return null;
  if (p.deviation > RULES.maxDeviation) return null;
  if (p.popularity < RULES.minPopularity || p.plays < RULES.minPlays) return null;
  const solution = p.moves.length - 1;
  if (solution < 1 || solution > RULES.maxSolutionPlies) return null;
  const has = (t: string) => p.themes.includes(t);
  const mate = p.themes.some((t) => t.startsWith("mate"));
  for (const theme of LESSON_THEMES) {
    switch (theme) {
      case "mateIn1":
        if (has("mateIn1") && solution === 1) return theme;
        break;
      case "backRankMate":
        if (has("backRankMate") && (has("mateIn1") || has("mateIn2"))) return theme;
        break;
      case "hangingPiece":
        if (has("hangingPiece") && !mate && p.rating <= RULES.maxHangingRating) return theme;
        break;
      case "winningCapture":
        if (
          has("oneMove") &&
          (has("advantage") || has("crushing")) &&
          !has("hangingPiece") &&
          !mate &&
          winsBiggerPiece(p)
        )
          return theme;
        break;
      default:
        if (has(theme) && !mate) return theme;
    }
  }
  return null;
}

function score(p: CsvPuzzle): number {
  return p.popularity * Math.log(p.plays);
}

/**
 * Keeps the best-liked puzzles per theme, at most one per game, spread over
 * three rating bands so each lesson has easy and harder exercises.
 */
export function selectPuzzles(
  candidates: Iterable<CsvPuzzle>,
  counts: Record<LessonTheme, number> = THEME_COUNTS,
): Record<LessonTheme, CsvPuzzle[]> {
  const byTheme = new Map<LessonTheme, CsvPuzzle[]>();
  for (const p of candidates) {
    const t = themeOf(p);
    if (!t) continue;
    if (!byTheme.has(t)) byTheme.set(t, []);
    byTheme.get(t)!.push(p);
  }
  const usedGames = new Set<string>();
  const out = {} as Record<LessonTheme, CsvPuzzle[]>;
  for (const theme of LESSON_THEMES) {
    const pool = (byTheme.get(theme) ?? []).sort(
      (a, b) => score(b) - score(a) || a.id.localeCompare(b.id),
    );
    const max = theme === "hangingPiece" ? RULES.maxHangingRating : RULES.maxRating;
    const width = (max - RULES.minRating) / 3;
    const bands: CsvPuzzle[][] = [[], [], []];
    for (const p of pool) {
      const b = Math.min(2, Math.floor((p.rating - RULES.minRating) / width));
      bands[b]!.push(p);
    }
    const picked: CsvPuzzle[] = [];
    const want = counts[theme];
    for (let round = 0; picked.length < want; round++) {
      let added = false;
      for (const band of bands) {
        const next = band.find((p) => !usedGames.has(p.gameUrl));
        if (!next || picked.length >= want) continue;
        band.splice(band.indexOf(next), 1);
        usedGames.add(next.gameUrl);
        picked.push(next);
        added = true;
      }
      if (!added) break;
    }
    out[theme] = picked.sort((a, b) => a.rating - b.rating || a.id.localeCompare(b.id));
  }
  return out;
}
