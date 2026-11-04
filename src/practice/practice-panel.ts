// The Practice screen: pick a level, a color and the hint mode, then play a full game
// against the engine. The coach stays silent unless asked for a hint. The
// game in progress (with the hints used) is saved after every move and
// resumed after a reload. Every finished game goes to the history (Past games).
import { BoardView } from "../board/board-view";
import { openingFor } from "../openings/opening-name";
import { levelMove } from "../engine/play";
import type { StockfishEngine } from "../engine/stockfish";
import { LEVELS } from "../engine/strength";
import {
  type GameStore,
  isTerminalStoreError,
  loadErrorText,
  openGameStore,
  saveErrorText,
} from "../storage/game-store";
import type { PromotionPiece } from "../game/game-state";
import { mountCommentaryPanel } from "./commentary-panel";
import { mountHintPanel } from "./hint-panel";
import { mountHistoryPanel } from "./history-panel";
import { mountVoicePanel } from "./voice-panel";
import { mountReviewPanel, practiceSubject } from "./review-panel";
import { type HistoryRecord, historyRecord } from "../storage/history";
import type { HintMode } from "../coach/hint-session";
import { type ColorChoice, PracticeGame } from "./practice-game";
import { say, stopReading } from "../voice/read-aloud";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
/** The last hint mode a game started with: the next game's setup starts from it. */
const MODE_KEY = "chess-coach.hint-mode";

/** The setup the last game started with (level, colour, hints): the next visit opens straight into a game. */
const SETUP_KEY = "chess-coach.practice-setup";
interface RememberedSetup {
  level: number;
  color: ColorChoice;
  hints: HintMode;
}

function readSetup(): RememberedSetup | null {
  try {
    const v = JSON.parse(localStorage.getItem(SETUP_KEY) ?? "null") as Partial<RememberedSetup>;
    const level = Number(v?.level);
    if (!LEVELS.some((l) => l.id === level)) return null;
    const color = v?.color === "black" || v?.color === "random" ? v.color : "white";
    return { level, color, hints: v?.hints === "ask" ? "ask" : "tell" };
  } catch {
    return null;
  }
}

/** Shows `mode` in the setup and remembers it for the next game on this device. */
function rememberHintMode(setup: HTMLFormElement, mode: HintMode) {
  for (const i of setup.querySelectorAll<HTMLInputElement>('input[name="practice-hint-mode"]')) {
    i.checked = i.value === mode;
  }
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Only a convenience: the setup then starts from Tell me.
  }
}

