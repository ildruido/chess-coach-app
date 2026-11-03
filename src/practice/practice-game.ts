// A practice game: the player against the engine at a chosen level.
// Rules come from GameState; this adds who plays which side, resigning, and
// taking back a whole turn. No DOM, unit tested.
import { type Color, GameState, type GameStatus, statusText } from "../game/game-state";
import { type Level, levelById } from "../engine/strength";
import type { HintStage } from "../coach/hint";
import type { HintMode } from "../coach/hint-session";
import {
  type HintRecord,
  MAX_HINTS,
  type SavedGame,
  newGameId,
  newSavedGame,
  withMoves,
} from "../storage/saved-game";

export type ColorChoice = Color | "random";
/** How a finished game ended, from the player's side. */
export type Outcome = "win" | "loss" | "draw";

/**
 * Games saved before the mode was fixed at the start (v0.3.0): the mode of
 * the last hint used, else the toggle as it was last set on this device.
 */
export function legacyHintMode(hints: readonly HintRecord[], lastSet: HintMode = "tell"): HintMode {
  return hints.at(-1)?.mode ?? lastSet;
}

export class PracticeGame {
  readonly game: GameState;
  resigned = false;
  /** Hints used in this game, in order. */
  hints: HintRecord[] = [];

  /** Steps already given in the current position (the latest hints, if they belong to it). */
  hintsHere(): HintStage[] {
    const ply = this.game.moves.length;
    const steps: HintStage[] = [];
    for (let i = this.hints.length - 1; i >= 0 && this.hints[i]!.ply === ply; i--) {
      steps.unshift(this.hints[i]!.step);
    }
    return steps;
  }

  constructor(
    readonly level: Level,
    readonly playerColor: Color,
    /** Tell me or Ask me: chosen at the start, fixed for the whole game. */
    readonly hintMode: HintMode = "tell",
    moves: string[] = [],
    private saved: SavedGame = { ...newSavedGame(new Date()), id: newGameId() },
  ) {
    this.game = new GameState(moves);
    // Games saved before CC-015 get an id when they resume.
    if (!this.saved.id) this.saved = { ...this.saved, id: newGameId() };
  }

  /** Stable for the whole game: its document id in the history. */
  get id(): string {
    return this.saved.id!;
  }

  /** When the game started (ISO). */
  get createdAt(): string {
    return this.saved.createdAt;
  }

  static start(
    levelId: number,
    choice: ColorChoice,
    hintMode: HintMode = "tell",
    rng: () => number = Math.random,
  ) {
    const color: Color = choice === "random" ? (rng() < 0.5 ? "white" : "black") : choice;
    return new PracticeGame(levelById(levelId), color, hintMode);
  }

  /**
   * Rebuilds a saved practice game; null if it isn't one. `lastSet` is the
   * hint mode last set on this device, for games saved before CC-017.
   */
  static fromSaved(saved: SavedGame, lastSet: HintMode = "tell"): PracticeGame | null {
    if (saved.level === undefined || saved.color === undefined) return null;
    const mode = saved.hintMode ?? legacyHintMode(saved.hints ?? [], lastSet);
    const p = new PracticeGame(levelById(saved.level), saved.color, mode, saved.moves, saved);
    p.resigned = saved.resigned ?? false;
    p.hints = [...(saved.hints ?? [])];
    return p;
  }

  toSaved(now: Date = new Date()): SavedGame {
    this.saved = {
      ...withMoves(this.saved, [...this.game.moves], now),
      level: this.level.id,
      color: this.playerColor,
      resigned: this.resigned,
      hints: [...this.hints],
      hintMode: this.hintMode,
    };
    return this.saved;
  }

  /** How the game ended for the player; null while it is still being played. */
  get outcome(): Outcome | null {
    if (this.resigned) return "loss";
    const s = this.game.status();
    if (s.kind === "playing") return null;
    if (s.kind === "checkmate") return s.winner === this.playerColor ? "win" : "loss";
    return "draw";
  }

  /** The player has made at least one move. */
  get playerMoved(): boolean {
    return this.game.moves.length > (this.playerColor === "white" ? 0 : 1);
  }

  get engineColor(): Color {
    return this.playerColor === "white" ? "black" : "white";
  }

  get isOver(): boolean {
    return this.resigned || this.game.status().kind !== "playing";
  }

  get isPlayerTurn(): boolean {
    return !this.isOver && this.game.turn === this.playerColor;
  }

  get needsEngineMove(): boolean {
    return !this.isOver && this.game.turn === this.engineColor;
  }

  /** Records a hint given in the current position, in the game's mode. */
  recordHint(step: HintStage) {
    this.hints.push({ ply: this.game.moves.length, step, mode: this.hintMode });
    if (this.hints.length > MAX_HINTS) this.hints.splice(0, this.hints.length - MAX_HINTS);
  }

  resign() {
    if (!this.isOver) this.resigned = true;
  }

  /**
   * Takes back the player's last move (and the engine's reply to it), so it is
   * the player's turn again. Also undoes a resignation. Returns false when
   * there is nothing of the player's to take back.
   */
  takeBack(): boolean {
    if (this.resigned) {
      this.resigned = false;
      return true;
    }
    if (!this.canTakeBack) return false;
    const before = this.game.moves.length;
    if (this.game.turn === this.playerColor) this.game.undo(); // the engine's reply
    if (this.game.turn === this.engineColor) {
      // Can't undo past the engine's first move when the player is Black.
      if (this.game.moves.length === 0) return before !== this.game.moves.length;
      this.game.undo(); // the player's move
    }
    return this.game.moves.length !== before;
  }

  /** Whether there is a player move to take back. */
  get canTakeBack(): boolean {
    if (this.resigned) return true;
    const playerMoves =
      this.playerColor === "white"
        ? Math.ceil(this.game.moves.length / 2)
        : Math.floor(this.game.moves.length / 2);
    return playerMoves > 0;
  }

  /** One line for the status: whose turn, or how the game ended, from the player's side. */
  statusLine(): string {
    if (this.resigned) return "You resigned. The engine wins.";
    const s: GameStatus = this.game.status();
    if (s.kind === "checkmate") {
      return s.winner === this.playerColor ? "Checkmate. You win!" : "Checkmate. The engine wins.";
    }
    if (s.kind !== "playing") return statusText(s);
    if (s.turn === this.playerColor)
      return s.inCheck ? "Your move. You're in check!" : "Your move.";
    return "The engine is thinking…";
  }
}
