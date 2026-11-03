// Hint prompts for the coach. The engine supplies every chess fact; these
// prompts give Claude those facts and forbid it from calculating on its own.
// Pure functions, unit tested.
import { Chess } from "chess.js";
import { movesSoFar, numberedLine, pieceList, uciLineToSan } from "../chess/notation";
import { type Analysis, type Score, formatScore } from "../engine/uci";
import { describeError } from "./errors";
import {
  lineOutcome,
  materialBalance,
  moveFacts,
  positionFacts,
  threatenedPieces,
} from "./move-facts";

/** Everything the coach may say about a position, all from the engine. */
export interface EngineFacts {
  sideToMove: "White" | "Black";
  movesSoFar: string;
  whitePieces: string;
  blackPieces: string;
  fen: string;
  /** The engine's reported best move in SAN, e.g. "Nf6". Null when there are no legal moves. */
  bestMove: string | null;
  /** Destination square of the best move, e.g. "f6"; used to catch leaks in early hints. */
  bestMoveTo: string | null;
  /** Starting square of the best move, e.g. "g8". */
  bestMoveFrom: string | null;
  /** Which piece makes the best move ("n" for a knight), or "castle". */
  bestPiece: BestPiece | null;
  /** True when the piece that makes the best move is itself listed as under attack. */
  bestPieceAttacked: boolean;
  /** Best line in SAN with move numbers. */
  bestLine: string;
  /** Best line as plain SAN moves. */
  lineSans: string[];
  /** What the best move concretely does, worked out from the rules. */
  moveFacts: string[];
  /** Pieces under real attack before the move, worked out from the rules. */
  threats: string[];
  /** Material at the end of the engine's line. */
  lineOutcome: string;
  evaluation: string;
  evaluationInWords: string;
  depth: number;
}

/**
 * One hint step. Tell mode gives plan, then piece, then move. Ask mode starts
 * with a guiding question (a second only on request), then the tell steps.
 */
export type HintStage = "question" | "plan" | "piece" | "move";

export type BestPiece = "p" | "n" | "b" | "r" | "q" | "k" | "castle";

export function buildFacts(game: Chess, analysis: Analysis): EngineFacts {
  // Trust the engine's reported best move; use its line only if it starts there.
  const best = analysis.bestMove ? (uciLineToSan(game, [analysis.bestMove])[0] ?? null) : null;
  let line = uciLineToSan(game, analysis.pv);
  if (!best) line = [];
  else if (line[0] !== best) line = [best];
  return {
    sideToMove: game.turn() === "w" ? "White" : "Black",
    movesSoFar: movesSoFar(game),
    whitePieces: pieceList(game, "w"),
    blackPieces: pieceList(game, "b"),
    fen: game.fen(),
    bestMove: best,
    bestMoveTo: best && analysis.bestMove ? analysis.bestMove.slice(2, 4) : null,
    bestMoveFrom: best && analysis.bestMove ? analysis.bestMove.slice(0, 2) : null,
    bestPiece: best && analysis.bestMove ? bestPiece(game, best, analysis.bestMove) : null,
    bestPieceAttacked:
      !!best &&
      !!analysis.bestMove &&
      threatenedPieces(game).some((t) => t.square === analysis.bestMove!.slice(0, 2)),
    bestLine: numberedLine(game, line),
    lineSans: line,
    moveFacts: best ? moveFacts(game, best) : [],
    threats: positionFacts(game),
    lineOutcome: line.length ? lineOutcome(game, line) : "",
    evaluation: analysis.score ? formatScore(analysis.score) : "not reported",
    evaluationInWords: analysis.score ? evaluationInWords(analysis.score) : "not reported",
    depth: analysis.depth,
  };
}

function bestPiece(game: Chess, san: string, uci: string): BestPiece | null {
  if (san.startsWith("O-O")) return "castle";
  const p = game.get(uci.slice(0, 2) as Parameters<Chess["get"]>[0]);
  return p ? p.type : null;
}

/** Plain-English reading of an engine score (White's point of view). */
export function evaluationInWords(score: Score): string {
  if (score.mate !== undefined) {
    if (score.mate === 0) return "checkmate";
    return score.mate > 0 ? "White has a forced mate" : "Black has a forced mate";
  }
  const cp = score.cp ?? 0;
  const abs = Math.abs(cp);
  const side = cp > 0 ? "White" : "Black";
  if (abs < 30) return "roughly equal";
  if (abs < 80) return `${side} is slightly better`;
  if (abs < 200) return `${side} is clearly better`;
  return `${side} is winning`;
}

