// Turns coach text into words a speech voice reads well. Voices read "Nf3"
// as letters ("N F 3") and "O-O" as "oh oh", so chess notation becomes plain
// words ("knight f3", "castles kingside"). Pure, unit tested.

const PIECE: Record<string, string> = {
  K: "king",
  Q: "queen",
  R: "rook",
  B: "bishop",
  N: "knight",
};

// One SAN move: castling, a piece move or a pawn move, with check, mate and promotion.
const MOVE =
  "(?:([O0]-[O0](?:-[O0])?)|([KQRBN])([a-h]?[1-8]?)(x?)([a-h][1-8])|([a-h])(?:(x)([a-h]))?([1-8])(?:=?([QRBN]))?)([+#])?(?![\\w-])";
const SAN = new RegExp(`(?<![\\w-])${MOVE}`, "g");
// The same, without capture groups, to check that a move follows a move number.
const MOVE_AHEAD = MOVE.replace(/\((?!\?)/g, "(?:");
const BLACK_NUMBER = new RegExp(`\\b(\\d+)\\s*\\.{3}\\s*(?=${MOVE_AHEAD})`, "g");
const WHITE_NUMBER = new RegExp(`\\b(\\d+)\\.\\s*(?=${MOVE_AHEAD})`, "g");

/** One SAN move in words: "Nbxd7+" is "knight b takes d7, check". */
function moveWords(m: RegExpExecArray): string {
  const [, castle, piece, from, takes, to, pawnFile, pawnTakes, pawnTo, rank, promo, mark] = m;
  let words: string;
  if (castle) words = castle.length > 3 ? "castles queenside" : "castles kingside";
  else if (piece) words = [PIECE[piece], from, takes && "takes", to].filter(Boolean).join(" ");
  else if (pawnTakes) words = `${pawnFile} takes ${pawnTo}${rank}`;
  else words = `${pawnFile}${rank}`;
  if (promo) words += ` promotes to ${PIECE[promo]}`;
  if (mark === "+") words += ", check,";
  if (mark === "#") words += ", checkmate,";
  return words;
}

/** Coach text as a voice should say it. */
export function speakable(text: string): string {
  return (
    text
      // "12..." and "12." right before a move are move numbers ("Move 12" already says so).
      .replace(BLACK_NUMBER, (_: string, n: string, at: number, all: string) =>
        /move\s*$/i.test(all.slice(0, at)) ? `${n} for Black, ` : `move ${n} for Black, `,
      )
      .replace(WHITE_NUMBER, (_: string, n: string, at: number, all: string) =>
        /move\s*$/i.test(all.slice(0, at)) ? `${n}, ` : `move ${n}, `,
      )
      .replace(SAN, (...args) => moveWords(args as unknown as RegExpExecArray))
      // A pause after "check" only where the sentence goes on.
      .replace(/,(\s*)(?=[.!?,;:]|$)/g, "$1")
      // Arrows, emoji and other symbols are noise when spoken.
      .replace(/[→←↑↓⇒]/g, " to ")
      .replace(/\p{Extended_Pictographic}|\u200d|\ufe0f/gu, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Splits text into sentences, so each is one utterance: some voices (Chrome)
 * stop by themselves partway through a long one.
 */
export function sentences(text: string): string[] {
  // A full stop inside "e.g." or "1.5" doesn't end a sentence.
  return (text.match(/(?:\b(?:e\.g|i\.e)\.|[^.!?]|[.!?](?!\s|$))+(?:[.!?]+|$)/g) ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Longest piece spoken as one utterance: Chrome stops by itself partway through a long one. */
export const CHUNK_MAX = 160;

/** Like `sentences`, but a long sentence is also cut at commas, then at word breaks. */
export function chunks(text: string, max = CHUNK_MAX): string[] {
  const out: string[] = [];
  for (const s of sentences(text)) {
    if (s.length <= max) {
      out.push(s);
      continue;
    }
    let cur = "";
    const flush = () => {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    };
    for (const part of s.match(/[^,;:]+[,;:]?\s*/g) ?? [s]) {
      if ((cur + part).length > max) flush();
      if (part.length <= max) cur += part;
      else
        for (const word of part.split(/(?<=\s)/)) {
          if ((cur + word).length > max) flush();
          cur += word;
        }
    }
    flush();
  }
  return out;
}
