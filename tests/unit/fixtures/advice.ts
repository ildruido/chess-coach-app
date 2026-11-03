import { gameAt } from "../../../src/chess/notation";
import type { GameReview, TurningPoint } from "../../../src/coach/review";
import type { HistoryRecord } from "../../../src/storage/history";

export const MOVES = ["e2e4", "e7e5", "d1h5", "b8c6", "h5f7", "e8f7"];

/** A turning point that leaves a piece hanging (the "hanging" kind) unless overridden. */
export const point = (over: Partial<TurningPoint> = {}): TurningPoint => ({
  ply: 4,
  kind: "mistake",
  swing: 60,
  fenBefore: gameAt({ moves: MOVES.slice(0, 4) }).fen(),
  playedUci: "h5f7",
  playedSan: "Qxf7+",
  bestUci: "f1c4",
  bestSan: "Bc4",
  isBest: false,
  bestLine: ["Bc4", "g6"],
  playedFacts: ["It captures a pawn."],
  bestFacts: ["Bc4 moves White's bishop from f1 to c4."],
  bestGain: 0,
  bestMates: false,
  evalBefore: "about equal",
  evalAfter: "Black is winning",
  leftHanging: true,
  why: "Your queen could be taken.",
  whyBy: "engine",
  ...over,
});

export const review = (points: TurningPoint[]): GameReview => ({
  version: 1,
  result: "You resigned. The engine wins.",
  points,
  lesson: "Check what can capture your piece.",
  lessonBy: "engine",
});

export function record(
  id: string,
  finishedAt: string,
  points: TurningPoint[] | null,
  over: Partial<HistoryRecord> = {},
): HistoryRecord {
  return {
    version: 1,
    id,
    moves: MOVES,
    level: 1,
    color: "white",
    hintMode: "tell",
    hints: [],
    resigned: true,
    createdAt: finishedAt,
    finishedAt,
    outcome: "loss",
    result: "You resigned. The engine wins.",
    ...(points && { review: review(points) }),
    ...over,
  };
}
