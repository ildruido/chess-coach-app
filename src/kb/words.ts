// Word matching for the coach knowledge base (CC-031; moved from the lesson
// answers of CC-027). A question asked again, even in other words, finds its
// saved answer: normalised words with chess synonyms, and the hard facts
// (squares, pieces, moves) must be exactly the same. Pure logic, unit tested.

import { moveKey } from "../coach/hint";
import { QUESTION_MOVE } from "../lessons/ask";

/** Words that carry no meaning for matching. */
const FILLER = new Set(
  (
    "i me mine you we us our the a an is are was were be been am can could do does did " +
    "it its this that these those there here to of in on at for about if so just please " +
    "would will shall and or then now really also very some any one get got go going " +
    "piece pieces move moves"
  ).split(" "),
);

/** Chess synonyms, mapped to one word. Pieces are mapped too, then kept as hard facts. */
const SYNONYMS: Record<string, string> = {
  horse: "knight",
  horsey: "knight",
  knights: "knight",
  bishops: "bishop",
  castle: "castling",
  castles: "castling",
  rooks: "rook",
  queens: "queen",
  kings: "king",
  pawns: "pawn",
  take: "capture",
  takes: "capture",
  taking: "capture",
  took: "capture",
  grab: "capture",
  eat: "capture",
  win: "capture",
  protect: "defend",
  protected: "defend",
  protects: "defend",
  guard: "defend",
  guarded: "defend",
  guards: "defend",
  threaten: "attack",
  threatens: "attack",
  threatened: "attack",
  swap: "trade",
  exchange: "trade",
  undefended: "hang",
  unprotected: "hang",
  loose: "hang",
  free: "hang",
  hanging: "hang",
  checkmate: "mate",
  "can't": "not",
  cannot: "not",
  "don't": "not",
  "doesn't": "not",
  "isn't": "not",
  "won't": "not",
  "shouldn't": "not",
  "wouldn't": "not",
  "couldn't": "not",
  no: "not",
};

const PIECES = new Set(["knight", "bishop", "rook", "queen", "king", "pawn"]);

/** A tiny stemmer: "forking" → "fork", "defends" → "defend". Keeps stems of 3+ letters. */
function stem(w: string): string {
  for (const end of ["ing", "ed", "es", "s"]) {
    if (w.endsWith(end) && w.length - end.length >= 3) return w.slice(0, -end.length);
  }
  return w;
}

/**
 * Words that change what a question is about: whose piece, which side, with
 * what, "not". With the pieces, squares and moves they are hard facts.
 */
const HARD = new Set([
  "my",
  "your",
  "his",
  "her",
  "their",
  "opponent",
  "white",
  "black",
  "with",
  "not",
  "kingside",
  "queenside",
  "light",
  "dark",
]);

/** A file-pawn or file word ("f-pawn", "g file") as one fact. "a pawn" is an article, so only "a-pawn". */
function fileWord(w: string, prev: string | undefined): string | null {
  const joined = /^([a-h])-(pawn|file)s?$/.exec(w);
  if (joined) return `${joined[1]}-${joined[2]}`;
  if ((w === "pawn" || w === "file") && prev && /^[b-h]$/.test(prev)) return `${prev}-${w}`;
  return null;
}

/**
 * The hard facts of a question, in order: squares, moves, pieces, whose they
 * are, "with", "not" and file names. These must match exactly, order included,
 * so "my knight takes the bishop" never matches "the bishop takes my knight".
 */
export function hardFacts(question: string): string[] {
  const moves: string[] = [];
  const marked = question.replace(QUESTION_MOVE, (m) => {
    let t = m.replace(/[+#]/g, "").replace(/0/g, "O");
    if (/^[kqrn]/.test(t)) t = t[0]!.toUpperCase() + t.slice(1);
    moves.push(moveKey(t));
    return ` mv${moves.length - 1} `;
  });
  const facts: string[] = [];
  const ws = words(marked);
  ws.forEach((w, i) => {
    const mv = /^mv(\d+)$/.exec(w);
    const shade = /^(light|dark)-squared?$/.exec(w)?.[1];
    const fact = mv
      ? moves[Number(mv[1])]!
      : (fileWord(w, ws[i - 1]) ?? shade ?? (PIECES.has(w) || HARD.has(w) ? w : null));
    if (!fact) return;
    if (facts.at(-1) !== fact) facts.push(fact);
  });
  return facts;
}

/** Lower-case words with synonyms mapped, before fillers are dropped. */
function words(question: string): string[] {
  return (
    question
      .toLowerCase()
      .replace(/[’`]/g, "'")
      .split(/[^a-z0-9'-]+/)
      .map((w) => w.replace(/^'+|'+$/g, ""))
      .filter(Boolean)
      // "what's" → "what", "knight's" → "knight"; the "n't" forms are synonyms of "not".
      .map(
        (w) =>
          SYNONYMS[w] ??
          SYNONYMS[w.replace(/'(?:s|re|ll|ve|d|m)$/, "")] ??
          w.replace(/'(?:s|re|ll|ve|d|m)$/, ""),
      )
  );
}

/** The words that carry meaning: no fillers, pieces, squares or moves (those are hard facts). */
export function contentWords(question: string): string[] {
  const noMoves = question.replace(QUESTION_MOVE, " ");
  const out = new Set<string>();
  for (const w of words(noMoves)) {
    if (FILLER.has(w) || PIECES.has(w) || HARD.has(w) || /\d/.test(w)) continue;
    if (/^[a-h]$/.test(w) || fileWord(w, undefined) || /-squared?$/.test(w)) continue;
    out.add(stem(w));
  }
  return [...out];
}

/** Rarer words count more: 1 + ln((n + 1) / (df + 1)) over the saved questions. */
export function wordWeights(questions: readonly string[]): (w: string) => number {
  const df = new Map<string, number>();
  for (const q of questions) for (const w of contentWords(q)) df.set(w, (df.get(w) ?? 0) + 1);
  const n = questions.length;
  return (w) => 1 + Math.log((n + 1) / ((df.get(w) ?? 0) + 1));
}

/** How alike two questions are, 0 to 1. Different hard facts always score 0. */
export function similarity(a: string, b: string, weight: (w: string) => number = () => 1): number {
  if (hardFacts(a).join(" ") !== hardFacts(b).join(" ")) return 0;
  const wa = contentWords(a);
  const wb = contentWords(b);
  // With no meaningful words left, only the same wording counts.
  if (!wa.length || !wb.length) return norm(a) === norm(b) ? 1 : 0;
  const sb = new Set(wb);
  const shared = wa.filter((w) => sb.has(w));
  const sum = (ws: string[]) => ws.reduce((s, w) => s + weight(w), 0);
  return (2 * sum(shared)) / (sum(wa) + sum(wb));
}

const norm = (q: string) => words(q).join(" ");
