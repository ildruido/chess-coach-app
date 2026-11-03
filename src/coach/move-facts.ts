// What a move concretely does, worked out from the rules (chess.js), not by
// the coach. These are the only reasons the coach may give for a move.
// Pure functions, unit tested.
import { Chess } from "chess.js";

type Square = Parameters<Chess["get"]>[0];

const NAME = { k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" } as const;
const VALUE = { k: 0, q: 9, r: 5, b: 3, n: 3, p: 1 } as const;

type PieceType = keyof typeof NAME;

/** Material from White's point of view, in pawns (queen 9, rook 5, bishop/knight 3, pawn 1). */
export function materialBalance(game: Chess): number {
  let total = 0;
  for (const row of game.board()) {
    for (const cell of row) {
      if (cell) total += (cell.color === "w" ? 1 : -1) * VALUE[cell.type as PieceType];
    }
  }
  return total;
}

export function describeMaterial(balance: number): string {
  if (balance === 0) return "material is level";
  const side = balance > 0 ? "White" : "Black";
  const n = Math.abs(balance);
  return `${side} is ahead by ${n} point${n === 1 ? "" : "s"} of material`;
}

const pieceAt = (game: Chess, sq: Square) => {
  const p = game.get(sq);
  return p
    ? `${p.color === "w" ? "White's" : "Black's"} ${NAME[p.type as PieceType]} on ${sq}`
    : "";
};

/**
 * Facts about one move played from `game`: what it captures, whether it
 * checks, which enemy pieces the moved piece then attacks and which of its
 * own pieces it defends, and the material before and after.
 */
export function moveFacts(game: Chess, san: string): string[] {
  const after = new Chess(game.fen());
  const move = after.move(san);
  const us = move.color;
  const them = us === "w" ? "b" : "w";
  const mover = `${us === "w" ? "White's" : "Black's"} ${NAME[move.piece as PieceType]}`;
  const facts: string[] = [];

  if (move.isKingsideCastle() || move.isQueensideCastle()) {
    facts.push(`${san} castles ${move.isKingsideCastle() ? "kingside" : "queenside"}.`);
  } else {
    facts.push(`${san} moves ${mover} from ${move.from} to ${move.to}.`);
  }
  if (move.captured) facts.push(`It captures a ${NAME[move.captured as PieceType]}.`);
  if (move.promotion) facts.push(`It promotes to a ${NAME[move.promotion as PieceType]}.`);
  if (after.isCheckmate()) facts.push("It is checkmate.");
  else if (after.inCheck()) facts.push("It gives check.");

  const attacked: string[] = [];
  const defended: string[] = [];
  for (const row of after.board()) {
    for (const cell of row) {
      if (!cell || cell.square === move.to) continue;
      const hitBy = after.attackers(cell.square, us);
      if (!hitBy.includes(move.to)) continue;
      if (cell.color === them) attacked.push(pieceAt(after, cell.square));
      else defended.push(pieceAt(after, cell.square));
    }
  }
  if (attacked.length) facts.push(`After it, the moved piece attacks ${attacked.join(", ")}.`);
  if (defended.length) facts.push(`After it, the moved piece defends ${defended.join(", ")}.`);
  if (after.isAttacked(move.to, them)) {
    facts.push(`On ${move.to} the moved piece can be captured.`);
  }
  facts.push(`Material before: ${describeMaterial(materialBalance(game))}.`);
  facts.push(`Material after: ${describeMaterial(materialBalance(after))}.`);
  return facts;
}

/** A piece under real attack, and the line the coach gets about it. */
export interface Threat {
  square: Square;
  text: string;
}

/**
 * Pieces under real attack right now, from the rules: attacked and not
 * defended, or attacked by a cheaper piece. Kings in check are not included.
 */
export function threatenedPieces(game: Chess): Threat[] {
  const threats: Threat[] = [];
  for (const row of game.board()) {
    for (const cell of row) {
      if (!cell || cell.type === "k") continue;
      const enemy = cell.color === "w" ? "b" : "w";
      const defended = game.attackers(cell.square, cell.color).length > 0;
      // A king can't take a defended piece, so it only counts against an undefended one.
      const hitBy = game
        .attackers(cell.square, enemy)
        .filter((sq) => !defended || game.get(sq)!.type !== "k");
      if (!hitBy.length) continue;
      const value = VALUE[cell.type as PieceType];
      const cheaper = hitBy.filter((sq) => VALUE[game.get(sq)!.type as PieceType] < value);
      if (defended && !cheaper.length) continue;
      const by = (defended ? cheaper : hitBy).map((sq) => pieceAt(game, sq)).join(", ");
      threats.push({
        square: cell.square,
        text:
          `${pieceAt(game, cell.square)} is attacked by ${by}` +
          (defended ? " (a cheaper piece)." : " and is not defended."),
      });
    }
  }
  return threats;
}

/**
 * Pieces under real attack right now (see threatenedPieces), and a king in
 * check. These are the only threats and weaknesses the coach may talk about.
 */
export function positionFacts(game: Chess): string[] {
  const check = game.inCheck()
    ? [`${game.turn() === "w" ? "White's" : "Black's"} king is in check.`]
    : [];
  return [...check, ...threatenedPieces(game).map((t) => t.text)];
}

/** Material at the end of the engine's line: the outcome it expects. */
export function lineOutcome(game: Chess, sans: string[]): string {
  const end = new Chess(game.fen());
  for (const san of sans) end.move(san);
  const moves = `${sans.length} move${sans.length === 1 ? "" : "s"}`;
  return `After the engine's line (${moves}), ${describeMaterial(materialBalance(end))}.`;
}
