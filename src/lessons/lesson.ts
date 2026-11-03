// Lessons: written in advance, bundled, and checked by unit tests against the
// rules (tests/unit/lessons.test.ts) and Stockfish (tests/engine). Pure data
// types and helpers, no DOM.
//
// Moves and squares in lesson text are written in braces, "{Qxd5}" or "{d5}",
// so the tests can find and check every one; the page shows them in bold.

import type { PuzzleTheme, PuzzleTuple } from "../puzzles/puzzles";
import type { PlayGoal } from "./play-out";

export interface Marks {
  /** Arrows drawn on the board, from square to square. */
  arrows?: [string, string][];
  /** Squares highlighted on the board. */
  marks?: string[];
}

/**
 * A question shown under a step, with its answer written in advance: free to
 * ask (CC-026). {References} are checked like the step's own text. On an
 * exercise step the questions are about the idea, never one position, because
 * the positions rotate.
 */
export interface SuggestedQuestion {
  q: string;
  a: string;
}

interface Asked {
  /** Two or three suggested questions for the step. */
  questions: SuggestedQuestion[];
}

export interface ExplainStep extends Marks, Asked {
  kind: "explain";
  fen: string;
  text: string;
}

export interface ShowStep extends Asked {
  kind: "show";
  fen: string;
  intro: string;
  /**
   * The test checks each move is within a small margin of the engine's best
   * (an opening's book moves, or one of several ways to mate), rather than
   * its first choice.
   */
  nearBest?: boolean;
  /** Moves played one per click, each with its sentence. */
  line: ({ san: string; text: string } & Marks)[];
}

export interface QuizStep extends Marks, Asked {
  kind: "quiz";
  fen: string;
  prompt: string;
  /** The squares that answer the question; any one of them is right. */
  squares: string[];
  right: string;
  wrong: string;
}

interface ExerciseBase extends Asked {
  kind: "exercise";
  /** The task, shown above the board: "Win a free piece." */
  task: string;
  /** How many positions to solve. */
  count: number;
}

/** Find the move: bundled puzzles or the lesson's own positions. */
export interface PuzzleStep extends ExerciseBase {
  /**
   * The bundled puzzles' theme; "safe": any move that loses nothing is right;
   * "own": only the lesson's own positions, each with one answer.
   */
  theme: PuzzleTheme;
  maxRating: number;
  /**
   * Positions written for the lesson, in the bundled puzzle format. Used when
   * the bundled puzzles for the theme run short, and the only ones for "safe"
   * and "own" (rotated on each replay).
   */
  fallback: PuzzleTuple[];
}

/** Play a position out against the engine at full strength until the goal is met. */
export interface PlayStep extends ExerciseBase {
  theme: "play";
  goal: PlayGoal;
  /** The player's moves allowed to meet the goal; no limit when absent. */
  maxMoves?: number;
  /** [id, FEN] with the player to move; `count` of them per run, rotated on a replay. */
  positions: [string, string][];
}

/** Play an opening from the start: the engine answers with the book moves. */
export interface DrillStep extends ExerciseBase {
  theme: "drill";
  /** The opening's name, as the openings list starts it: "Italian Game". */
  opening: string;
  /** The line from the start position, both sides, in SAN: "e4 e5 Nf3 …". */
  line: string;
  count: 1;
}

export type ExerciseStep = PuzzleStep | PlayStep | DrillStep;

export type Step = ExplainStep | ShowStep | QuizStep | ExerciseStep;

export interface Lesson {
  id: string;
  /** Bumped when the steps change, so saved progress starts the lesson again. */
  version: number;
  title: string;
  /** One line on the lesson list: what the lesson teaches. */
  summary: string;
  /** One line shown at the end: the idea to remember. */
  takeaway: string;
  steps: Step[];
}

export { textParts, textRefs } from "./lesson-text";

export const isSquare = (s: string) => /^[a-h][1-8]$/.test(s);
