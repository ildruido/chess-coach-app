// Turns what Ale says or dictates in the "Talk to the coach" box into one
// request (CC-033). No DOM and no coach call, so it is unit tested. A move is
// only recognised when the whole sentence is a move ("play knight f3", "e2 to
// e4", "castle kingside"); "what if Nf3?" is a question for the coach.
import type { Chess, Move } from "chess.js";
import {
  type Choice,
  askWhich,
  looksLikeNaturalMove,
  matchPhrase,
  readNatural,
  toChoices,
} from "./phrasing";

export type Command =
  | { kind: "empty" }
  | { kind: "hint" }
  | { kind: "review" }
  | { kind: "move"; san: string; from: string; to: string; promotion?: string }
  | { kind: "bad-move"; reason: string }
  /** More than one move fits: ask, then resolve the answer with `pickChoice`. */
  | { kind: "which"; question: string; choices: Choice[] }
  | { kind: "question"; text: string };

const NUMBERS: Record<string, string> = {
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
};
const PIECES: Record<string, string> = {
  king: "k",
  queen: "q",
  rook: "r",
  castle: "r",
  bishop: "b",
  knight: "n",
  horse: "n",
  pawn: "p",
};
const PIECE_WORDS = Object.keys(PIECES).join("|");

/** Lower case, spoken numbers as digits, "e 4" as "e4", punctuation gone. */
export function normalise(text: string): string {
  let s = text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ");
  s = s.replace(/\b(one|two|three|four|five|six|seven|eight)\b/g, (w) => NUMBERS[w]!);
  s = s.replace(/\b([a-h])\s+([1-8])\b/g, "$1$2");
  return s.replace(/\s+/g, " ").trim();
}

/** "yes" or "no" to a move waiting for confirmation, else null. */
export function confirmation(text: string): "yes" | "no" | null {
  const s = normalise(text);
  if (
    /^(?:yes|yeah|yep|ok|okay|sure|confirm|go|do it|play it|play that|go ahead)(?: please)?$/.test(
      s,
    )
  )
    return "yes";
  if (/^(?:no|nope|cancel|stop|never mind|nevermind|don t|dont)\b/.test(s)) return "no";
  return null;
}

const HINT =
  /\b(?:hint|clue|tip)\b|^(?:help|help me)$|what should i (?:do|play)|what do i do|what s (?:my|the) best move|any ideas?\b/;
const REVIEW = /\breview\b|how did i (?:do|play)|\banalys[ie]s?\b(?: the| my)? game/;
const LEAD =
  /^(?:(?:please|now|ok|okay|let s|lets|i|i ll|i will|i d like to|i want to|i would like to)\s+)*(play|move|go)\s+/;

interface Wanted {
  piece: string;
  /** Exact starting square, a file or a rank, when the speaker said one. */
  from?: string;
  fromFile?: string;
  to: string;
}

/** Reads a spoken move such as "knight takes d5" or "e2 to e4"; null when it isn't a move. */
function readMove(rest: string): Wanted | null {
  let m = /^([a-h][1-8])\s*(?:to|takes|captures|x)?\s*([a-h][1-8])$/.exec(rest);
  if (m) return { piece: "", from: m[1], to: m[2]! };
  m = /^([a-h])\s*(?:takes|captures|x)\s*(?:on\s+)?([a-h][1-8])$/.exec(rest);
  if (m) return { piece: "p", fromFile: m[1], to: m[2]! };
  m = new RegExp(
    `^(${PIECE_WORDS})?\\s*(?:to|takes|captures|x|on)?\\s*(?:(?:takes|captures|x)\\s*)?(?:on\\s+)?(?:([a-h])\\s+)?([a-h][1-8])$`,
  ).exec(rest);
  if (m) return { piece: PIECES[m[1] ?? "pawn"]!, fromFile: m[2], to: m[3]! };
  return null;
}

function castleSide(s: string): "O-O" | "O-O-O" | null {
  if (!/\bcastl(?:e|es|ing)\b|^o-o(?:-o)?$/.test(s)) return null;
  return /queen|long|o-o-o/.test(s) ? "O-O-O" : "O-O";
}

/** The promotion piece named after a move ("... promote to knight"); queen by default. */
function promotionPiece(s: string): { rest: string; piece: string } {
  const m =
    /\s*(?:and\s+)?(?:promot(?:e|es|ing)|become|becomes|=|equals)\s*(?:to|into)?\s*(?:a|an|the)?\s*(queen|rook|bishop|knight)$/.exec(
      s,
    );
  if (!m) return { rest: s, piece: "q" };
  return { rest: s.slice(0, m.index), piece: PIECES[m[1]!]! };
}

/** Finds the legal move the speaker meant in `game`, or says why not. */
export function findMove(spoken: string, game: Chess): Command {
  const s = normalise(spoken).replace(LEAD, "").trim();
  const legal = game.moves({ verbose: true });
  const castle = castleSide(s);
  if (castle) {
    const found = legal.find((mv) => mv.san.replace(/[+#]/g, "") === castle);
    return found
      ? { kind: "move", san: found.san, from: found.from, to: found.to }
      : { kind: "bad-move", reason: "You can't castle that way right now." };
  }
  const { rest, piece: promo } = promotionPiece(s);
  const want = readMove(rest);
  if (!want) {
    const phrase = readNatural(rest);
    if (!phrase) {
      return {
        kind: "bad-move",
        reason: "I didn't catch a move. Try “knight f3”, “the left bishop to d5” or “e2 to e4”.",
      };
    }
    return resolve(matchPhrase(phrase, game, promo), game, "That move isn't possible here.");
  }
  let found = legal.filter(
    (mv) =>
      mv.to === want.to &&
      (want.from ? mv.from === want.from : true) &&
      (want.piece ? mv.piece === want.piece : true) &&
      (want.fromFile ? mv.from[0] === want.fromFile : true),
  );
  if (found.some((mv) => mv.promotion)) found = found.filter((mv) => mv.promotion === promo);
  return resolve(found, game, `${want.to} isn't a move you can make that way here.`);
}

/** One move to propose, a question when several fit, or the reason none does. */
function resolve(found: Move[], game: Chess, none: string): Command {
  if (!found.length) return { kind: "bad-move", reason: none };
  if (found.length > 1) {
    return { kind: "which", question: askWhich(found, game), choices: toChoices(found, game) };
  }
  const mv = found[0]!;
  return {
    kind: "move",
    san: mv.san,
    from: mv.from,
    to: mv.to,
    ...(mv.promotion ? { promotion: mv.promotion } : {}),
  };
}

/** What Ale asked for. `game` is the position on the board, to find moves in. */
export function parseCommand(text: string, game: Chess): Command {
  const s = normalise(text);
  if (!s) return { kind: "empty" };
  // Only short sentences are commands: "any tips on my opening?" is a question.
  const short = s.split(" ").length <= 6;
  if (short && REVIEW.test(s)) return { kind: "review" };
  if (short && HINT.test(s)) return { kind: "hint" };
  const body = s.replace(LEAD, "");
  const said = body !== s;
  // A whole sentence that is a move, or anything after "play"/"move"/"go".
  const isMove =
    castleSide(body) ||
    readMove(promotionPiece(body).rest) ||
    looksLikeNaturalMove(promotionPiece(body).rest);
  if (isMove || (said && body.length < 30)) return findMove(s, game);
  return { kind: "question", text: text.replace(/\s+/g, " ").trim() };
}
