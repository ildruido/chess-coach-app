// The chessboard on screen: lichess's chessground (GPL-3.0-or-later) with the
// cburnett piece set, driven by a GameState. Moves by drag, or by tapping the
// piece and then its square. Pawn promotion asks which piece.
import { Chessground } from "@lichess-org/chessground";
import "@lichess-org/chessground/assets/chessground.base.css";
import "@lichess-org/chessground/assets/chessground.brown.css";
import "@lichess-org/chessground/assets/chessground.cburnett.css";
import type { Api } from "@lichess-org/chessground/api";
import type { Key } from "@lichess-org/chessground/types";
import type { Color, GameState, PromotionPiece } from "../game/game-state";

export interface BoardOptions {
  /** Which colors the person may move: both for pass-and-play, one against the engine. */
  movable: () => Color | "both" | "none";
  /** Called with a legal move the person made (promotion already chosen). */
  onMove: (from: string, to: string, promotion?: PromotionPiece) => void;
  /** Called with a square the person tapped (used by lesson quizzes). */
  onSelect?: (square: string) => void;
}

/** Arrows and circled squares drawn on the board (lessons). */
export interface BoardMarks {
  arrows?: [string, string][];
  marks?: string[];
  /** Circled in green: a right answer. */
  good?: string[];
}

const PROMOTION_CHOICES: { piece: PromotionPiece; name: string }[] = [
  { piece: "q", name: "Queen" },
  { piece: "r", name: "Rook" },
  { piece: "b", name: "Bishop" },
  { piece: "n", name: "Knight" },
];

export class BoardView {
  private cg: Api;
  private orientation: Color = "white";

  constructor(
    private readonly boardEl: HTMLElement,
    private readonly promoEl: HTMLElement,
    private readonly options: BoardOptions,
  ) {
    this.cg = Chessground(boardEl, {
      coordinates: true,
      animation: { enabled: true, duration: 180 },
      highlight: { lastMove: true, check: true },
      premovable: { enabled: false },
      drawable: { enabled: false },
      movable: {
        free: false,
        showDests: true,
        events: { after: (from, to) => this.afterMove(from, to) },
      },
      events: { select: (key) => this.options.onSelect?.(key) },
    });
    // chessground measures where the board is once and reuses that until a
    // scroll or window resize. Anything else that moves the board (web fonts
    // loading, text appearing above it, the board being shown) would make taps
    // land on the wrong square, so re-measure whenever the page layout changes.
    const remeasure = () => this.cg.state.dom.bounds.clear();
    this.layoutObserver = new ResizeObserver(remeasure);
    this.layoutObserver.observe(document.body);
    this.layoutObserver.observe(boardEl);
    void document.fonts?.ready.then(remeasure);
  }

  private readonly layoutObserver: ResizeObserver;

  /** Redraws the board for `game`. Any open promotion question is dropped. */
  sync(game: GameState) {
    this.closePromotion();
    const status = game.status();
    const who = this.options.movable();
    this.cg.set({
      fen: game.fen,
      orientation: this.orientation,
      turnColor: game.turn,
      lastMove: game.lastMove as Key[] | undefined,
      check: status.kind === "playing" && status.inCheck ? game.turn : false,
      movable: {
        color: who === "none" ? undefined : who,
        dests: who === "none" ? new Map() : (game.dests() as Map<Key, Key[]>),
      },
    });
    this.currentGame = game;
  }

  /** Draws lesson arrows and marked squares; called with nothing, clears them. */
  setMarks(m: BoardMarks = {}) {
    this.cg.setAutoShapes([
      ...(m.arrows ?? []).map(([from, to]) => ({
        orig: from as Key,
        dest: to as Key,
        brush: "blue",
      })),
      ...(m.marks ?? []).map((sq) => ({ orig: sq as Key, brush: "yellow" })),
      ...(m.good ?? []).map((sq) => ({ orig: sq as Key, brush: "green" })),
    ]);
  }

  /** Redraws from scratch: needed after the board was laid out while hidden. */
  redraw() {
    this.cg.redrawAll();
  }

  flip() {
    this.orientation = this.orientation === "white" ? "black" : "white";
    this.cg.set({ orientation: this.orientation });
  }

  setOrientation(color: Color) {
    this.orientation = color;
    this.cg.set({ orientation: color });
  }

  destroy() {
    this.layoutObserver.disconnect();
    this.closePromotion();
    this.cg.destroy();
  }

  private currentGame: GameState | null = null;
  private onPromoKey: ((e: KeyboardEvent) => void) | null = null;

  private afterMove(from: string, to: string) {
    const game = this.currentGame;
    if (game?.isPromotion(from, to)) {
      this.askPromotion(from, to);
      return;
    }
    this.options.onMove(from, to);
  }

  private closePromotion() {
    if (this.onPromoKey) document.removeEventListener("keydown", this.onPromoKey);
    this.onPromoKey = null;
    const hadFocus = this.promoEl.contains(document.activeElement);
    this.promoEl.hidden = true;
    this.promoEl.replaceChildren();
    if (hadFocus) this.boardEl.focus();
  }

  /**
   * A small modal: four pieces and Cancel. Escape cancels, Tab stays inside,
   * and focus returns to the board afterwards. Cancel puts the pawn back.
   */
  private askPromotion(from: string, to: string) {
    this.closePromotion();
    const label = document.createElement("p");
    label.textContent = "Promote the pawn to:";
    this.promoEl.append(label);
    const done = (piece?: PromotionPiece) => {
      this.closePromotion();
      if (piece) this.options.onMove(from, to, piece);
      else if (this.currentGame) this.sync(this.currentGame);
    };
    const buttons: HTMLButtonElement[] = [];
    for (const { piece, name } of PROMOTION_CHOICES) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = name;
      b.addEventListener("click", () => done(piece));
      buttons.push(b);
    }
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => done());
    buttons.push(cancel);
    this.promoEl.append(...buttons);
    this.onPromoKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        done();
      } else if (e.key === "Tab") {
        const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          i < 0
            ? e.shiftKey
              ? buttons.length - 1
              : 0
            : (i + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
        e.preventDefault();
        buttons[next]!.focus();
      }
    };
    // On the document, so Escape and Tab work wherever focus has wandered.
    document.addEventListener("keydown", this.onPromoKey);
    this.promoEl.hidden = false;
    buttons[0]!.focus();
  }
}
