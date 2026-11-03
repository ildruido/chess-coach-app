// Finished practice games, kept for the history list and, later, the
// learning path. One record per game, with its review once there is one.
// Records come back from outside the page, so they are validated, never
// trusted: a record that doesn't match its own moves is skipped. Pure, unit
// tested.
import { gameAt } from "../chess/notation";
import { MAX_POINTS, type GameReview, type PointKind, type TurningPoint } from "../coach/review";
import { LEVELS, levelById } from "../engine/strength";
import type { Outcome, PracticeGame } from "../practice/practice-game";
import { GAME_ID, type HintRecord, formatSavedAt, parseSavedGame } from "./saved-game";

export const HISTORY_VERSION = 1;

export interface HistoryRecord {
  version: typeof HISTORY_VERSION;
  id: string;
  /** Moves from the start position, in UCI. */
  moves: string[];
  level: number;
  color: "white" | "black";
  hintMode: "tell" | "ask";
  hints: HintRecord[];
  resigned: boolean;
  /** ISO timestamps: when the game started and when it ended. */
  createdAt: string;
  finishedAt: string;
  outcome: Outcome;
  /** How the game ended, from the player's side ("Checkmate. You win!"). */
  result: string;
  /** The post-game review, once the player has asked for one. */
  review?: GameReview;
}

/** The record of a finished game; null while it is still being played. */
export function historyRecord(
  p: PracticeGame,
  now: Date = new Date(),
  review?: GameReview,
): HistoryRecord | null {
  const outcome = p.outcome;
  if (!outcome) return null;
  return {
    version: HISTORY_VERSION,
    id: p.id,
    moves: [...p.game.moves],
    level: p.level.id,
    color: p.playerColor,
    hintMode: p.hintMode,
    hints: p.hints.map(({ ply, step, mode }) => ({ ply, step, mode })),
    resigned: p.resigned,
    createdAt: p.createdAt,
    finishedAt: now.toISOString(),
    outcome,
    result: p.statusLine(),
    ...(review && { review }),
  };
}

const OUTCOMES: readonly string[] = ["win", "loss", "draw"];
const KINDS: readonly string[] = ["inaccuracy", "mistake", "missed", "spotted"];
const MAX_TEXT = 1000;

const isText = (v: unknown, max = MAX_TEXT): v is string =>
  typeof v === "string" && v.length <= max;
const isTexts = (v: unknown, max = 40): v is string[] =>
  Array.isArray(v) && v.length <= max && v.every((s) => isText(s, 200));
const isUci = (v: unknown): v is string =>
  typeof v === "string" && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A turning point as stored, checked against the game it belongs to; null if it doesn't match. */
function parsePoint(v: unknown, moves: readonly string[]): TurningPoint | null {
  if (!v || typeof v !== "object") return null;
  const t = v as Record<string, unknown>;
  const ply = t.ply;
  if (!Number.isInteger(ply) || (ply as number) < 0 || (ply as number) >= moves.length) return null;
  const n = ply as number;
  if (!KINDS.includes(t.kind as string)) return null;
  if (t.playedUci !== moves[n] || !isUci(t.bestUci)) return null;
  if (!isText(t.playedSan, 10) || !isText(t.bestSan, 10)) return null;
  if (typeof t.isBest !== "boolean" || typeof t.bestMates !== "boolean") return null;
  if (typeof t.leftHanging !== "boolean") return null;
  if (!isNum(t.swing) || !isNum(t.bestGain)) return null;
  if (!isTexts(t.bestLine) || !isTexts(t.playedFacts) || !isTexts(t.bestFacts)) return null;
  if (!isText(t.evalBefore, 200) || !isText(t.evalAfter, 200) || !isText(t.why)) return null;
  if (t.whyBy !== "coach" && t.whyBy !== "engine") return null;
  if (t.slipSan !== undefined && !isText(t.slipSan, 10)) return null;
  if (t.slipFacts !== undefined && !isTexts(t.slipFacts)) return null;
  // The board shown is rebuilt from the moves, never taken from the record.
  const before = gameAt({ moves: moves.slice(0, n) });
  if (before.fen() !== t.fenBefore) return null;
  if (before.history().length !== n) return null;
  const sanNow = gameAt({ moves: moves.slice(0, n + 1) }).history()[n];
  if (sanNow !== t.playedSan) return null;
  // The better move must be legal there and be the move the text names.
  try {
    if (gameAt({ moves: [...moves.slice(0, n), t.bestUci] }).history()[n] !== t.bestSan)
      return null;
  } catch {
    return null;
  }
  return {
    ply: n,
    kind: t.kind as PointKind,
    swing: t.swing,
    fenBefore: t.fenBefore as string,
    playedUci: t.playedUci as string,
    playedSan: t.playedSan,
    bestUci: t.bestUci,
    bestSan: t.bestSan,
    isBest: t.isBest,
    bestLine: [...t.bestLine],
    playedFacts: [...t.playedFacts],
    bestFacts: [...t.bestFacts],
    bestGain: t.bestGain,
    bestMates: t.bestMates,
    evalBefore: t.evalBefore,
    evalAfter: t.evalAfter,
    leftHanging: t.leftHanging,
    ...(t.slipSan !== undefined && { slipSan: t.slipSan as string }),
    ...(t.slipFacts !== undefined && { slipFacts: [...(t.slipFacts as string[])] }),
    why: t.why,
    whyBy: t.whyBy,
  };
}