export function factsText(f: EngineFacts): string {
  return [
    `Side to move: ${f.sideToMove}`,
    `Moves so far: ${f.movesSoFar}`,
    `White pieces: ${f.whitePieces}`,
    `Black pieces: ${f.blackPieces}`,
    `FEN: ${f.fen}`,
    `Engine best move: ${f.bestMove ?? "none (no legal moves)"}`,
    `Engine best line: ${f.bestLine || "none"}`,
    `Engine evaluation: ${f.evaluation} (${f.evaluationInWords}), depth ${f.depth}`,
    "Pieces under attack now (from the rules of chess):",
    ...(f.threats.length ? f.threats.map((t) => `- ${t}`) : ["- none"]),
    "What the best move does (from the rules of chess):",
    ...f.moveFacts.map((m) => `- ${m}`),
    ...(f.lineOutcome ? [`- ${f.lineOutcome}`] : []),
  ].join("\n");
}

/**
 * What a move does (moveFacts) without the move, its piece or its squares:
 * for a coach that must not give the move away.
 */
export function redactMoveFacts(facts: readonly string[]): string[] {
  return facts
    .slice(1)
    .map((m) =>
      m
        .replace(/^On [a-h][1-8] the moved piece/, "On its new square the moved piece")
        .replace(
          /^(It captures an? \w+)\.$/,
          "$1 (don't name its square: that gives the move away).",
        ),
    );
}

const PIECE_NAME: Record<BestPiece, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
  castle: "king",
};

/**
 * The facts for the question, plan and piece steps: the best move itself
 * stays secret (no move, line or destination), so the coach can't give it
 * away. What the move does is kept, worded about "the moved piece". The
 * piece step (`showPiece`) is told which piece moves, the earlier steps not.
 */
export function hiddenFactsText(f: EngineFacts, showPiece = false): string {
  const side = f.sideToMove;
  const piece = f.bestPiece ? `${side}'s ${PIECE_NAME[f.bestPiece]} on ${f.bestMoveFrom}` : "";
  const what =
    showPiece && piece
      ? `The piece that makes the best move: ${piece}. Where it goes stays secret for now.`
      : f.bestPiece === "castle"
        ? `The best move tucks ${side}'s king away from the centre.`
        : `The best move moves one of ${side}'s pieces (which one, and where, stay secret for now).`;
  // Which listed threat the move answers is the engine's call, not the coach's.
  const which =
    f.bestPiece === "castle" || showPiece
      ? null
      : f.bestPieceAttacked
        ? `The piece that moves is the one on ${f.bestMoveFrom}, listed as under attack.`
        : "The piece that moves is not one of those listed as under attack; don't suggest moving those.";
  const does = redactMoveFacts(f.moveFacts);
  const threats = f.threats.map((t) => redactThreat(t, f, showPiece));
  return [
    `Side to move: ${side}`,
    `Moves so far: ${f.movesSoFar}`,
    `White pieces: ${f.whitePieces}`,
    `Black pieces: ${f.blackPieces}`,
    `Engine evaluation: ${f.evaluation} (${f.evaluationInWords}), depth ${f.depth}`,
    "Pieces under attack now (from the rules of chess):",
    ...(threats.length ? threats.map((t) => `- ${t}`) : ["- none"]),
    ...(f.bestMove ? ["What the best move does (from the rules of chess):", `- ${what}`] : []),
    ...(f.bestMove && which ? [`- ${which}`] : []),
    ...does.map((m) => `- ${m}`),
    ...(f.lineOutcome ? [`- ${f.lineOutcome}`] : []),
  ].join("\n");
}

const PIECE_WORDS = "(?:pawn|knight|bishop|rook|queen|king)";

/**
 * A threat line for a step that keeps the move secret (CC-023). When the best
 * move captures a listed piece (the one attacked, or its attacker), that
 * piece's square is where the move goes, so it is replaced by a note to keep
 * it secret. Before the piece step, the
 * piece that moves is also unnamed when it is the attacker. A coach that never
 * sees the square can't let it slip; at level 1 such captures are common.
 */
