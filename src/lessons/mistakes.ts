// Kinds of mistake, worked out from the engine facts stored in a saved
// review (never by the coach), and how often each shows up in Ale's games.
// Pure, unit tested.
import type { TurningPoint } from "../coach/review";
import type { HistoryRecord } from "../storage/history";

export type MistakeKind =
  "hanging" | "missed-mate" | "missed-free-piece" | "missed-fork" | "opening-slip";

export interface MistakeInfo {
  /** The lesson that teaches the fix. */
  lessonId: string;
  label: string;
  tip: string;
}

/** In priority order: it is also the tie-break when counts are equal. */
export const MISTAKES: Record<MistakeKind, MistakeInfo> = {
  hanging: {
    lessonId: "safe-moves",
    label: "Leaving a piece to be taken",
    tip: "Before you move, ask: can the piece I am moving be captured on its new square?",
  },
  "missed-mate": {
    lessonId: "mate-in-one",
    label: "Missing a checkmate",
    tip: "Before every move, check each checking move you have. One of them may end the game.",
  },
  "missed-free-piece": {
    lessonId: "free-pieces",
    label: "Missing a free piece",
    tip: "Scan your opponent's pieces each turn for one that nothing defends.",
  },
  "missed-fork": {
    lessonId: "forks",
    label: "Missing a fork",
    tip: "Look for a move that attacks two pieces at once, especially with a knight.",
  },
  "opening-slip": {
    lessonId: "opening-principles",
    label: "Slipping in the opening",
    tip: "In the first moves, develop your knights and bishops, take the centre and castle early.",
  },
};

export const MISTAKE_KINDS = Object.keys(MISTAKES) as MistakeKind[];

/** Mistakes before this half-move count as opening slips. */
const OPENING_PLIES = 20;

/** The one kind of mistake a turning point shows, or null when none fits (nothing is invented). */
export function classifyPoint(p: TurningPoint): MistakeKind | null {
  if (p.kind === "spotted") return null;
  const captures = p.bestFacts.some((f) => f.startsWith("It captures a "));
  const playedMates = p.playedFacts.includes("It is checkmate.");
  if (!p.isBest && p.bestMates && !playedMates) return "missed-mate";
  if (!p.isBest && p.bestGain > 0 && !p.bestMates) {
    const unsafe = p.bestFacts.some((f) => f.includes("the moved piece can be captured"));
    if (captures && !unsafe) return "missed-free-piece";
    const PREFIX = "After it, the moved piece attacks ";
    const attacks = p.bestFacts.find((f) => f.startsWith(PREFIX));
    if (!captures && attacks && attacks.slice(PREFIX.length).split(", ").length >= 2) {
      return "missed-fork";
    }
  }
  if (p.leftHanging) return "hanging";
  if (p.ply < OPENING_PLIES && (p.kind === "mistake" || p.kind === "missed")) return "opening-slip";
  return null;
}

export interface Tally {
  kind: MistakeKind;
  /** Reviewed games showing this kind (each game counts once). */
  games: number;
  /** Reviewed games looked at. */
  of: number;
  /** Newest finish time of a game showing it. */
  latest: string;
}

/** How many games each kind of mistake appears in, most frequent first. Only reviewed games count. */
export function tallyMistakes(records: readonly HistoryRecord[]): {
  reviewed: number;
  tallies: Tally[];
} {
  const reviewed = records.filter((r) => r.review);
  const found = new Map<MistakeKind, { games: number; latest: string }>();
  for (const r of reviewed) {
    const kinds = new Set<MistakeKind>();
    for (const p of r.review!.points) {
      const k = classifyPoint(p);
      if (k) kinds.add(k);
    }
    for (const k of kinds) {
      const cur = found.get(k) ?? { games: 0, latest: "" };
      found.set(k, {
        games: cur.games + 1,
        latest: r.finishedAt > cur.latest ? r.finishedAt : cur.latest,
      });
    }
  }
  const tallies = MISTAKE_KINDS.filter((k) => found.has(k))
    .map((kind) => ({ kind, ...found.get(kind)!, of: reviewed.length }))
    .sort((a, b) => b.games - a.games);
  return { reviewed: reviewed.length, tallies };
}
