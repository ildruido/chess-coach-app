// The place a piece of coach content belongs to, one builder per kind (CC-031).
// A context key is exact: the same key means the same situation, so a saved
// answer may be shown again. Pure functions, unit tested.

import type { KbKind } from "./entry";
import type { KbQuery } from "./matcher";

/** Where a lesson question is asked. */
export interface AskPlace {
  lessonId: string;
  lessonVersion: number;
  place: string;
  /** The engine's best move now, in an exercise; saved answers for another best move are dropped. */
  bestMove: string | null;
}

/** An exercise place: the position, so it holds whichever run draws the puzzle. */
export const isPositionPlace = (place: string) => place.startsWith("fen:");

/** A step is tied to its lesson version; an exercise position to the engine's best move. */
export function lessonCtx(at: AskPlace): string {
  return isPositionPlace(at.place)
    ? `${at.place}|${at.bestMove}`
    : `${at.place}|v${at.lessonVersion}`;
}

export function lessonQuery(kind: "ask" | "reword", at: AskPlace, text: string): KbQuery {
  return { kind, group: at.lessonId, ctx: lessonCtx(at), text };
}

/** A short stable bucket for a position, so entries load in small groups. */
export function bucketOf(key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  return ((h >>> 0) & 0xff).toString(16).padStart(2, "0");
}

/**
 * A practice hint: the game so far, the step and the steps already given.
 * The pointing steps (piece, move) also depend on the engine's best move, which
 * can change between searches; the guiding steps (question, plan) name no move.
 * Any other combination is a different hint.
 */
export function hintQuery(
  moves: readonly string[],
  stage: string,
  given: readonly string[],
  bestMove: string,
): KbQuery {
  const line = moves.join(" ");
  return {
    kind: "hint",
    group: bucketOf(line),
    ctx: `${line}|${stage}|${given.join(",")}|${stage === "piece" || stage === "move" ? bestMove : ""}`,
    text: "",
  };
}

/** A key for kinds that only need one exact string (a move comment, a review). */
export function keyQuery(kind: Exclude<KbKind, "ask" | "reword" | "hint">, key: string): KbQuery {
  return { kind, group: kind === "review" ? "all" : bucketOf(key), ctx: key, text: "" };
}
