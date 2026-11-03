// The one request the page may send to the coach (CC-130). The page sends what the
// engine reported (positions, moves, analyses) and, where the player typed it, a
// short question; it never sends prompt text. The server rebuilds every chess fact
// from the rules and builds the prompt itself (`renderCall`), so /api/coach cannot
// be used as plain chat. Pure logic with no DOM: the server uses a synced copy of
// this file (scripts/sync-shared.mjs), and the e2e test build renders the same
// prompt for its fake coach.
import { gameAt } from "../chess/notation";
import type { Analysis, Position, Score, SearchInfo } from "../engine/uci";
import {
  acceptAsk,
  acceptReword,
  type AskContext,
  buildAskPrompt,
  buildRewordPrompt,
  MAX_QUESTION,
  namedMoveFacts,
  tidyQuestion,
} from "../lessons/ask";
import { acceptWhy, buildWhyPrompt, type WhyFacts } from "../lessons/why";
import { acceptComment, buildCommentPrompt, reviewMove } from "./commentary";
import { buildFacts, buildHintPrompt, factCheck, type EarlierHint, type HintStage } from "./hint";
import type { Leak } from "./hint";
import { acceptPracticeAnswer, buildPracticeAskPrompt } from "./practice-ask";
import { buildReviewPrompt, engineReview, parseReviewAnswer, turningPoints } from "./review";

export type CallPurpose = "hint" | "comment" | "ask" | "lesson-ask" | "reword" | "why" | "review";

export const PURPOSES: readonly CallPurpose[] = [
  "hint",
  "comment",
  "ask",
  "lesson-ask",
  "reword",
  "why",
  "review",
];

/** Who pays for what: routine coaching is quick, only the post-game review is the default tier. */
export const CALL_POLICY: Record<CallPurpose, { tier: "quick" | "default"; maxTokens: number }> = {
  hint: { tier: "quick", maxTokens: 220 },
  comment: { tier: "quick", maxTokens: 120 },
  ask: { tier: "quick", maxTokens: 260 },
  "lesson-ask": { tier: "quick", maxTokens: 260 },
  reword: { tier: "quick", maxTokens: 200 },
  why: { tier: "quick", maxTokens: 160 },
  review: { tier: "default", maxTokens: 900 },
};

/** A move the engine analysed after the player named it in a question. */
export interface NamedCall {
  san: string;
  after: Analysis;
}

export interface LessonCall {
  title: string;
  kind: AskContext["kind"];
  /** The step's text on screen, with {references}. */
  text: string;
  /** Moves the step's text and line name. */
  textSans: string[];
  /** In an open quiz, the squares that answer it (CC-070). */
  answerSquares?: string[];
}

export interface HintCall {
  purpose: "hint";
  position: Position;
  analysis: Analysis;
  stage: HintStage;
  earlier?: EarlierHint[];
  heldBack?: { text: string; leak?: Leak };
}
export interface CommentCall {
  purpose: "comment";
  position: Position;
  before: Analysis;
  after: Analysis | null;
  playedUci: string;
  hideBest: boolean;
}
export interface AskCall {
  purpose: "ask";
  position: Position;
  analysis: Analysis;
  question: string;
  named?: NamedCall;
}
export interface LessonAskCall {
  purpose: "lesson-ask";
  lesson: LessonCall;
  /** An open exercise or quiz: the answer stays secret. */
  secret: boolean;
  position: Position;
  analysis: Analysis;
  question: string;
  named?: NamedCall;
}
export interface RewordCall {
  purpose: "reword";
  lesson: LessonCall;
  position: Position;
  earlier?: string[];
}
export interface WhyCall {
  purpose: "why";
  fen: string;
  moves: string[];
  playedSan: string;
  replySans: string[];
  warning: string;
}
export interface ReviewCall {
  purpose: "review";
  moves: string[];
  /** analyses[i]: the engine's view of the position after the first i moves. */
  analyses: (Analysis | null)[];
  playerFirst: 0 | 1;
  result: string;
  player: "white" | "black";
  level: string;
}

export type CoachCall = (
  HintCall | CommentCall | AskCall | LessonAskCall | RewordCall | WhyCall | ReviewCall
) & {
  /** Ask the coach again even if a saved answer exists ("Ask the coach anyway"). */
  fresh?: boolean;
};

/** A request the server refuses before spending anything. */
export class CallError extends Error {}

