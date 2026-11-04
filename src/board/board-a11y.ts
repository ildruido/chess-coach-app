// Plain helpers that make the board usable without seeing it or without a mouse
// (CC-074): move text in words, typed moves, and a spoken-style board readout.
// No DOM here, so all of it is unit tested.
import { Chess } from "chess.js";
import { speakable } from "../voice/speakable";

const NAMES: Record<string, string> = {
  k: "king",
  q: "queen",
  r: "rook",
  b: "bishop",
  n: "knight",
  p: "pawn",
};

export interface TypedMove {
  from: string;
  to: string;
  promotion?: "q" | "r" | "b" | "n";
  san: string;
}

/** Reads a move the person typed: SAN (e4, Nf3, O-O, exd5, e8=Q) or squares (e2e4, e2 e4, e2-e4). */
export function parseTypedMove(
  fen: string,
  text: string,
): { ok: true; move: TypedMove } | { ok: false; reason: string } {
  const raw = text.trim();
  if (!raw) return { ok: false, reason: "Type a move first, for example e4 or Nf3." };
  const chess = new Chess(fen);
  const squares = /^([a-h][1-8])\s*[- ]?\s*([a-h][1-8])\s*=?\s*([qrbn])?$/i.exec(raw);
  try {
    if (squares && !squares[3]) {
      // A pawn reaching the last rank without a piece named: let the board ask which one.
      const probe = new Chess(fen);
      const from = squares[1]!.toLowerCase();
      const to = squares[2]!.toLowerCase();
      try {
        probe.move({ from, to });
      } catch {
        const q = probe.move({ from, to, promotion: "q" });
        return { ok: true, move: { from: q.from, to: q.to, san: q.san.replace("=Q", "") } };
      }
    }
    const m = squares
      ? chess.move({
          from: squares[1]!.toLowerCase(),
          to: squares[2]!.toLowerCase(),
          promotion: squares[3]?.toLowerCase(),
        })
      : chess.move(raw.replace(/^0-0-0$/, "O-O-O").replace(/^0-0$/, "O-O"), { strict: false });
    return {
      ok: true,
      move: {
        from: m.from,
        to: m.to,
        ...(m.promotion && { promotion: m.promotion as TypedMove["promotion"] }),
        san: m.san,
      },
    };
  } catch {
    return {
      ok: false,
      reason: `"${raw}" isn't a legal move here. Try another, or use Read the board to hear your legal moves.`,
    };
  }
}

/** "White played knight f3." for the move from `from` to `to` that led from `before` to `after`. */
export function announceMove(
  before: string,
  after: string,
  from: string,
  to: string,
): string | null {
  try {
    const chess = new Chess(before);
    const mover = chess.turn() === "w" ? "White" : "Black";
    const moved = chess.get(from as never)?.type;
    const reachedLast = moved === "p" && (to[1] === "8" || to[1] === "1");
    const promotion = reachedLast ? new Chess(after).get(to as never)?.type : undefined;
    const m = chess.move({ from, to, ...(promotion && { promotion }) });
    return `${mover} played ${speakable(m.san)}.`;
  } catch {
    return null;
  }
}

/** The pieces on the board in words, grouped by side, plus the side to move's legal moves. */
export function describeBoard(fen: string): string {
  const chess = new Chess(fen);
  const side = { w: [] as string[], b: [] as string[] };
  for (const row of chess.board()) {
    for (const sq of row) if (sq) side[sq.color].push(`${NAMES[sq.type]} ${sq.square}`);
  }
  const order = (list: string[]) =>
    ["king", "queen", "rook", "bishop", "knight", "pawn"].flatMap((n) =>
      list.filter((s) => s.startsWith(n)).sort(),
    );
  const turn = chess.turn() === "w" ? "White" : "Black";
  const legal = chess.moves().map((m) => speakable(m));
  return [
    `White: ${order(side.w).join(", ")}.`,
    `Black: ${order(side.b).join(", ")}.`,
    `${turn} to move.${chess.inCheck() ? " Check." : ""}`,
    legal.length ? `Legal moves: ${legal.join(", ")}.` : "No legal moves.",
  ].join(" ");
}
