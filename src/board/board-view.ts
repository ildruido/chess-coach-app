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
import { announceMove, describeBoard, parseTypedMove } from "./board-a11y";

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
    this.mountTools();
  }

  // Keyboard and screen-reader access (CC-074): the board itself can only be dragged or tapped,
  // so under it sit a box to type a move, a spoken-style readout, and a live line that says
  // every move in words.
  private announceEl!: HTMLElement;
  private typedStatus!: HTMLElement;
  private typedInput!: HTMLInputElement;
  private readoutEl!: HTMLElement;
  private prevFen: string | null = null;
  private prevPly = 0;

  private mountTools() {
    const id = this.boardEl.id;
    const tools = document.createElement("div");
    tools.className = "board-tools";
    tools.innerHTML = `
      <div class="sr-only" id="${id}-announce" role="status" aria-live="polite" aria-atomic="true"></div>
      <form id="${id}-typed-form" autocomplete="off">
        <div class="field">
          <label for="${id}-typed">Type a move</label>
          <input id="${id}-typed" type="text" inputmode="text" enterkeyhint="go"
            autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="12"
            aria-describedby="${id}-typed-hint ${id}-typed-status" />
        </div>
        <button type="submit" class="secondary">Move</button>
        <button type="button" class="secondary" id="${id}-read">Read the board</button>
      </form>
      <p id="${id}-typed-hint" class="mode-note">For example e4, Nf3, O-O or e2e4.</p>
      <p id="${id}-typed-status" class="status" role="status"></p>
      <p id="${id}-readout" class="board-readout" tabindex="-1" hidden></p>`;
    (this.boardEl.closest(".board-wrap") ?? this.boardEl).after(tools);
    const q = <T extends HTMLElement>(suffix: string) =>
      tools.querySelector<T>(`#${id}-${suffix}`)!;
    this.announceEl = q("announce");
    this.typedStatus = q("typed-status");
    this.typedInput = q<HTMLInputElement>("typed");
    const readout = q("readout");
    this.readoutEl = readout;
    q("typed-form").addEventListener("submit", (e) => {
      e.preventDefault();
      this.submitTyped();
    });
    q("read").addEventListener("click", () => {
      readout.textContent = this.currentGame
        ? describeBoard(this.currentGame.fen)
        : "There is no board to read yet.";
      readout.hidden = false;
      readout.focus();
    });
  }

  /** Says `text` through the live region (a repeated line is still read out again). */
  announce(text: string) {
    this.announceEl.textContent = "";
    requestAnimationFrame(() => (this.announceEl.textContent = text));
  }

  private typedMessage(text: string) {
    this.typedStatus.textContent = text;
  }

  private submitTyped() {
    const game = this.currentGame;
    const text = this.typedInput.value;
    if (!game) return this.typedMessage("There is no game to move in yet.");
    const who = this.options.movable();
    const mine = who === "both" || who === game.turn;
    if (!mine) {
      // A quiz asks for a square: typing one answers it, like tapping.
      const square = text.trim().toLowerCase();
      if (this.options.onSelect && /^[a-h][1-8]$/.test(square)) {
        this.typedInput.value = "";
        this.typedMessage("");
        this.options.onSelect(square);
        return;
      }
      return this.typedMessage(
        this.options.onSelect
          ? "Type the square you choose, for example e4."
          : "It isn't your move right now.",
      );
    }
    const r = parseTypedMove(game.fen, text);
    if (!r.ok) return this.typedMessage(r.reason);
    const { from, to, promotion } = r.move;
    this.typedInput.value = "";
    this.typedMessage("");
    if (game.isPromotion(from, to) && !promotion) return this.askPromotion(from, to);
    this.options.onMove(from, to, promotion);
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
    this.readoutEl.hidden = true; // its text would be stale after a move
    // Every move, yours or the engine's, is said once in words.
    const ply = game.moves.length;
    const last = game.lastMove;
    if (this.prevFen && this.prevFen !== game.fen && ply === this.prevPly + 1 && last) {
      const text = announceMove(this.prevFen, game.fen, last[0], last[1]);
      if (text) this.announce(text);
    }
    this.prevFen = game.fen;
    this.prevPly = ply;
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
