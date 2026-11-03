// Everyday wording for moves (CC-039c): "the left bishop to d5", "knight takes
// the pawn", "take the pawn with my knight", "queen's pawn two squares". Rules
// only, no coach call: the sentence is matched against the legal moves, and
// when more than one fits the caller asks which. No DOM, so it is unit tested.
import type { Chess, Move } from "chess.js";

export interface Choice {
  san: string;
  from: string;
  to: string;
  promotion?: string;
  piece: string;
}

export interface Phrase {
  piece: string;
  side?: "left" | "right";
  file?: string;
  from?: string;
  to?: string;
  /** Piece type being taken, when the speaker named it. */
  captures?: string;
  /** The speaker said "takes" without naming what. */
  capture?: boolean;
  steps?: number;
}

const PIECES: Record<string, string> = {
  king: "k",
  queen: "q",
  rook: "r",
  bishop: "b",
  knight: "n",
  horse: "n",
  pawn: "p",
};
const NAMES: Record<string, string> = {
  k: "king",
  q: "queen",
  r: "rook",
  b: "bishop",
  n: "knight",
  p: "pawn",
};
const WING_FILE: Record<string, Record<string, string>> = {
  king: { pawn: "e", knight: "g", bishop: "f", rook: "h" },
  queen: { pawn: "d", knight: "b", bishop: "c", rook: "a" },
};
const PIECE_RE = "(king|queen|rook|bishop|knight|horse|pawn)s?";
const TAKE = "(?:takes|take|captures|capture|x|eats)";

const FILLER = new Set(
  "the my a an their his her your with to on at from and then please piece one that of it s hand forward square squares step steps space spaces".split(
    " ",
  ),
);
const WORDS = new Set([
  ...Object.keys(PIECES),
  ...Object.keys(PIECES).map((w) => `${w}s`),
  ...["takes", "take", "captures", "capture", "x", "eats", "left", "right", "1", "2"],
]);
/** True when every word is part of a move phrase, so "the knight on f3 is strong" is not one. */
function onlyMoveWords(s: string): boolean {
  return s
    .split(" ")
    .every(
      (w) => FILLER.has(w) || WORDS.has(w) || /^[a-h][1-8]$/.test(w) || /^(?:king|queen)$/.test(w),
    );
}

/** Reads a move said in everyday words; null when it isn't one. `s` is normalised text. */
export function readNatural(s: string): Phrase | null {
  let text = s;
  const out: Partial<Phrase> = {};
  const wing = new RegExp(`\\b(king|queen) s ${PIECE_RE}\\b`).exec(text);
  if (wing) {
    out.file = WING_FILE[wing[1]!]![wing[2]!.replace(/s$/, "")];
    out.piece = PIECES[wing[2]!.replace(/s$/, "")];
    text = text.replace(wing[0], " ");
  }
  const side = /\b(left|right)(?: hand)?\b/.exec(text);
  if (side) {
    out.side = side[1] as "left" | "right";
    text = text.replace(side[0], " ");
  }
  const steps = /\b([12])\s*(?:squares?|steps?|spaces?)\b/.exec(text);
  if (steps) {
    out.steps = Number(steps[1]);
    text = text.replace(steps[0], " ");
  }
  const squares = text.match(/\b[a-h][1-8]\b/g) ?? [];
  if (squares.length > 2) return null;
  if (squares.length === 2) out.from = squares[0];
  if (squares.length) out.to = squares.at(-1);
  for (const sq of squares) text = text.replace(sq, " ");
  const pieces = (t: string) =>
    [...t.matchAll(new RegExp(`\\b${PIECE_RE}\\b`, "g"))].map((m) => PIECES[m[1]!]!);
  // "take the pawn with my knight"
  let m = new RegExp(
    `\\b${TAKE}\\b[^]*?\\b${PIECE_RE}\\b[^]*?\\bwith\\b[^]*?\\b${PIECE_RE}\\b`,
  ).exec(text);
  if (m) {
    out.captures = PIECES[m[1]!];
    out.piece = PIECES[m[2]!];
  } else if (
    // "knight takes the pawn"
    (m = new RegExp(`\\b${PIECE_RE}\\b[^]*?\\b${TAKE}\\b[^]*?\\b${PIECE_RE}\\b`).exec(text))
  ) {
    out.piece = PIECES[m[1]!];
    out.captures = PIECES[m[2]!];
  } else if (new RegExp(`\\b${TAKE}\\b`).test(text)) {
    out.capture = true;
    const named = pieces(text);
    if (!out.piece && named.length) out.piece = named[0];
  } else if (!out.piece) {
    out.piece = pieces(text)[0];
  }
  if (!out.piece || !onlyMoveWords(s)) return null;
  const hasDetail = out.side || out.file || out.to || out.captures || out.capture || out.steps;
  if (!hasDetail) return null;
  return out as Phrase;
}