// ---------- validation ----------

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const SAN = /^[KQRBNa-hO][\w=+#x-]{1,9}$/;
const SQUARE = /^[a-h][1-8]$/;
const MAX_MOVES = 400;
const MAX_LINE = 40;
/** A review replays the game for every move; longer games are cut off here, not in a server loop. */
export const MAX_REVIEW_MOVES = 200;
const MAX_FIELD = 300;
const MAX_LESSON_TEXT = 900;

const HINT_STAGES: readonly HintStage[] = ["question", "plan", "piece", "move"];
const LEAK_RULES = ["move", "destination", "from-square", "piece", "castling", "direction"];
const LESSON_KINDS = ["explain", "show", "quiz", "exercise"];

function bad(what: string): never {
  throw new CallError(`bad ${what}`);
}

/** Plain text of a bounded length: no control characters, whitespace folded. */
function text(v: unknown, what: string, max: number, min = 0): string {
  if (typeof v !== "string") bad(what);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)) bad(what);
  const t = v.replace(/\s+/g, " ").trim();
  if (t.length < min || t.length > max) bad(what);
  return t;
}

function int(v: unknown, what: string, lo: number, hi: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) bad(what);
  return v;
}

function uciList(v: unknown, what: string, max: number): string[] {
  if (!Array.isArray(v) || v.length > max) bad(what);
  return v.map((m) => (typeof m === "string" && UCI.test(m) ? m : bad(what)));
}

function score(v: unknown): Score {
  if (!isObj(v)) bad("score");
  const out: Score = {};
  if (v.cp !== undefined) out.cp = int(v.cp, "score", -100_000, 100_000);
  if (v.mate !== undefined) out.mate = int(v.mate, "score", -1000, 1000);
  return out;
}

function info(v: unknown): SearchInfo {
  if (!isObj(v)) bad("analysis");
  return {
    depth: int(v.depth, "analysis", 0, 99),
    multipv: int(v.multipv, "analysis", 1, 8),
    score: score(v.score),
    pv: uciList(v.pv, "analysis", MAX_LINE),
  };
}

/** The engine's report, rebuilt field by field so nothing else gets through. */
export function parseAnalysis(v: unknown): Analysis {
  if (!isObj(v)) bad("analysis");
  const best = v.bestMove;
  if (best !== null && !(typeof best === "string" && UCI.test(best))) bad("analysis");
  const lines = v.lines;
  if (lines !== undefined && (!Array.isArray(lines) || lines.length > 6)) bad("analysis");
  return {
    bestMove: best,
    depth: int(v.depth, "analysis", 0, 99),
    ...(v.score !== undefined && { score: score(v.score) }),
    pv: uciList(v.pv, "analysis", MAX_LINE),
    ms: int(Math.round(Number(v.ms ?? 0)), "analysis", 0, 3_600_000),
    ...(lines && { lines: (lines as unknown[]).map(info) }),
  };
}

/** A position, replayed with the rules: an illegal move or a broken FEN refuses the request. */
export function parsePosition(v: unknown): Position {
  if (!isObj(v)) bad("position");
  const fen = v.fen === undefined ? undefined : text(v.fen, "position", 100, 10);
  const moves = v.moves === undefined ? [] : uciList(v.moves, "position", MAX_MOVES);
  const position: Position = { ...(fen && { fen }), moves };
  try {
    gameAt(position);
  } catch {
    bad("position");
  }
  return position;
}

function sanList(v: unknown, what: string, max: number): string[] {
  if (!Array.isArray(v) || v.length > max) bad(what);
  return v.map((s) => (typeof s === "string" && SAN.test(s) ? s : bad(what)));
}

function squareList(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > 8) bad("lesson");
  return v.map((q) => (typeof q === "string" && SQUARE.test(q) ? q : bad("lesson")));
}

function named(v: unknown, position: Position): NamedCall | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isObj(v)) bad("named move");
  const san = typeof v.san === "string" && SAN.test(v.san) ? v.san : bad("named move");
  const legal = gameAt(position).moves();
  if (!legal.includes(san)) bad("named move");
  return { san, after: parseAnalysis(v.after) };
}

function lesson(v: unknown): LessonCall {
  if (!isObj(v)) bad("lesson");
  const kind = LESSON_KINDS.includes(v.kind as string)
    ? (v.kind as LessonCall["kind"])
    : bad("lesson");
  return {
    title: text(v.title, "lesson", 120, 1),
    kind,
    text: text(v.text, "lesson", MAX_LESSON_TEXT, 1),
    textSans: sanList(v.textSans ?? [], "lesson", 16),
    ...(v.answerSquares !== undefined && { answerSquares: squareList(v.answerSquares) }),
  };
}

/** Checks an untrusted body and rebuilds it as a CoachCall, or throws CallError. */
export function parseCall(body: unknown): CoachCall {
  const call = parseBody(body);
  return isObj(body) && body.fresh === true ? { ...call, fresh: true } : call;
}