/** A stored review, checked against its game; null if any part doesn't match. */
export function parseReview(v: unknown, moves: readonly string[]): GameReview | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (r.version !== 1 || !isText(r.result, 200) || !isText(r.lesson)) return null;
  if (r.lessonBy !== "coach" && r.lessonBy !== "engine") return null;
  if (!Array.isArray(r.points) || r.points.length > MAX_POINTS) return null;
  const points: TurningPoint[] = [];
  for (const p of r.points) {
    const point = parsePoint(p, moves);
    if (!point) return null;
    points.push(point);
  }
  return { version: 1, result: r.result, points, lesson: r.lesson, lessonBy: r.lessonBy };
}

const isIsoDate = (v: unknown): v is string =>
  typeof v === "string" && !Number.isNaN(Date.parse(v));

/** Returns the record if `data` is a valid one, else null. A bad review drops the review, not the game. */
export function parseHistoryRecord(data: unknown): HistoryRecord | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.version !== HISTORY_VERSION) return null;
  if (typeof d.id !== "string" || !GAME_ID.test(d.id)) return null;
  if (!OUTCOMES.includes(d.outcome as string) || !isText(d.result, 200)) return null;
  if (!isIsoDate(d.finishedAt)) return null;
  if (typeof d.resigned !== "boolean") return null;
  // The game part has the same shape as a saved game in progress.
  const game = parseSavedGame({
    version: 1,
    moves: d.moves,
    createdAt: d.createdAt,
    updatedAt: d.finishedAt,
    level: d.level,
    color: d.color,
    hints: d.hints,
    hintMode: d.hintMode,
  });
  if (!game || game.level === undefined || !game.color || !game.hintMode) return null;
  const review = d.review === undefined ? null : parseReview(d.review, game.moves);
  return {
    version: HISTORY_VERSION,
    id: d.id,
    moves: game.moves,
    level: game.level,
    color: game.color,
    hintMode: game.hintMode,
    hints: game.hints ?? [],
    resigned: d.resigned,
    createdAt: game.createdAt,
    finishedAt: d.finishedAt,
    outcome: d.outcome as Outcome,
    result: d.result,
    ...(review && { review }),
  };
}

/** Newest first; ties by id, so the order never jumps. */
export function newestFirst(records: readonly HistoryRecord[]): HistoryRecord[] {
  return [...records].sort(
    (a, b) => b.finishedAt.localeCompare(a.finishedAt) || b.id.localeCompare(a.id),
  );
}

const OUTCOME_TEXT: Record<Outcome, string> = { win: "Won", loss: "Lost", draw: "Draw" };

/** Moves each side made, as a player counts them: 1. e4 e5 is one move. */
const fullMoves = (plies: number) => Math.ceil(plies / 2);

/** What a row in the history list says about a game. */
export function historyRow(r: HistoryRecord): {
  when: string;
  outcome: string;
  details: string;
} {
  const level = LEVELS.some((l) => l.id === r.level) ? levelById(r.level).name : "";
  const n = fullMoves(r.moves.length);
  const hints = r.hints.length;
  const parts = [
    `Level ${r.level}${level ? `, ${level}` : ""}`,
    `you played ${r.color}`,
    `${n} move${n === 1 ? "" : "s"}`,
    hints ? `${hints} hint${hints === 1 ? "" : "s"}` : "no hints",
    r.review ? "reviewed" : "not reviewed yet",
  ];
  return {
    when: formatSavedAt(r.finishedAt),
    outcome: r.resigned ? "Resigned" : OUTCOME_TEXT[r.outcome],
    details: parts.join(" · "),
  };
}

const STEP_NAME: Record<HintRecord["step"], [string, string]> = {
  question: ["question", "questions"],
  plan: ["plan", "plans"],
  piece: ["piece", "pieces"],
  move: ["move", "moves"],
};

/** "Hints (Tell me): 3 used, 2 plans and 1 piece." */
export function hintsText(r: Pick<HistoryRecord, "hints" | "hintMode">): string {
  const mode = r.hintMode === "ask" ? "Ask me" : "Tell me";
  if (!r.hints.length) return `Hints (${mode}): none used.`;
  const counts = (["question", "plan", "piece", "move"] as const)
    .map((step) => [step, r.hints.filter((h) => h.step === step).length] as const)
    .filter(([, n]) => n > 0)
    .map(([step, n]) => `${n} ${STEP_NAME[step][n === 1 ? 0 : 1]}`);
  const list =
    counts.length > 1 ? `${counts.slice(0, -1).join(", ")} and ${counts.at(-1)}` : counts[0];
  return `Hints (${mode}): ${r.hints.length} used, ${list}.`;
}