/** Orders pieces from the speaker's left to right ("left" is the a-file side for White). */
function leftToRight(moves: Move[], turn: "w" | "b"): Move[] {
  const sign = turn === "w" ? 1 : -1;
  return [...moves].sort(
    (a, b) => sign * (a.from.charCodeAt(0) - b.from.charCodeAt(0)) || a.from.localeCompare(b.from),
  );
}

const toChoice = (mv: Move): Choice => ({
  san: mv.san,
  from: mv.from,
  to: mv.to,
  piece: mv.piece,
  ...(mv.promotion ? { promotion: mv.promotion } : {}),
});

/** The legal moves that fit what was said. */
export function matchPhrase(want: Phrase, game: Chess, promo = "q"): Move[] {
  let found = game.moves({ verbose: true }).filter((mv) => {
    if (mv.piece !== want.piece) return false;
    if (want.to && mv.to !== want.to) return false;
    if (want.from && mv.from !== want.from) return false;
    if (want.file && mv.from[0] !== want.file) return false;
    if (want.captures && mv.captured !== want.captures) return false;
    if (want.capture && !mv.captured) return false;
    if (
      want.steps &&
      (mv.piece !== "p" || mv.captured || Math.abs(+mv.to[1]! - +mv.from[1]!) !== want.steps)
    ) {
      return false;
    }
    return true;
  });
  if (found.some((mv) => mv.promotion)) found = found.filter((mv) => mv.promotion === promo);
  if (want.side && found.length > 1) {
    const ordered = leftToRight(found, game.turn());
    const files = new Set(ordered.map((mv) => mv.from[0]));
    if (files.size > 1) {
      const edge =
        want.side === "left" ? ordered[0]!.from[0] : ordered[ordered.length - 1]!.from[0];
      found = ordered.filter((mv) => mv.from[0] === edge);
    }
  }
  return found;
}

/** "Which knight: the one on b1 or the one on f3?" */
export function askWhich(moves: Move[], game: Chess): string {
  const ordered = leftToRight(moves, game.turn());
  const kinds = new Set(ordered.map((mv) => mv.piece));
  const noun = kinds.size === 1 ? NAMES[ordered[0]!.piece]! : "piece";
  const parts = ordered.map(
    (mv) => `the ${kinds.size === 1 ? "one" : NAMES[mv.piece]} on ${mv.from}`,
  );
  const list =
    parts.length > 2 ? `${parts.slice(0, -1).join(", ")} or ${parts.at(-1)}` : parts.join(" or ");
  return `Which ${noun}: ${list}?`;
}

export const toChoices = (moves: Move[], game: Chess): Choice[] =>
  leftToRight(moves, game.turn()).map(toChoice);

const ORDINALS: Record<string, number> = { first: 0, second: 1, third: 2, fourth: 3, last: -1 };

/** Resolves an answer to "which one?" ("the left one", "b1", "the first"), or null. */
export function pickChoice(spoken: string, choices: Choice[]): Choice | null {
  const s = spoken;
  const ANSWER =
    /^(?:(?:the|one|1|on|from|that|my|please|file|most|first|second|third|fourth|last|left|right|[a-h][1-8]?|king|queen|rook|bishop|knight|pawn)\s*)+$/;
  if (!ANSWER.test(s) || s.split(" ").length > 5) return null;
  const ordered = choices; // already left to right
  const sq = /\b([a-h][1-8])\b/.exec(s);
  if (sq)
    return choices.filter((c) => c.from === sq[1]).length === 1
      ? choices.find((c) => c.from === sq[1])!
      : null;
  const ord = /\b(first|second|third|fourth|last)\b/.exec(s);
  if (ord) {
    const i = ORDINALS[ord[1]!]!;
    return ordered.at(i) ?? null;
  }
  const side = /\b(left|right)(?:most)?\b/.exec(s);
  if (side) return side[1] === "left" ? ordered[0]! : ordered[ordered.length - 1]!;
  const file = /^(?:the |on |from )*([a-h])(?: file)?$/.exec(s);
  if (file) {
    const hit = choices.filter((c) => c.from[0] === file[1]);
    return hit.length === 1 ? hit[0]! : null;
  }
  const kind = new RegExp(`\\b${PIECE_RE}\\b`).exec(s);
  if (kind) {
    const hit = choices.filter((c) => c.piece === PIECES[kind[1]!]);
    return hit.length === 1 ? hit[0]! : null;
  }
  return null;
}

const MOVE_START = new RegExp(
  `^(?:the |my |a )*(?:(?:left|right) |(?:king|queen) s )?(?:${Object.keys(PIECES).join("|")}|take|takes|capture|captures)\\b`,
);

/** True when a whole short sentence reads as a move in everyday words, not a question. */
export function looksLikeNaturalMove(s: string): boolean {
  return s.split(" ").length <= 9 && MOVE_START.test(s) && readNatural(s) !== null;
}