function redactThreat(threat: string, f: EngineFacts, showPiece: boolean): string {
  let t = threat;
  if (f.bestMoveTo && f.bestPiece !== "castle") {
    t = t.replace(
      new RegExp(`(\\w+'s ${PIECE_WORDS}) on ${f.bestMoveTo}\\b`, "g"),
      "$1 (on the square the best move goes to, so don't name it)",
    );
  }
  if (!showPiece && !f.bestPieceAttacked && f.bestMoveFrom && f.bestPiece !== "castle") {
    t = t.replace(
      new RegExp(`${f.sideToMove}'s ${PIECE_WORDS} on ${f.bestMoveFrom}\\b`, "g"),
      `one of ${f.sideToMove}'s pieces (the one that makes the best move: keep it secret)`,
    );
  }
  return t;
}

const RULES = [
  "You are the coach in Chess Coach, helping a beginner during a practice game.",
  "Use ONLY the engine facts provided. Do not calculate variations yourself.",
  "Explain a move only with the listed facts about what it does and the engine's",
  "evaluation. Never claim a move attacks, defends, wins, sacrifices or threatens",
  "anything that is not listed. Never claim a threat, a weakness or a mate that is",
  "not in the facts: pieces under attack are listed, nothing else is a threat.",
  "Only mention moves already played, moves in the engine's best line, or moves",
  "the engine evaluated for you. Write plain English for the player, in standard",
  "algebraic notation (e.g. Nf6). Don't mention tools, prompts or how you got the facts.",
  "Never recite the engine's line move by move: teach the idea in plain words.",
];

const HIDE_ALL = [
  "The player asks for the piece and then the move in later steps, so naming them now",
  "spoils the hint. Talk about the idea, not about which piece to move: say 'one of",
  "your pieces', never 'your knight' or 'castle'. You may name the opponent's pieces,",
  "and the moving piece only if the facts say it is listed as under attack. Name no",
  "move, and not the square the move starts from or goes to.",
];

const STAGE_RULES: Record<HintStage, string[]> = {
  question: [
    "The player wants to find the move themselves. Ask ONE short guiding question",
    "(at most 30 words) that points them towards the idea behind the engine's best",
    "move, using only the listed facts: what the best move attacks, defends or",
    "captures, a piece listed as under attack, or the material change.",
    "Do not answer the question.",
    ...HIDE_ALL,
  ],
  plan: [
    "Explain the plan behind the engine's best move: what to aim for, using only the",
    "listed facts (what it attacks, defends or captures, a piece listed as under",
    "attack, the material change). At most 60 words.",
    ...HIDE_ALL,
  ],
  piece: [
    "Say which piece carries out the plan, by its type and square as given (for example",
    "'your knight on g8'), and what it will achieve, using only the listed facts. At most",
    "40 words. The player finds the move itself, so don't say where the piece goes or",
    "which way it moves: no destination square, no direction, no 'advance', 'push',",
    "'retreat' or 'to the centre', and don't name the move or say 'castle'.",
  ],
  move: [
    "The player asked for the move. Name the engine's best move exactly as given,",
    "then explain in at most 80 words, in plain words, why it works.",
  ],
};

/** What the coach already said for this position, in order. */
export interface EarlierHint {
  stage: HintStage;
  text: string;
}

/**
 * A plain hint for a step from the engine's facts alone (CC-023): shown when
 * the coach's wording for that step was held back twice, so the player can
 * always go on to the next step. Gives away no more than the step allows.
 */
export function engineHint(f: EngineFacts, stage: HintStage, again = false): string {
  const ask = stage === "question";
  const has = (start: string) => f.moveFacts.some((m) => m.startsWith(start));
  // Only the engine's line says whether a capture wins material; a trade doesn't.
  const wins = has("It captures") && lineGain(f) > 0;
  if (stage === "move") return f.bestMove ? `The engine's move: ${f.bestMove}.` : "";
  if (stage === "piece") {
    if (!f.bestPiece || !f.bestMoveFrom) return "";
    const piece = PIECE_NAME[f.bestPiece];
    const does = wins
      ? " It can win material."
      : has("It captures")
        ? " It makes a capture."
        : has("It gives check") || has("It is checkmate")
          ? " It can give check."
          : "";
    return `The piece to move: your ${piece} on ${f.bestMoveFrom}.${does}`;
  }
  // A second question in ask mode gets a different line from the first.
  if (ask && again) {
    return "Look at your opponent's pieces one by one: which of them is undefended, or attacked by something cheaper?";
  }
  if (has("It is checkmate"))
    return ask
      ? "Can you find a checkmate?"
      : "There is a checkmate in one move. Look at every check you have.";
  if (wins)
    return ask
      ? "Is there one of your opponent's pieces you can win?"
      : "You can win material: one of your opponent's pieces can be captured. Look at every capture you have.";
  if (has("It captures"))
    return ask
      ? "Which captures do you have, and what happens after each one?"
      : "A capture is the engine's choice here. Look at every capture you have, and at what your opponent can take back.";
  if (f.bestPieceAttacked)
    return ask
      ? "Which of your pieces is under attack, and where would it be safe?"
      : "One of your pieces is under attack. Find it a better square where it still does something useful.";
  if (has("It gives check"))
    return ask
      ? "Is there a check that helps you?"
      : "A check is strong here. Look at every check you have.";
  if (f.bestPiece === "castle")
    return ask
      ? "Is your king safe in the centre?"
      : "Get your king to safety, away from the centre, and bring a rook towards the middle.";
  const target = /^After it, the moved piece attacks (.+?)(?:,|\.$)/.exec(
    f.moveFacts.find((m) => m.startsWith("After it, the moved piece attacks")) ?? "",
  )?.[1];
  if (target) return ask ? `Can you attack ${target}?` : `Look for a move that attacks ${target}.`;
  return ask
    ? "Which of your pieces isn't doing much yet?"
    : "Improve your least active piece: bring it to a square where it does more.";
}