function parseBody(body: unknown): CoachCall {
  if (!isObj(body)) bad("request");
  const purpose = body.purpose;
  switch (purpose) {
    case "hint": {
      const stage = HINT_STAGES.includes(body.stage as HintStage)
        ? (body.stage as HintStage)
        : bad("stage");
      const earlierRaw = body.earlier ?? [];
      if (!Array.isArray(earlierRaw) || earlierRaw.length > 4) bad("earlier hints");
      const earlier = earlierRaw.map((e): EarlierHint => {
        if (!isObj(e) || !HINT_STAGES.includes(e.stage as HintStage)) bad("earlier hints");
        return {
          stage: e.stage as HintStage,
          text: text(e.text ?? "", "earlier hints", MAX_FIELD),
        };
      });
      let heldBack: HintCall["heldBack"];
      if (body.heldBack !== undefined && body.heldBack !== null) {
        const h = body.heldBack;
        if (!isObj(h)) bad("held back");
        const leak = h.leak;
        heldBack = {
          text: text(h.text, "held back", MAX_FIELD),
          ...(isObj(leak) &&
            LEAK_RULES.includes(leak.rule as string) && {
              leak: {
                rule: leak.rule as Leak["rule"],
                match: text(leak.match, "held back", 40),
              },
            }),
        };
      }
      const analysis = parseAnalysis(body.analysis);
      if (!analysis.bestMove) bad("analysis");
      return {
        purpose,
        position: parsePosition(body.position),
        analysis,
        stage,
        earlier,
        ...(heldBack && { heldBack }),
      };
    }
    case "comment": {
      const position = parsePosition(body.position);
      const playedUci =
        typeof body.playedUci === "string" && UCI.test(body.playedUci)
          ? body.playedUci
          : bad("played move");
      const call: CommentCall = {
        purpose,
        position,
        before: parseAnalysis(body.before),
        after: body.after ? parseAnalysis(body.after) : null,
        playedUci,
        hideBest: body.hideBest === true,
      };
      if (!reviewMove(position, call.before, call.after, playedUci)) bad("played move");
      return call;
    }
    case "ask": {
      const position = parsePosition(body.position);
      const question = tidyQuestion(text(body.question, "question", 4 * MAX_QUESTION, 1));
      if (!question) bad("question");
      const analysis = parseAnalysis(body.analysis);
      if (!analysis.bestMove) bad("analysis");
      const n = named(body.named, position);
      return { purpose, position, analysis, question, ...(n && { named: n }) };
    }
    case "lesson-ask": {
      const position = parsePosition(body.position);
      const question = tidyQuestion(text(body.question, "question", 4 * MAX_QUESTION, 1));
      if (!question) bad("question");
      const analysis = parseAnalysis(body.analysis);
      if (!analysis.bestMove) bad("analysis");
      const n = named(body.named, position);
      return {
        purpose,
        lesson: lesson(body.lesson),
        secret: body.secret === true,
        position,
        analysis,
        question,
        ...(n && { named: n }),
      };
    }
    case "reword": {
      const earlierRaw = body.earlier ?? [];
      if (!Array.isArray(earlierRaw) || earlierRaw.length > 4) bad("earlier answers");
      return {
        purpose,
        lesson: lesson(body.lesson),
        position: parsePosition(body.position),
        earlier: earlierRaw.map((e) => text(e, "earlier answers", MAX_FIELD)),
      };
    }
    case "why": {
      const fen = text(body.fen, "position", 100, 10);
      const moves = uciList(body.moves ?? [], "position", MAX_MOVES);
      parsePosition({ fen, moves });
      const playedSan =
        typeof body.playedSan === "string" && SAN.test(body.playedSan)
          ? body.playedSan
          : bad("played move");
      const replySans = sanList(body.replySans ?? [], "reply", 8);
      const g = gameAt({ fen, moves });
      try {
        g.move(playedSan);
        for (const s of replySans) g.move(s);
      } catch {
        bad("reply");
      }
      return {
        purpose,
        fen,
        moves,
        playedSan,
        replySans,
        warning: text(body.warning, "warning", MAX_FIELD, 1),
      };
    }
    case "review": {
      const moves = uciList(body.moves, "moves", MAX_REVIEW_MOVES);
      parsePosition({ moves });
      const a = body.analyses;
      if (!Array.isArray(a) || a.length > moves.length + 1) bad("analyses");
      const analyses = a.map((x) => (x === null ? null : parseAnalysis(x)));
      const player =
        body.player === "white" || body.player === "black" ? body.player : bad("player");
      return {
        purpose,
        moves,
        analyses,
        playerFirst: body.playerFirst === 1 ? 1 : 0,
        result: text(body.result, "result", 80).replace(/[^\w .,'()-]/g, ""),
        player,
        level: text(body.level, "level", 40).replace(/[^\w .,'()-]/g, ""),
      };
    }
    default:
      return bad("purpose");
  }
}

// ---------- the prompt, built from the engine's output and the rules ----------

/** The lesson step the coach is asked about, as the call carries it. */
export function lessonOf(ctx: AskContext): LessonCall {
  return {
    title: ctx.lessonTitle,
    kind: ctx.kind,
    text: ctx.text,
    textSans: ctx.textSans,
    ...(ctx.answerSquares && { answerSquares: ctx.answerSquares }),
  };
}

function askContext(call: LessonAskCall | RewordCall): AskContext {
  return {
    lessonTitle: call.lesson.title,
    kind: call.lesson.kind,
    text: call.lesson.text,
    textSans: call.lesson.textSans,
    position: call.position,
    secret: call.purpose === "lesson-ask" ? call.secret : false,
    ...(call.lesson.answerSquares && { answerSquares: call.lesson.answerSquares }),
  };
}

function whyFacts(call: WhyCall): WhyFacts {
  return {
    fen: call.fen,
    moves: call.moves,
    playedSan: call.playedSan,
    replySans: call.replySans,
    warning: call.warning,
  };
}

function namedFacts(position: Position, n: NamedCall | undefined) {
  return n ? namedMoveFacts(position, n.san, n.after) : null;
}

/** The whole prompt for a call. Throws CallError when the engine's output doesn't fit the position. */
export function renderCall(call: CoachCall): string {
  try {
    switch (call.purpose) {
      case "hint":
        return buildHintPrompt(
          buildFacts(gameAt(call.position), call.analysis),
          call.stage,
          call.earlier ?? [],
          call.heldBack,
        );
      case "comment": {
        const review = reviewMove(call.position, call.before, call.after, call.playedUci);
        if (!review) bad("played move");
        return buildCommentPrompt(review, call.hideBest);
      }
      case "ask":
        return buildPracticeAskPrompt(
          buildFacts(gameAt(call.position), call.analysis),
          call.question,
          namedFacts(call.position, call.named),
        );
      case "lesson-ask":
        return buildAskPrompt(
          askContext(call),
          buildFacts(gameAt(call.position), call.analysis),
          call.question,
          namedFacts(call.position, call.named),
        );
      case "reword":
        return buildRewordPrompt(askContext(call), call.earlier ?? []);
      case "why":
        return buildWhyPrompt(whyFacts(call));
      case "review": {
        const points = turningPoints(call.moves, call.analyses, call.playerFirst);
        return buildReviewPrompt(
          engineReview(call.result, points),
          call.moves,
          call.player,
          call.level,
        );
      }
    }
  } catch (err) {
    if (err instanceof CallError) throw err;
    throw new CallError("bad position");
  }
}

// ---------- the answer, checked against the same facts ----------

/**
 * Whether a coach answer may be shown (and, on the server, kept for others): complete,
 * naming only moves the engine gave, and not giving away what must stay hidden.
 * The page runs its own check as before; this is the server's, on the same facts.
 */
export function checkReply(call: CoachCall, reply: string, truncated: boolean): boolean {
  const t = reply.trim();
  if (!t || truncated) return false;
  try {
    switch (call.purpose) {
      case "hint": {
        const facts = buildFacts(gameAt(call.position), call.analysis);
        const allowed = [...gameAt(call.position).history(), ...facts.lineSans];
        const fc = factCheck(t, call.stage, facts, allowed);
        return !fc.unknownMoves.length && !fc.revealedMove;
      }
      case "comment": {
        const review = reviewMove(call.position, call.before, call.after, call.playedUci);
        return (
          !!review &&
          acceptComment(t, false, review, call.hideBest, gameAt(call.position).history())
        );
      }
      case "ask": {
        const facts = buildFacts(gameAt(call.position), call.analysis);
        return acceptPracticeAnswer(
          t,
          false,
          call.position,
          facts,
          namedFacts(call.position, call.named),
        );
      }
      case "lesson-ask": {
        const facts = buildFacts(gameAt(call.position), call.analysis);
        return acceptAsk(t, false, askContext(call), facts, namedFacts(call.position, call.named));
      }
      case "reword":
        return acceptReword(t, false, askContext(call));
      case "why":
        return acceptWhy(t, false, whyFacts(call));
      case "review":
        return !!parseReviewAnswer(t);
    }
  } catch {
    return false;
  }
}
