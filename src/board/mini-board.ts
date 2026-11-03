// A small view-only board for the post-game review (a position, with arrows
// for the move played and the better one) and for replaying a saved game.
// Same chessground and pieces as the main board.
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { DrawShape } from "@lichess-org/chessground/draw";
import type { Key } from "@lichess-org/chessground/types";
import type { Color } from "../game/game-state";

export interface MiniBoardArrow {
  uci: string;
  /** Chessground's brushes: red for the move played, green for the better one. */
  brush: "red" | "green" | "blue";
}

export interface MiniBoard {
  /** Shows another position, with its last move highlighted. */
  show(fen: string, lastMove?: [string, string]): void;
  destroy(): void;
}

/** Draws the board into `el`, which must already be visible (chessground measures it). */
export function mountMiniBoard(
  el: HTMLElement,
  fen: string,
  orientation: Color,
  arrows: MiniBoardArrow[],
): MiniBoard {
  const shapes: DrawShape[] = arrows.map((a) => ({
    orig: a.uci.slice(0, 2) as Key,
    dest: a.uci.slice(2, 4) as Key,
    brush: a.brush,
  }));
  const cg: Api = Chessground(el, {
    fen,
    orientation,
    viewOnly: true,
    coordinates: false,
    animation: { enabled: false },
    drawable: { enabled: false, visible: true, autoShapes: shapes },
  });
  // Pieces are placed from the board's measured size: redraw when it changes.
  const observer = new ResizeObserver(() => cg.redrawAll());
  observer.observe(el);
  return {
    show(next, lastMove) {
      cg.set({ fen: next, lastMove: lastMove as Key[] | undefined });
    },
    destroy() {
      observer.disconnect();
      cg.destroy();
    },
  };
}