/** Material the side to move gains over the engine's line, in points. */
function lineGain(f: EngineFacts): number {
  const end = new Chess(f.fen);
  const start = materialBalance(end);
  try {
    for (const san of f.lineSans) end.move(san);
  } catch {
    return 0;
  }
  const sign = f.sideToMove === "White" ? 1 : -1;
  return sign * (materialBalance(end) - start);
}

/** A hint for this step that the check held back, so the next try can avoid the same slip. */
export interface HeldBack {
  text: string;
  leak?: Leak;
}

const LEAK_WHAT: Record<Leak["rule"], string> = {
  move: "it named the move",
  destination: "it named the square the move goes to",
  "from-square": "it named the square the moving piece stands on",
  piece: "it named the piece that moves",
  castling: "it named castling",
  direction: "it said which way the pawn goes",
};

export function buildHintPrompt(
  facts: EngineFacts | null,
  stage: HintStage,
  earlier: readonly EarlierHint[] = [],
  heldBack?: HeldBack,
): string {
  const parts = [...RULES, ...STAGE_RULES[stage]];
  if (heldBack?.text) {
    // The player asked again: say what kind of slip it was, so a new try doesn't repeat it
    // (CC-023). The words that slipped are blanked out: they'd hand the coach the answer.
    const what = heldBack.leak
      ? LEAK_WHAT[heldBack.leak.rule]
      : "it named a move the engine didn't give";
    const blank = heldBack.leak ? heldBack.leak.match : null;
    const said = (blank ? heldBack.text.split(blank).join("___") : heldBack.text)
      .replace(/\s+/g, " ")
      .trim();
    parts.push(
      `Your last answer for this step was held back because ${what}: "${said}"`,
      "Write a new one that leaves that kind of thing out.",
    );
  }
  if (stage === "question" && earlier.some((h) => h.stage === "question")) {
    parts.push("This is a second question: make it more pointed, still without the answer.");
  }
  if (earlier.some((e) => e.text)) {
    parts.push("", "What you already told the player for this move (don't repeat it):");
    for (const h of earlier.filter((e) => e.text))
      parts.push(`- ${h.stage}: ${h.text.replace(/\s+/g, " ").trim()}`);
  }
  parts.push("");
  const early = stage === "question" || stage === "plan";
  if (facts && stage !== "move") {
    parts.push("Engine facts (the best move itself is kept secret at this step):");
    parts.push(hiddenFactsText(facts, stage === "piece"));
  } else if (facts) parts.push("Engine facts:", factsText(facts));
  else {
    parts.push(
      "Get the facts first: call the getEngineAnalysis tool for the current position.",
      "To discuss an alternative move, call evaluateMove first; never judge a move without it.",
      "If a tool returns an error, reply only that the engine is unavailable right now,",
      "and give no hint.",
    );
    if (early) {
      parts.push("The tool shows you the best move: keep it, its piece and its squares hidden.");
    } else if (stage === "piece") {
      parts.push("The tool shows you the best move: keep it and where it goes hidden.");
    }
  }
  return parts.join("\n");
}