export function mountPracticePanel(engine: StockfishEngine) {
  const setup = $<HTMLFormElement>("practice-setup");
  const levelSelect = $<HTMLSelectElement>("practice-level");
  const levelBlurb = $<HTMLParagraphElement>("practice-level-blurb");
  const playArea = $<HTMLDivElement>("practice-play");
  const status = $<HTMLParagraphElement>("practice-status");
  const info = $<HTMLParagraphElement>("practice-info");
  const movesEl = $<HTMLParagraphElement>("practice-moves");
  const openingEl = $<HTMLParagraphElement>("practice-opening");
  const saveNote = $<HTMLParagraphElement>("practice-save");
  const takeBackBtn = $<HTMLButtonElement>("practice-takeback");
  const resignBtn = $<HTMLButtonElement>("practice-resign");
  const newBtn = $<HTMLButtonElement>("practice-new");

  let practice: PracticeGame | null = null;
  let thinking = false;
  /** Bumped on new game / take back, so a late engine reply is ignored. */
  let generation = 0;
  let store: GameStore | null = null;
  let saving: Promise<void> = Promise.resolve();
  /** Shown instead of the status when the engine fails; Try again clears it. */
  let engineError: string | null = null;
  const retryBtn = $<HTMLButtonElement>("practice-retry");

  for (const level of LEVELS) {
    const opt = document.createElement("option");
    opt.value = String(level.id);
    opt.textContent = `${level.id}. ${level.name}`;
    levelSelect.append(opt);
  }
  const showBlurb = () => {
    levelBlurb.textContent = LEVELS.find((l) => String(l.id) === levelSelect.value)?.blurb ?? "";
  };
  levelSelect.addEventListener("change", showBlurb);
  showBlurb();
  let lastSet: HintMode = "tell";
  try {
    if (localStorage.getItem(MODE_KEY) === "ask") lastSet = "ask";
  } catch {
    // Storage may be blocked; the setup starts from Tell me.
  }
  // Always set, so a browser restoring the form can't show an unstarted choice.
  for (const i of setup.querySelectorAll<HTMLInputElement>('input[name="practice-hint-mode"]')) {
    i.checked = i.value === lastSet;
  }

  const remembered = readSetup();
  if (remembered) {
    levelSelect.value = String(remembered.level);
    showBlurb();
    for (const i of setup.querySelectorAll<HTMLInputElement>('input[name="practice-color"]')) {
      i.checked = i.value === remembered.color;
    }
  }

  /** Ale's move, dragged on the board or confirmed by voice. False when it isn't allowed. */
  function playerMove(from: string, to: string, promotion?: PromotionPiece): boolean {
    if (!practice || !practice.isPlayerTurn || thinking) return false;
    const r = practice.game.play(from, to, promotion);
    if (r.ok) stopReading();
    render();
    if (!r.ok) {
      status.textContent = "That move isn't allowed.";
      return false;
    }
    persist();
    const ply = practice.game.moves.length - 1;
    // The engine's reply is asked for first; the comment never holds it up.
    void engineTurn();
    commentary.moved(practice, ply);
    return true;
  }

  const view = new BoardView($("practice-board"), $("practice-promotion"), {
    movable: () => (practice && practice.isPlayerTurn && !thinking ? practice.playerColor : "none"),
    onMove: (from, to, promotion) => void playerMove(from, to, promotion),
  });

  const commentary = mountCommentaryPanel(engine, { practice: () => practice });
  const history = mountHistoryPanel(engine, (text) => {
    saveNote.textContent = text;
  });
  /** The finished game last recorded in the history (once per ending), and its record. */
  let recordedKey = "";
  let recorded: HistoryRecord | null = null;
  const review = mountReviewPanel(engine, $("review"), {
    subject: () => practiceSubject(practice),
    say,
    stopReading,
    onReviewed: (key, r) => {
      if (!recorded || key !== recordedKey) return;
      // Keeps the date the game ended, not the date of the review.
      recorded = { ...recorded, review: r };
      history.record(recorded);
    },
  });
  const hints = mountHintPanel(engine, {
    practice: () => practice,
    engineBusy: () => thinking,
    onHintUsed: () => persist(),
  });

  const voice = mountVoicePanel(engine, {
    practice: () => practice,
    engineBusy: () => thinking,
    playMove: (from, to, promotion) =>
      playerMove(from, to, promotion as PromotionPiece | undefined),
  });

  function render() {
    const p = practice;
    voice.sync();
    setup.hidden = !!p;
    playArea.hidden = !p;
    hints.update();
    commentary.sync();
    review.sync();
    history.setVisible(!p);
    if (!p) return;
    view.sync(p.game);
    status.textContent = engineError ?? p.statusLine();
    status.dataset.tone = engineError ? "warn" : p.isOver ? "ok" : "info";
    retryBtn.hidden = !engineError;
    status.dataset.over = String(p.isOver);
    const modeName = p.hintMode === "ask" ? "Ask me" : "Tell me";
    info.textContent = `Level ${p.level.id}, ${p.level.name}. You play ${p.playerColor}. Hints: ${modeName}.`;
    movesEl.textContent = p.game.moveList();
    movesEl.dataset.count = String(p.game.moves.length);
    const opening = openingFor(p.game.moves);
    openingEl.hidden = !opening;
    openingEl.textContent = opening ? `Opening: ${opening.name} (${opening.eco})` : "";
    takeBackBtn.disabled = thinking || !p.canTakeBack;
    resignBtn.disabled = thinking || p.isOver;
  }

  /**
   * Adds a game that has just ended to the history, once per ending. Ending it
   * again after a take back replaces the record (and its review).
   */
  function recordFinished(p: PracticeGame) {
    const subject = practiceSubject(p);
    if (!subject || subject.key === recordedKey) return;
    recordedKey = subject.key;
    recorded = historyRecord(p);
    if (recorded) history.record(recorded);
  }

  /** Saves in order after each change; a permanent error turns saving off. */
  function persist() {
    const p = practice;
    if (p) recordFinished(p);
    const s = store;
    if (!s || !p) return;
    const snapshot = p.toSaved();
    saving = saving.then(async () => {
      if (store !== s) return;
      try {
        await s.save(snapshot);
        saveNote.textContent = "Saved to your account.";
      } catch (err) {
        if (store !== s) return;
        if (isTerminalStoreError(err)) store = null;
        saveNote.textContent = saveErrorText(err);
      }
    });
  }

  async function engineTurn() {
    const p = practice;
    if (!p || !p.needsEngineMove || thinking) return;
    const gen = generation;
    thinking = true;
    engineError = null;
    render();
    try {
      const { move } = await levelMove(engine, { moves: [...p.game.moves] }, p.level);
      if (gen !== generation || practice !== p) return;
      const r = move
        ? p.game.play(move.slice(0, 2), move.slice(2, 4), move[4] as PromotionPiece | undefined)
        : null;
      if (!r?.ok) throw new Error("the engine didn't find a move.");
      persist();
    } catch (err) {
      if (gen === generation) engineError = `The engine stopped: ${(err as Error).message}`;
    } finally {
      if (gen === generation) {
        thinking = false;
        render();
      }
    }
  }

  /** Starts a game from what the setup shows; remembers it so the next visit needs no click. */
  function startGame(focusBoard: boolean) {
    const form = new FormData(setup);
    const choice = (form.get("practice-color") ?? "white") as ColorChoice;
    const hintMode: HintMode = form.get("practice-hint-mode") === "ask" ? "ask" : "tell";
    rememberHintMode(setup, hintMode);
    try {
      const setupNow: RememberedSetup = {
        level: Number(levelSelect.value),
        color: choice,
        hints: hintMode,
      };
      localStorage.setItem(SETUP_KEY, JSON.stringify(setupNow));
    } catch {
      // Only a convenience: the next visit then shows the setup.
    }
    generation++;
    thinking = false;
    engineError = null;
    practice = PracticeGame.start(Number(levelSelect.value), choice, hintMode);
    view.setOrientation(practice.playerColor);
    render();
    persist();
    void engineTurn();
    // The Start button is gone: keep the reading position on the board.
    if (focusBoard) $("practice-board").focus();
  }

  setup.addEventListener("submit", (e) => {
    e.preventDefault();
    startGame(true);
  });

  takeBackBtn.addEventListener("click", () => {
    if (!practice || thinking) return;
    stopReading();
    if (practice.takeBack()) {
      generation++;
      engineError = null;
      render();
      persist();
      void engineTurn(); // only acts if the engine is to move (e.g. after undoing a resignation)
    }
  });

  resignBtn.addEventListener("click", () => {
    if (!practice || thinking) return;
    stopReading();
    practice.resign();
    engineError = null;
    render();
    persist();
  });

  newBtn.addEventListener("click", () => {
    stopReading();
    // Leaving a game counts as resigning it, so a reload won't bring it back. One with no move
    // of yours yet never reaches Past games (practiceSubject is null until you move).
    if (practice && !practice.isOver) {
      practice.resign();
      persist();
    }
    generation++;
    thinking = false;
    engineError = null;
    practice = null;
    render();
    levelSelect.focus();
  });

  retryBtn.addEventListener("click", () => void engineTurn());

  $("practice-flip").addEventListener("click", () => view.flip());

  render();

  // Resume a saved practice game, if there is one.
  void (async () => {
    const opened = await openGameStore("practice-game");
    if (!opened.ok) {
      saveNote.textContent = "Games aren't saved in this view.";
      return;
    }
    try {
      const loaded = await opened.store.load();
      store = opened.store;
      if (loaded.status === "ok" && !practice) {
        const resumed = PracticeGame.fromSaved(loaded.game, lastSet);
        if (resumed && !resumed.isOver) {
          practice = resumed;
          rememberHintMode(setup, resumed.hintMode);
          view.setOrientation(resumed.playerColor);
          render();
          saveNote.textContent = "Resumed your saved game.";
          void engineTurn();
          return;
        }
      }
      saveNote.textContent = "Games are saved to your account as you play.";
    } catch (err) {
      saveNote.textContent = loadErrorText(err);
    }
    // A player who has set up a game before lands straight in a new one.
    if (!practice && readSetup()) startGame(false);
  })();
}
