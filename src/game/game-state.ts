// The rules side of a game on the board: legal moves, promotion, game end and
// the move list. Wraps chess.js; no DOM, unit tested.
import { Chess } from "chess.js";
import { gameAt, movesSoFar } from "../chess/notation";

export type Color = "white" | "black";
export type PromotionPiece = "q" | "r" | "b" | "n";

export type GameStatus =
  | { kind: "playing"; turn: Color; inCheck: boolean }
  | { kind: "checkmate"; winner: Color }
  | { kind: "stalemate" | "threefold" | "fifty-moves" | "insufficient-material" };

export type MoveResult =
  | { ok: true; san: string; uci: string }
  | { ok: false; reason: "illegal" | "needs-promotion" | "game-over" };

const colorOf = (c: "w" | "b"): Color => (c === "w" ? "white" : "black");

export class GameState {
  private chess: Chess;

  /**
   * Starts from the initial position (or `startFen`, e.g. a lesson position)
   * and replays saved UCI moves. Throws on an illegal move: validate saved
   * games first (parseSavedGame does).
   */
  constructor(
    private uciMoves: string[] = [],
    private readonly startFen?: string,
  ) {
    this.chess = gameAt({ fen: startFen, moves: uciMoves });
  }

  get moves(): readonly string[] {
    return this.uciMoves;
  }

  get fen(): string {
    return this.chess.fen();
  }

  get turn(): Color {
    return colorOf(this.chess.turn());
  }

  /** Last move as [from, to], for highlighting. */
  get lastMove(): [string, string] | undefined {
    const m = this.uciMoves.at(-1);
    return m ? [m.slice(0, 2), m.slice(2, 4)] : undefined;
  }

  /** Every legal destination per origin square, for the board. */
  dests(): Map<string, string[]> {
    const map = new Map<string, string[]>();
    if (this.chess.isGameOver()) return map;
    for (const m of this.chess.moves({ verbose: true })) {
      map.set(m.from, [...(map.get(m.from) ?? []), m.to]);
    }
    return map;
  }

  /** True when moving from → to is a pawn reaching the last rank. */
  isPromotion(from: string, to: string): boolean {
    return this.chess
      .moves({ verbose: true })
      .some((m) => m.from === from && m.to === to && !!m.promotion);
  }

  play(from: string, to: string, promotion?: PromotionPiece): MoveResult {
    if (this.chess.isGameOver()) return { ok: false, reason: "game-over" };
    if (this.isPromotion(from, to) && !promotion) return { ok: false, reason: "needs-promotion" };
    try {
      const m = this.chess.move({ from, to, promotion });
      const uci = m.from + m.to + (m.promotion ?? "");
      this.uciMoves = [...this.uciMoves, uci];
      return { ok: true, san: m.san, uci };
    } catch {
      return { ok: false, reason: "illegal" };
    }
  }

  /** Takes back the last move. Returns false when there is none. */
  undo(): boolean {
    if (!this.uciMoves.length) return false;
    this.uciMoves = this.uciMoves.slice(0, -1);
    this.chess = gameAt({ fen: this.startFen, moves: this.uciMoves });
    return true;
  }

  status(): GameStatus {
    const c = this.chess;
    if (c.isCheckmate())
      return { kind: "checkmate", winner: this.turn === "white" ? "black" : "white" };
    if (c.isStalemate()) return { kind: "stalemate" };
    if (c.isThreefoldRepetition()) return { kind: "threefold" };
    if (c.isInsufficientMaterial()) return { kind: "insufficient-material" };
    if (c.isDrawByFiftyMoves()) return { kind: "fifty-moves" };
    return { kind: "playing", turn: this.turn, inCheck: c.inCheck() };
  }

  /** "1. e4 e5 2. Nf3" */
  moveList(): string {
    return movesSoFar(this.chess);
  }
}

const cap = (c: Color) => (c === "white" ? "White" : "Black");

export function statusText(s: GameStatus): string {
  switch (s.kind) {
    case "playing":
      return `${cap(s.turn)} to move${s.inCheck ? " — check!" : "."}`;
    case "checkmate":
      return `Checkmate. ${cap(s.winner)} wins.`;
    case "stalemate":
      return "Stalemate: no legal moves, but no check. The game is a draw.";
    case "threefold":
      return "Draw by repetition: the same position appeared three times.";
    case "fifty-moves":
      return "Draw by the 50-move rule: 50 moves each without a capture or pawn move.";
    case "insufficient-material":
      return "Draw: neither side has enough pieces left to checkmate.";
  }
}