// Moves that cannot be confused with a plain square name: piece moves,
// captures and castling. ("e4" alone may just name a square.)
const MOVE_TOKEN =
  /\b(?:[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8](?:=[QRBN])?)[+#]?|O-O(?:-O)?/g;

/**
 * Compares moves loosely: "Bxf7+" and "Bf7", or "Nbd2" and "Nd2", count as the
 * same move. Keeps piece, destination and promotion.
 */
export function moveKey(san: string): string {
  const s = san.replace(/[+#!?]/g, "");
  if (s.startsWith("O-O")) return s;
  const m = /^([KQRBN])?.*?([a-h][1-8])(=[QRBN])?$/.exec(s);
  if (!m) return s;
  const piece = m[1] ?? (s.includes("x") ? s[0] : "");
  return `${piece}${m[2]}${m[3] ?? ""}`;
}

export interface FactCheck {
  /** False when the coach never received the engine's analysis. */
  hadFacts: boolean;
  /** Moves the coach mentioned that the engine never gave and nobody played. */
  unknownMoves: string[];
  /** Before the move step: true if the coach gave away what that step must hide. */
  revealedMove: boolean;
  /** Which rule caught the give-away, and the words that matched (for the diagnostics line). */
  leak?: Leak;
}

export interface Leak {
  rule: "move" | "destination" | "from-square" | "piece" | "castling" | "direction";
  match: string;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const PIECE_WORD: Partial<Record<BestPiece, RegExp>> = {
  n: /\bknights?\b/i,
  b: /\bbishops?\b/i,
  r: /\brooks?\b/i,
  q: /\bqueens?\b/i,
  castle: /\bcastl/i,
};

type HiddenFacts = Pick<EngineFacts, "bestMove" | "bestMoveTo"> &
  Partial<
    Pick<EngineFacts, "bestMoveFrom" | "bestPiece" | "bestPieceAttacked" | "sideToMove" | "fen">
  >;

// How a pawn hint gives its move away: "advance", "push your pawn", "move it
// forward", "two squares". Not "your advanced pawn" or "push your advantage".
const PAWN_DIRECTION =
  /\b(?:advanc(?:e|es|ing)|push(?:es|ing)? (?:it|your|the|this|that)\b(?! (?:slight |small |big )?advantage)|(?:move|moves|go|goes|step|steps|march|marches|send|sends) (?:it )?forwards?|(?:one|two) squares?)\b/i;

// "Capture the knight", "win their undefended queen": a piece word right after
// one of these verbs is the target, not the piece that moves.
// "Take" and "remove" are left out: "take the knight to f6" moves your own.
const TARGET =
  /(?<!\b(?:your|my)\s+)\b(?:captur(?:e|es|ing)|win|wins|winning|won|grab|grabs|grabbing|snatch|snatches|snatching|pick off|picks off|attack|attacks|attacking|hit|hits|hitting|threaten|threatens|threatening)\s+(?:the|an?|their|that|this)\s+(?:(?:undefended|loose|hanging|unprotected|enemy|opponent['’]?s)\s+)?$/i;

/**
 * The first place `word` names a piece of the side to move, if any. These
 * name the other side's piece and give nothing away: "Black's knight", "their
 * knight", "the opponent's knight", "capture the knight" (when the opponent has
 * one), and "the knight on f3" when f3 holds the opponent's knight, or another
 * knight that doesn't move.
 */
function ownPieceMatch(text: string, word: RegExp, facts: HiddenFacts): string | null {
  const side = facts.sideToMove;
  const them = side === "White" ? "Black" : side === "Black" ? "White" : null;
  const theirs = new RegExp(
    // Up to three describing words between: "Black's key defensive bishop" (CC-023).
    `(?:opponent['’]?s?|enemy|their|${them ?? "\\$^"}['’]?s?)\\s+(?:(?!(?:your|my|and|or|but|the|a|an|this|that|with|using|by|from|to|via|for|against|on|in|piece|pieces|pawns?|knights?|bishops?|rooks?|queens?|kings?)\\b)[\\w-]+\\s+){0,3}$`,
    "i",
  );
  const board = facts.fen ? new Chess(facts.fen) : null;
  const us = side === "White" ? "w" : "b";
  // A capture word only points at the opponent's piece if they have one of that kind.
  const theyHaveOne =
    !!board &&
    board.board().some((row) => row.some((c) => c && c.color !== us && c.type === facts.bestPiece));
  for (const m of text.matchAll(new RegExp(word.source, "gi"))) {
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    if (theirs.test(before) || (theyHaveOne && TARGET.test(before))) continue;
    const on = /^\s+on\s+([a-h][1-8])\b/.exec(text.slice(m.index + m[0].length));
    const piece = on && board?.get(on[1] as Parameters<Chess["get"]>[0]);
    // Another piece of that kind, named by its square, isn't the one that moves.
    const other = piece && piece.type === facts.bestPiece;
    if (other && (piece.color !== us || on[1] !== facts.bestMoveFrom)) continue;
    return m[0];
  }
  return null;
}

const hasWord = (text: string, w: string) =>
  new RegExp(`(^|[^\\w-])${escape(w)}(?![\\w-])`).test(text);

/**
 * Checks a coach answer against the engine facts. `allowedSans` is every move
 * the coach may mention: moves played, the engine line, and moves it evaluated.
 */
export function factCheck(
  text: string,
  stage: HintStage,
  facts: HiddenFacts | null,
  allowedSans: string[],
): FactCheck {
  const allowed = new Set(allowedSans.map(moveKey));
  const mentioned = [...new Set((text.match(MOVE_TOKEN) ?? []).map((m) => m.replace(/[+#]/g, "")))];
  const leak = stage !== "move" && facts?.bestMove ? findLeak(text, stage, facts) : undefined;
  return {
    hadFacts: !!facts,
    unknownMoves: mentioned.filter((m) => !allowed.has(moveKey(m))),
    revealedMove: !!leak,
    ...(leak ? { leak } : {}),
  };
}

/** What an early hint gave away, if anything: the first rule that matched. */
function findLeak(text: string, stage: HintStage, facts: HiddenFacts): Leak | undefined {
  const best = facts.bestMove!.replace(/[+#]/g, "");
  if (hasWord(text, best)) return { rule: "move", match: best };
  // The destination square gives the move away even for captures ("bishop to
  // f7 with check"), so it is always checked. Nobody names castling by its square.
  const castle = best.startsWith("O-O");
  if (!castle && facts.bestMoveTo && hasWord(text, facts.bestMoveTo)) {
    return { rule: "destination", match: facts.bestMoveTo };
  }
  // Before the piece step, the piece and where it stands stay hidden too,
  // unless that piece is under attack: then the threat itself is the idea.
  const early = (stage === "question" || stage === "plan") && !facts.bestPieceAttacked;
  if (early && !castle && facts.bestMoveFrom && hasWord(text, facts.bestMoveFrom)) {
    return { rule: "from-square", match: facts.bestMoveFrom };
  }
  // A pawn has one way to go: "your pawn on e2 will advance" is the move (CC-019).
  if (stage === "piece" && facts.bestPiece === "p") {
    const m = PAWN_DIRECTION.exec(text);
    if (m) return { rule: "direction", match: m[0] };
  }
  // Castling is the move itself, so "castle" stays hidden until the move step.
  const pieceWord = facts.bestPiece ? PIECE_WORD[facts.bestPiece] : undefined;
  if (pieceWord && (early || facts.bestPiece === "castle")) {
    const match = ownPieceMatch(text, pieceWord, facts);
    if (match) return { rule: facts.bestPiece === "castle" ? "castling" : "piece", match };
  }
  return undefined;
}

export function factCheckText(fc: FactCheck, stage: HintStage): string {
  if (!fc.hadFacts) return "Failed: the coach never got the engine's analysis.";
  const problems: string[] = [];
  if (fc.unknownMoves.length) {
    problems.push(`mentions moves the engine never gave: ${fc.unknownMoves.join(", ")}`);
  }
  if (fc.revealedMove) {
    const why = fc.leak ? ` (${fc.leak.rule}: "${fc.leak.match}")` : "";
    problems.push(`gives away what the ${stage} step must keep hidden${why}`);
  }
  if (problems.length) return `Failed: ${problems.join("; ")}.`;
  return stage === "move"
    ? "Passed: no move from outside the engine's line."
    : "Passed: no move from outside the engine's line, and the move stays hidden.";
}

/** Player-facing message for a failed hint, by sample error code. */
export function hintErrorMessage(code: string | undefined): { message: string; disable: boolean } {
  switch (code) {
    case "refused":
      return { message: "Claude declined this hint. Try again.", disable: false };
    case "empty_completion":
    case "invalid_request":
    case "prompt_too_large":
      return { message: "The coach couldn't write this hint. Try again.", disable: false };
    case "tools_unavailable":
      return {
        message: "This view can't let the coach call the engine. Switched to 'Facts in prompt'.",
        disable: false,
      };
    default:
      return describeError(code);
  }
}
