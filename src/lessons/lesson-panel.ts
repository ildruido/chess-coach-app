// The Lessons screen: a list of lessons, and the player that walks through a
// lesson's steps on the board. Lesson text is written in advance; the engine
// checks every exercise move before it is played (the safety net). The coach
// is only asked on a click (quick tier): "Why?" after a warning, and the Ask
// the coach area under every step (ask-panel.ts).

import { BoardView } from "../board/board-view";
import { gameAt, uciLineToSan } from "../chess/notation";
import { getSample } from "../claude";
import { buildFacts, engineHint, type EngineFacts, type HintStage } from "../coach/hint";
import { isUsageLimit, usageGuard } from "../coach/usage";
import { buttonLabel, type HintMode, hintOptions } from "../coach/hint-session";
import type { StockfishEngine } from "../engine/stockfish";
import { GameState, type PromotionPiece } from "../game/game-state";
import type { Puzzle } from "../puzzles/puzzles";
import { type LessonStore, openLessonStore } from "../storage/lesson-store";
import { saveErrorText, storeUnavailableText } from "../storage/game-store";
import { coachErrorText, textMoves } from "./ask";
import type { AskPlace } from "../kb/contexts";
import { type AskView, mountAskPanel } from "./ask-panel";
import { mountLessonVoice } from "./voice-panel";
import { exercisesById, pickExercises } from "./exercises";
import { LESSON_GROUPS, LESSONS, PATH } from "./catalog";
import type { HistoryRecord } from "../storage/history";
import { buildAdvice } from "./suggest";
import { continueTarget, doneCount, lessonStatus, nextOnPath } from "./lesson-list";
import { type Lesson, type Step, textParts } from "./lesson";
import {
  type ExerciseResult,
  isFinished,
  type LessonProgress,
  newProgress,
  scoreText,
} from "./progress";
import {
  development,
  developText,
  goalMet,
  judgePlay,
  leftBookText,
  positionName,
} from "./play-out";
import { isAnswer, judgeMiss, judgeSafe } from "./safety-net";
import { acceptWhy, type WhyFacts } from "./why";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Time the engine gets to check a move or prepare a hint, as for practice hints. */
const CHECK_MS = 1000;
const REPLY_DELAY_MS = 450;
const COMMENTARY_KEY = "chess-coach.lesson-commentary";
const VIEW_KEY = "chess-coach.lesson-view";
const PIECE_NAMES: Record<string, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

/** Fills an element with lesson text, {references} in bold. */
function setText(el: HTMLElement, text: string) {
  el.replaceChildren(
    ...textParts(text).map((p) => {
      if (!p.ref) return document.createTextNode(p.text);
      const b = document.createElement("strong");
      b.className = "notation";
      b.textContent = p.text;
      return b;
    }),
  );
}

/** What to say when the Why? call fails, by sample error code. Never retried automatically. */
const whyErrorText = (code: string | undefined) =>
  coachErrorText(code, "The warning above says what goes wrong.");

function uciOf(from: string, to: string, promotion?: PromotionPiece) {
  return from + to + (promotion ?? "");
}

export function mountLessonPanel(
  engine: StockfishEngine,
  loadHistory: () => Promise<HistoryRecord[]> = async () => [],
) {
  const list = $<HTMLDivElement>("lesson-list");
  const playArea = $<HTMLDivElement>("lesson-play");
  const end = $<HTMLDivElement>("lesson-end");
  const saveNote = $<HTMLParagraphElement>("lesson-save");
  const where = $<HTMLParagraphElement>("lesson-where");
  const titleEl = $<HTMLHeadingElement>("lesson-title");
  const textEl = $<HTMLParagraphElement>("lesson-text");
  const banner = $<HTMLDivElement>("lesson-banner");
  const bannerText = $<HTMLParagraphElement>("lesson-banner-text");
  const tryBtn = $<HTMLButtonElement>("lesson-try");
  const whyBtn = $<HTMLButtonElement>("lesson-why");
  const anywayBtn = $<HTMLButtonElement>("lesson-anyway");
  const whyText = $<HTMLParagraphElement>("lesson-why-text");
  const backBtn = $<HTMLButtonElement>("lesson-back");
  const nextBtn = $<HTMLButtonElement>("lesson-next");
  const skipBtn = $<HTMLButtonElement>("lesson-skip");
  const leaveBtn = $<HTMLButtonElement>("lesson-leave");
  const coach = $<HTMLElement>("lesson-coach");
  const modeSet = $<HTMLFieldSetElement>("lesson-hint-mode");
  const hintBtn = $<HTMLButtonElement>("lesson-hint");
  const anotherBtn = $<HTMLButtonElement>("lesson-hint-another");
  const hintStatus = $<HTMLParagraphElement>("lesson-hint-status");
  const hintLog = $<HTMLOListElement>("lesson-hint-log");
  const commentToggle = $<HTMLInputElement>("lesson-commentary");
  const commentLog = $<HTMLOListElement>("lesson-comment-log");

  // A coach answer while an exercise is open counts as help, like a hint.
  const ask = mountAskPanel(engine, setText, (ctx) => {
    if (ctx.kind === "exercise" && ctx.secret && !solved) helped = true;
  });

  let store: LessonStore | null = null;
  let storeReady: Promise<void> | null = null;
  const saved = new Map<string, LessonProgress>();

  let lesson: Lesson | null = null;
  let progress: LessonProgress | null = null;
  /** Show steps: how many of the line's moves have been played. */
  let shown = 0;
  /** Quiz steps: answered right. */
  let quizDone = false;

  // The current exercise.
  let puzzles: Puzzle[] = [];
  /** Index of the exercise on the board (progress.exercise moves on once it has a result). */
  let current = 0;
  let puzzle: Puzzle | null = null;
  let game: GameState | null = null;
  /** Index into the puzzle's solution of the move the player must find next. */
  let ply = 0;
  let solved = false;
  let helped = false;
  let checking = false;
  /** The move the engine is checking: shown on the board meanwhile, so a good move doesn't jump back. */
  let trying: string | null = null;
  /** Bumped whenever the exercise position changes, so late engine answers are dropped. */
  let generation = 0;
  let pending: { uci: string; why: WhyFacts } | null = null;
  /** The player chose "Play it anyway": the exercise waits for Try again. */
  let playedAnyway = false;
  /** The opponent's setup move hasn't been played on the board yet. */
  let settingUp = false;
  /** Drills: the player's move that left the book, shown until it is taken back. */
  let offBook: string | null = null;
  /** Drills: how many hints were given for the current move (the piece, then the move). */
  let drillHints = 0;
  let whyCtl: AbortController | null = null;
  let hintsGiven: HintStage[] = [];
  let hintFacts: { key: string; facts: Promise<EngineFacts> } | null = null;

  /** Ale can move a piece: an exercise is open and nothing is being checked or waiting. */
  function canMoveNow() {
    return !(
      !game ||
      !puzzle ||
      solved ||
      checking ||
      pending ||
      playedAnyway ||
      settingUp ||
      offBook
    );
  }

  const view = new BoardView($("lesson-board"), $("lesson-promotion"), {
    movable: () => (canMoveNow() && game ? game.turn : "none"),
    onMove: (from, to, promotion) => void tryMove(uciOf(from, to, promotion)),
    onSelect: (square) => quizAnswer(square),
  });

  try {
    commentToggle.checked = localStorage.getItem(COMMENTARY_KEY) === "on";
  } catch {
    // Off by default.
  }
  commentToggle.addEventListener("change", () => {
    commentLog.hidden = !commentToggle.checked;
    try {
      localStorage.setItem(COMMENTARY_KEY, commentToggle.checked ? "on" : "off");
    } catch {
      // Only a convenience.
    }
  });
  commentLog.hidden = !commentToggle.checked;

  function comment(text: string) {
    if (!commentToggle.checked) return;
    const li = document.createElement("li");
    li.textContent = text;
    commentLog.append(li);
  }

  // --- Saving ---------------------------------------------------------------

  function connect(): Promise<void> {
    storeReady ??= openLessonStore().then(async (r) => {
      if (!r.ok) {
        saveNote.textContent = storeUnavailableText(r.reason);
        return;
      }
      store = r.store;
      await Promise.all(
        LESSONS.map(async (l) => {
          try {
            const p = await r.store.load(l);
            if (p) saved.set(l.id, p);
          } catch {
            // An unreadable lesson starts from the beginning.
          }
        }),
      );
    });
    return storeReady;
  }

  let saving: Promise<void> = Promise.resolve();
  function persist() {
    if (!progress) return;
    const p = { ...progress, updatedAt: new Date().toISOString() };
    progress = p;
    saved.set(p.lessonId, p);
    if (!store) return;
    const s = store;
    saving = saving.then(async () => {
      try {
        await s.save(p);
        saveNote.textContent = "";
      } catch (err) {
        saveNote.textContent = saveErrorText(err);
        saveNote.dataset.tone = "warn";
      }
    });
  }

  // --- The list ---------------------------------------------------------------

  let loaded = false;

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = "") {
    const e = document.createElement(tag);
    e.className = className;
    e.textContent = text;
    return e;
  }

  function lessonButton(label: string, l: Lesson, named = false) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    // Screen readers hear which lesson each card's button opens.
    if (named) b.setAttribute("aria-label", `${label}: ${l.title}`);
    // Until saved progress has loaded, starting could overwrite it.
    b.disabled = !loaded;
    b.addEventListener("click", () => open(l));
    return b;
  }

  /** "path" = the recommended order, "topic" = grouped by topic. Remembered on this device. */
  let listView: "path" | "topic" = "path";
  try {
    if (localStorage.getItem(VIEW_KEY) === "topic") listView = "topic";
  } catch {
    // Only a convenience.
  }

  function lessonCard(l: Lesson, label: string, next: boolean) {
    const status = lessonStatus(l, saved.get(l.id));
    const li = el("li", "lesson-card");
    li.dataset.state = status.state;
    if (next) li.dataset.next = "true";
    li.append(
      el("p", "lesson-num", next ? `${label} · Next on your path` : label),
      el("h4", "lesson-card-title", l.title),
      el("p", "lesson-summary", l.summary),
      el("p", "status", status.text),
      lessonButton(status.button, l, true),
    );
    return li;
  }

  function viewToggle() {
    const bar = el("div", "lesson-views");
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "Order of the lessons");
    for (const [view, label] of [
      ["path", "Recommended path"],
      ["topic", "By topic"],
    ] as const) {
      const b = el("button", "secondary", label);
      b.type = "button";
      b.id = `lesson-view-${view}`;
      b.setAttribute("aria-pressed", String(listView === view));
      b.addEventListener("click", () => {
        listView = view;
        try {
          localStorage.setItem(VIEW_KEY, view);
        } catch {
          // Only a convenience.
        }
        renderList();
      });
      bar.append(b);
    }
    return bar;
  }

  function renderList() {
    list.setAttribute("aria-busy", String(!loaded));
    const overview = el("div", "lesson-overview");
    const count = el(
      "p",
      "status",
      `${doneCount(LESSONS, saved)} of ${LESSONS.length} lessons done.`,
    );
    count.id = "lesson-count";
    overview.append(count);
    const last = continueTarget(LESSONS, saved);
    if (last) {
      const c = lessonButton(`Continue: ${last.title}`, last);
      c.id = "lesson-continue";
      overview.append(c);
    }
    const next = nextOnPath(PATH, saved);
    const pathStep = (l: Lesson) => `Path step ${PATH.indexOf(l) + 1} of ${PATH.length}`;
    const body: HTMLElement[] = [];
    if (listView === "path") {
      const intro = el(
        "p",
        "status",
        next
          ? "A route through the lessons for a beginner. You can still open any lesson."
          : "You have finished the whole path. Open any lesson to do it again.",
      );
      intro.id = "lesson-path-intro";
      const ol = el("ol", "lesson-cards");
      ol.append(...PATH.map((l) => lessonCard(l, pathStep(l), l === next)));
      body.push(intro, ol);
    } else {
      let n = 0;
      body.push(
        ...LESSON_GROUPS.map((g) => {
          const section = el("section", "lesson-group");
          const h = el("h3", "lesson-group-title", g.title);
          const ul = el("ul", "lesson-cards");
          ul.append(
            ...g.lessons.map((l) => {
              n++;
              return lessonCard(l, `Lesson ${n}`, false);
            }),
          );
          section.append(h, ul);
          return section;
        }),
      );
    }
    list.replaceChildren(adviceSection(), overview, viewToggle(), ...body);
  }

  /** Games from the history, for the advice card; empty until loaded or when unavailable. */
  let history: HistoryRecord[] | null = [];
  let historyLoads = 0;

  function adviceSection() {
    const advice = buildAdvice(history ?? [], saved, PATH, LESSONS);
    const section = el("section", "lesson-advice");
    section.id = "lesson-advice";
    section.append(el("h3", "advice-title", "Coach suggests"));
    if (history === null) {
      const p = el("p", "status", "Couldn't read your games just now, so there is no advice yet.");
      p.id = "advice-unavailable";
      section.append(p);
    } else if (advice.reviewed === 0) {
      const p = el(
        "p",
        "status",
        "No reviewed game yet. Ask for a review after a practice game and the coach can tailor your lessons to your own mistakes.",
      );
      p.id = "advice-empty";
      section.append(p);
      if (advice.nextOnPath) {
        const n = el("p", "status", `Meanwhile, next on your path: ${advice.nextOnPath.title}.`);
        n.id = "advice-path";
        section.append(n);
      }
    } else if (advice.suggestions.length === 0) {
      const p = el("p", "status", "Nothing stands out in your reviewed games. Keep playing!");
      p.id = "advice-none";
      section.append(p);
    } else {
      const ul = el("ul", "advice-mistakes");
      ul.id = "advice-suggest";
      for (const s of advice.suggestions) {
        const li = el("li", "advice-item");
        li.append(
          el("h4", "advice-card-title", s.lesson.title),
          el("p", "status", s.reason),
          lessonButton(s.practiseAgain ? "Practise again" : "Start", s.lesson, true),
        );
        ul.append(li);
      }
      section.append(ul);
    }
    if (advice.harder) {
      const h = el("p", "status", `Ready for a harder opponent: try "${advice.harder}".`);
      h.id = "advice-harder";
      section.append(h);
    }
    if (advice.mistakes.length) {
      const h = el("h3", "advice-title", "Your common mistakes");
      const ul = el("ul", "advice-mistakes");
      ul.id = "advice-mistakes";
      for (const m of advice.mistakes) {
        const li = el("li", "advice-mistake");
        li.dataset.kind = m.kind;
        li.append(
          el("h4", "advice-card-title", m.label),
          el("p", "status", `${m.games} of ${m.of} reviewed games. ${m.tip}`),
        );
        if (m.lesson) li.append(lessonButton(`Lesson: ${m.lesson.title}`, m.lesson));
        ul.append(li);
      }
      section.append(h, ul);
    }
    return section;
  }

  function showList() {
    lesson = null;
    progress = null;
    resetExercise();
    playArea.hidden = true;
    end.hidden = true;
    list.hidden = false;
    ask.update(null);
    voice.sync();
    renderList();
    // Keyboard users land back on the list, not at the top of the page.
    const heading = $<HTMLHeadingElement>("lessons-heading");
    heading.tabIndex = -1;
    heading.focus();
  }

  // --- Lesson flow -------------------------------------------------------------

  function open(l: Lesson) {
    const p = saved.get(l.id);
    lesson = l;
    if (!p) progress = newProgress(l);
    else if (isFinished(p, l)) progress = newProgress(l, p.hintMode, p.runs, p.results);
    else progress = p;
    list.hidden = true;
    enterStep();
    persist();
    // Keyboard users land in the lesson, not back at the top of the page.
    titleEl.tabIndex = -1;
    titleEl.focus();
  }

  function step(): Step | null {
    return lesson && progress ? (lesson.steps[progress.step] ?? null) : null;
  }

  function enterStep() {
    if (!lesson || !progress) return;
    shown = 0;
    quizDone = false;
    resetExercise();
    if (isFinished(progress, lesson)) return showEnd();
    const s = step()!;
    if (s.kind === "exercise") startExercises(s);
    render();
  }

  function goNext() {
    if (!lesson || !progress) return;
    const s = step();
    if (s?.kind === "show" && shown < s.line.length) {
      shown++;
      render();
      return;
    }
    if (s?.kind === "exercise") {
      if (!solved) return;
      // The result was saved with the index already moved on (finishPuzzle).
      if (progress.exercise < puzzles.length) {
        loadPuzzle();
        render();
        return;
      }
    }
    nextStep();
  }

  function nextStep() {
    if (!lesson || !progress) return;
    progress = { ...progress, step: progress.step + 1, exercise: 0, exerciseIds: [] };
    if (isFinished(progress, lesson)) {
      progress = { ...progress, runs: progress.runs + 1, lastResults: progress.results };
    }
    persist();
    enterStep();
  }

  function goBack() {
    if (!lesson || !progress || progress.step === 0) return;
    const s = step();
    // Exercises are done once per run: Back never leaves or re-enters them.
    if (s?.kind === "exercise" || lesson.steps[progress.step - 1]?.kind === "exercise") return;
    progress = { ...progress, step: progress.step - 1 };
    persist();
    enterStep();
  }

  function showEnd() {
    if (!lesson || !progress) return;
    playArea.hidden = true;
    end.hidden = false;
    ask.update(null);
    voice.sync();
    $("lesson-end-title").textContent = `${lesson.title}: done`;
    $("lesson-takeaway").textContent = lesson.takeaway;
    $("lesson-score").textContent = scoreText(progress.results);
  }

  // --- Quiz ----------------------------------------------------------------------

  /** Where Ale can move now (an exercise, his turn, board free), else null: for spoken moves. */
  const movePosition = () =>
    game && canMoveNow() ? { fen: game.fen, key: `${game.fen}|${game.moves.length}` } : null;
  const voice = mountLessonVoice({
    active: () => !playArea.hidden,
    movePosition,
    playMove: (from, to, promotion) =>
      void tryMove(uciOf(from, to, promotion as PromotionPiece | undefined)),
    boardBusy: () => checking || settingUp,
    readText: () => (banner.hidden ? textEl : bannerText).textContent ?? "",
    askAloud: (question, speak) => ask.askAloud(question, speak),
  });

  function quizAnswer(square: string) {
    const s = step();
    if (s?.kind !== "quiz" || quizDone) return;
    if (s.squares.includes(square)) {
      quizDone = true;
      setText(textEl, s.right);
      textEl.dataset.tone = "ok";
      view.setMarks({ ...s, good: [square] });
    } else {
      setText(textEl, s.wrong);
      textEl.dataset.tone = "warn";
    }
    renderButtons();
  }

  // --- Exercises -------------------------------------------------------------------

  function startExercises(s: Extract<Step, { kind: "exercise" }>) {
    if (!progress) return;
    const kept = progress.exerciseIds.length ? exercisesById(s, progress.exerciseIds) : null;
    puzzles = kept ?? pickExercises(s, progress.runs);
    if (!kept) {
      progress = { ...progress, exerciseIds: puzzles.map((p) => p.id), exercise: 0 };
    }
    // Every exercise already has a result (left after the last one): move on.
    if (progress.exercise >= puzzles.length) return nextStep();
    loadPuzzle();
  }

  function resetExercise() {
    generation++;
    puzzle = null;
    game = null;
    pending = null;
    whyCtl?.abort();
    whyCtl = null;
    checking = false;
    trying = null;
    playedAnyway = false;
    settingUp = false;
    offBook = null;
    drillHints = 0;
    banner.hidden = true;
    tryBtn.textContent = "Try again";
    delete textEl.dataset.tone;
    hintsGiven = [];
    hintFacts = null;
    hintLog.replaceChildren();
    hintStatus.textContent = "";
    commentLog.replaceChildren();
  }

  function loadPuzzle() {
    resetExercise();
    if (!progress) return;
    current = progress.exercise;
    puzzle = puzzles[current] ?? null;
    if (!puzzle) return;
    // The board starts before the opponent's move, then plays it, so the player
    // sees what just happened.
    game = new GameState([], puzzle.fen);
    ply = 0;
    solved = false;
    helped = false;
    // Play-it-out positions and drills start with the player to move.
    if (!puzzle.setup) {
      view.setOrientation(game.turn);
      return;
    }
    settingUp = true;
    view.setOrientation(game.turn === "white" ? "black" : "white");
    const g = generation;
    setTimeout(() => {
      if (g !== generation || !puzzle) return;
      settingUp = false;
      play(puzzle.setup);
      render();
    }, REPLY_DELAY_MS);
  }

  function restartPuzzle() {
    const keepHelped = helped;
    loadPuzzle();
    helped = keepHelped;
    render();
  }

  async function tryMove(uci: string) {
    if (!game || !puzzle || solved || checking || pending || playedAnyway || settingUp || offBook)
      return;
    if (puzzle.theme === "drill") return drillMove(uci);
    if (puzzle.theme === "play") return playMove(uci);
    const g = generation;
    const moves = [puzzle.setup, ...puzzle.solution.slice(0, ply)];
    const expected = puzzle.solution[ply]!;
    const last = ply >= puzzle.solution.length - 1;
    const safeGoal = puzzle.theme === "safe";
    // In a "safe" exercise any move that loses nothing is right; the engine judges it below.
    if (safeGoal ? uci === expected : isAnswer(puzzle.fen, moves, uci, expected)) {
      textEl.dataset.tone = "info";
      play(uci);
      comment(safeGoal ? "Good: that keeps your pieces safe." : "Good move: that's the one.");
      ply++;
      const mate = game.status().kind !== "playing";
      if (ply >= puzzle.solution.length || last || mate) return finishPuzzle();
      // The opponent's forced reply, then the player's next move.
      checking = true;
      render();
      setTimeout(() => {
        if (g !== generation || !puzzle) return;
        checking = false;
        play(puzzle.solution[ply]!);
        ply++;
        hintsGiven = [];
        hintFacts = null;
        render();
      }, REPLY_DELAY_MS);
      return;
    }
    checking = true;
    trying = uci;
    textEl.dataset.tone = "info";
    render();
    let after = null;
    try {
      await engine.start();
      after = await engine.analyse(
        { fen: puzzle.fen, moves: [...moves, uci] },
        { movetime: CHECK_MS },
      );
    } catch {
      // Without the engine, a miss is just "not quite".
    }
    if (g !== generation) return;
    checking = false;
    trying = null;
    if (safeGoal) {
      const s = judgeSafe(puzzle.fen, moves, uci, after);
      if (s.kind === "safe") {
        textEl.dataset.tone = "info";
        play(uci);
        comment("Safe: none of your pieces can be won.");
        return finishPuzzle();
      }
      if (s.kind === "unknown") {
        textEl.textContent = "The engine couldn't check that move. Try again, or press Skip.";
        textEl.dataset.tone = "warn";
        view.sync(game);
        renderButtons();
        return;
      }
    }
    helped = true;
    const j = judgeMiss(puzzle.fen, moves, uci, after);
    if (j.kind === "warn") {
      const playedSan = uciLineToSan(gameAt({ fen: puzzle.fen, moves }), [uci])[0] ?? uci;
      pending = {
        uci,
        why: { fen: puzzle.fen, moves, playedSan, replySans: j.replySans, warning: j.text },
      };
      bannerText.textContent = j.text;
      whyText.hidden = true;
      whyBtn.hidden = false;
      anywayBtn.hidden = false;
      banner.hidden = false;
      comment(`Mistake: ${j.text.replace(/^Careful: /, "")}`);
      textEl.textContent = "Wait: read the warning below before you go on.";
      textEl.dataset.tone = "warn";
      render();
      tryBtn.focus();
      return;
    }
    comment("Not the best move here.");
    textEl.textContent = "Not quite. Try again.";
    textEl.dataset.tone = "warn";
    view.sync(game);
    renderButtons();
  }

  /** The player's move in an opening drill: a book move gets the book reply; any other is held back. */
  function drillMove(uci: string) {
    const s = step();
    if (!game || !puzzle || s?.kind !== "exercise" || s.theme !== "drill") return;
    const expected = puzzle.solution[ply]!;
    if (uci !== expected) {
      helped = true;
      offBook = uci;
      tryBtn.textContent = "Take it back";
      whyBtn.hidden = true;
      anywayBtn.hidden = true;
      whyText.hidden = true;
      setText(bannerText, leftBookText(s.opening, game.moves, uci, expected));
      banner.hidden = false;
      comment("That leaves the book.");
      textEl.textContent = "Out of the book: read the note below.";
      textEl.dataset.tone = "warn";
      render();
      tryBtn.focus();
      return;
    }
    play(uci);
    ply++;
    drillHints = 0;
    comment(`Book move. ${positionName(game.moves) ?? ""}`.trim());
    if (ply >= puzzle.solution.length) return finishPuzzle();
    checking = true;
    render();
    const g = generation;
    setTimeout(() => {
      if (g !== generation || !puzzle) return;
      checking = false;
      play(puzzle.solution[ply]!);
      ply++;
      if (ply >= puzzle.solution.length) return finishPuzzle();
      render();
    }, REPLY_DELAY_MS);
  }

  /** The player's move in a "play it out" exercise: the engine checks it, then answers at full strength. */
  async function playMove(uci: string) {
    const s = step();
    if (!game || !puzzle || s?.kind !== "exercise" || s.theme !== "play") return;
    const g = generation;
    const moves = [...game.moves];
    checking = true;
    trying = uci;
    textEl.dataset.tone = "info";
    render();
    let after = null;
    // A mate needs no look: it ends the exercise.
    if (!gameAt({ fen: puzzle.fen, moves: [...moves, uci] }).isCheckmate()) {
      try {
        await engine.start();
        after = await engine.analyse(
          { fen: puzzle.fen, moves: [...moves, uci] },
          { movetime: CHECK_MS },
        );
      } catch {
        // Judged below as unknown.
      }
    }
    if (g !== generation || !game) return;
    checking = false;
    trying = null;
    const j = judgePlay(puzzle.fen, moves, uci, after);
    if (j.kind === "unknown") {
      textEl.textContent = "The engine couldn't check that move. Try again, or press Skip.";
      textEl.dataset.tone = "warn";
      view.sync(game);
      renderButtons();
      return;
    }
    if (j.kind === "warn") {
      helped = true;
      const playedSan = uciLineToSan(gameAt({ fen: puzzle.fen, moves }), [uci])[0] ?? uci;
      pending = {
        uci,
        why: { fen: puzzle.fen, moves, playedSan, replySans: j.replySans, warning: j.text },
      };
      bannerText.textContent = j.text;
      whyText.hidden = true;
      whyBtn.hidden = false;
      anywayBtn.hidden = false;
      banner.hidden = false;
      comment(`Mistake: ${j.text.replace(/^Careful: /, "")}`);
      textEl.textContent = "Wait: read the warning below before you go on.";
      textEl.dataset.tone = "warn";
      render();
      tryBtn.focus();
      return;
    }
    play(uci);
    hintsGiven = [];
    hintFacts = null;
    const side = game.turn === "white" ? "b" : "w";
    if (goalMet(s.goal, gameAt({ fen: puzzle.fen, moves: [...game.moves] }), side)) {
      comment(s.goal === "mate" ? "Checkmate!" : "Developed and castled.");
      return finishPuzzle();
    }
    comment("Fine: that gives nothing away.");
    const mine = playerMoves();
    if (s.maxMoves && mine >= s.maxMoves) {
      const d = development(gameAt({ fen: puzzle.fen, moves: [...game.moves] }), side);
      return stopPlay(
        `Your ${s.maxMoves} moves are up: ${developText(d, 0).replace(/ 0 moves left\.$/, "")} Press Try again to start over.`,
      );
    }
    const reply = after?.pv[0];
    if (!reply) return stopPlay("The engine couldn't answer. Press Try again to start over.");
    checking = true;
    render();
    setTimeout(() => {
      if (g !== generation || !game) return;
      checking = false;
      play(reply);
      const now = gameAt({ fen: puzzle!.fen, moves: [...game.moves] });
      if (now.isCheckmate()) {
        return stopPlay("The engine gave checkmate. Press Try again to start over.");
      }
      if (now.isDraw()) {
        return stopPlay(
          now.isThreefoldRepetition()
            ? "The position came up a third time, so the game is a draw. Press Try again to start over."
            : "The game is a draw. Press Try again to start over.",
        );
      }
      render();
    }, REPLY_DELAY_MS);
  }

  /** How many moves the player has made in the current play-it-out exercise. */
  function playerMoves(): number {
    return game ? Math.ceil(game.moves.length / 2) : 0;
  }

  /** Ends a play-it-out attempt without the goal: the exercise waits for Try again. */
  function stopPlay(text: string) {
    helped = true;
    playedAnyway = true;
    bannerText.textContent = text;
    whyBtn.hidden = true;
    anywayBtn.hidden = true;
    whyText.hidden = true;
    banner.hidden = false;
    textEl.textContent = "Not this time: read the note below.";
    textEl.dataset.tone = "warn";
    render();
    tryBtn.focus();
  }

  function play(uci: string) {
    game?.play(uci.slice(0, 2), uci.slice(2, 4), uci[4] as PromotionPiece | undefined);
  }

  function finishPuzzle() {
    if (!progress) return;
    solved = true;
    record(helped ? "help" : "first");
    textEl.textContent = helped ? "Solved, with help." : "Solved first try!";
    textEl.dataset.tone = "ok";
    render();
    nextBtn.focus();
  }

  function skipPuzzle() {
    if (!progress || solved || !puzzle) return;
    solved = true;
    record("skipped");
    goNext();
  }

  /** Saves an exercise's result and moves the saved place on, in one save. */
  function record(result: ExerciseResult) {
    if (!progress) return;
    progress = {
      ...progress,
      results: [...progress.results, result],
      exercise: current + 1,
    };
    persist();
  }

  // Banner buttons.
  tryBtn.addEventListener("click", () => {
    if (playedAnyway) return restartPuzzle();
    offBook = null;
    tryBtn.textContent = "Try again";
    pending = null;
    whyCtl?.abort();
    banner.hidden = true;
    delete textEl.dataset.tone;
    if (game) view.sync(game);
    render();
  });

  anywayBtn.addEventListener("click", () => {
    if (!pending || !game) return;
    const { why } = pending;
    play(pending.uci);
    pending = null;
    playedAnyway = true;
    whyBtn.hidden = true;
    anywayBtn.hidden = true;
    const reply = why.replySans[0];
    if (!reply) {
      // A draw, such as stalemate: nothing to answer.
      bannerText.textContent = `${why.warning.replace(/^Careful: /, "You played it anyway: ")} Press Try again to start this exercise again.`;
      return render();
    }
    bannerText.textContent = "You played it anyway. Watch the engine's answer.";
    render();
    const g = generation;
    setTimeout(() => {
      if (g !== generation || !game) return;
      const m = gameAt({ fen: game.fen }).move(reply);
      game.play(m.from, m.to, m.promotion as PromotionPiece | undefined);
      bannerText.textContent = `The engine answers ${reply}. ${why.warning.replace(/^Careful: /, "That's what the warning meant: ")} Press Try again to start this exercise again.`;
      render();
    }, REPLY_DELAY_MS);
  });

  whyBtn.addEventListener("click", async () => {
    if (!pending || whyCtl || whyBtn.disabled) return;
    const facts = pending.why;
    // Disabled before the first await: one click, one coach call.
    whyBtn.disabled = true;
    if (usageGuard.paused) {
      whyBtn.disabled = false;
      whyText.textContent =
        "The coach is paused at your usage limit. The warning above says what goes wrong.";
      whyText.hidden = false;
      return;
    }
    const sample = await getSample();
    if (!sample) {
      whyBtn.disabled = false;
      whyText.textContent =
        "The coach isn't available here. The warning above says what goes wrong.";
      whyText.hidden = false;
      return;
    }
    const c = new AbortController();
    whyCtl = c;
    whyText.textContent = "The coach is writing…";
    whyText.hidden = false;
    try {
      const r = await sample(
        {
          purpose: "why",
          fen: facts.fen,
          moves: [...facts.moves],
          playedSan: facts.playedSan,
          replySans: facts.replySans,
          warning: facts.warning,
        },
        { signal: c.signal },
      );
      if (c.signal.aborted) return;
      const text = r.text.trim();
      whyText.textContent = acceptWhy(text, r.truncated, facts)
        ? text
        : "The coach's answer didn't match the engine, so it isn't shown. The warning above is the engine's reason.";
    } catch (err) {
      if (c.signal.aborted) return;
      const code = (err as SampleError).code;
      if (isUsageLimit(code)) usageGuard.pause();
      whyText.textContent = whyErrorText(code);
    } finally {
      if (whyCtl === c) whyCtl = null;
      whyBtn.disabled = false;
    }
  });

  // Hints, from the engine's facts (no coach call).
  function hintMode(): HintMode {
    return progress?.hintMode ?? "tell";
  }

  for (const input of modeSet.querySelectorAll<HTMLInputElement>("input")) {
    input.addEventListener("change", () => {
      if (!progress || !input.checked) return;
      progress = { ...progress, hintMode: input.value === "ask" ? "ask" : "tell" };
      persist();
      renderButtons();
    });
  }

  function factsNow(): Promise<EngineFacts> | null {
    if (!game || !puzzle) return null;
    const key = game.fen;
    if (hintFacts?.key !== key) {
      const position = { fen: puzzle.fen, moves: [...game.moves] };
      hintFacts = {
        key,
        facts: engine
          .start()
          .then(() => engine.analyse(position, { movetime: CHECK_MS }))
          .then((a) => buildFacts(gameAt(position), a)),
      };
    }
    return hintFacts.facts;
  }

  async function giveHint(stage: HintStage) {
    if (settingUp) return;
    const facts = factsNow();
    if (!facts || !game) return;
    const g = generation;
    const fen = game.fen;
    hintStatus.textContent = "Looking at the position…";
    hintBtn.disabled = true;
    try {
      const f = await facts;
      // A move was played meanwhile: this hint is for a position that's gone.
      if (g !== generation || game?.fen !== fen) return;
      const again = hintsGiven.includes("question");
      const text = engineHint(f, stage, again);
      hintsGiven = [...hintsGiven, stage];
      helped = true;
      const li = document.createElement("li");
      li.textContent = text;
      hintLog.append(li);
      hintStatus.textContent = "";
    } catch (err) {
      hintFacts = null; // so the next click asks the engine again
      if (g !== generation) return;
      hintStatus.textContent = `The engine couldn't look at the position: ${(err as Error).message}`;
    }
    renderButtons();
  }

  /** Drills: the book's next move, as the piece, then the move. No engine needed. */
  function drillHint() {
    const s = step();
    if (!game || !puzzle || s?.kind !== "exercise" || s.theme !== "drill") return;
    const uci = puzzle.solution[ply];
    if (!uci || drillHints >= 2) return;
    const m = gameAt({ fen: game.fen }).move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4],
    });
    const piece = PIECE_NAMES[m.piece] ?? "piece";
    const text =
      drillHints === 0
        ? m.san.startsWith("O-O")
          ? `The ${s.opening} castles here.`
          : `The ${s.opening} moves a ${piece} here.`
        : `The ${s.opening} plays ${m.san} here.`;
    drillHints++;
    helped = true;
    const li = document.createElement("li");
    li.textContent = text;
    hintLog.append(li);
    renderButtons();
  }

  hintBtn.addEventListener("click", () => {
    if (puzzle?.theme === "drill") return drillHint();
    const next = hintOptions(hintsGiven, hintMode()).primary;
    if (next) void giveHint(next);
  });
  anotherBtn.addEventListener("click", () => void giveHint("question"));

  // --- Rendering ---------------------------------------------------------------------

  function render() {
    if (!lesson || !progress) return;
    const s = step();
    if (!s) return;
    const wasHidden = playArea.hidden;
    playArea.hidden = false;
    if (wasHidden) view.redraw();
    end.hidden = true;
    titleEl.textContent = lesson.title;
    where.textContent = `Step ${progress.step + 1} of ${lesson.steps.length}`;
    coach.hidden = s.kind !== "exercise";
    if (s.kind === "explain") {
      setText(textEl, s.text);
      delete textEl.dataset.tone;
      view.sync(new GameState([], s.fen));
      view.setOrientation("white");
      view.setMarks(s);
    } else if (s.kind === "show") {
      const fen = gameAt({ fen: s.fen }).fen();
      const g = new GameState([], fen);
      for (const m of s.line.slice(0, shown)) {
        const mv = gameAt({ fen: g.fen }).move(m.san);
        g.play(mv.from, mv.to, mv.promotion as PromotionPiece | undefined);
      }
      const current = shown ? s.line[shown - 1]! : null;
      setText(textEl, current ? current.text : s.intro);
      delete textEl.dataset.tone;
      view.sync(g);
      view.setOrientation("white");
      view.setMarks(current ?? {});
    } else if (s.kind === "quiz") {
      if (!quizDone && textEl.dataset.tone !== "warn") setText(textEl, s.prompt);
      view.sync(new GameState([], s.fen));
      view.setOrientation("white");
      if (!quizDone) view.setMarks(s);
    } else if (game && puzzle) {
      where.textContent += ` · Exercise ${current + 1} of ${puzzles.length}`;
      if (!solved && !pending && textEl.dataset.tone !== "warn") {
        const side = game.turn === "white" ? "White" : "Black";
        textEl.textContent = settingUp
          ? "Watch your opponent's move…"
          : checking
            ? s.theme === "play" && !trying
              ? "The engine is answering…"
              : s.theme === "drill"
                ? "The book answers…"
                : "Checking your move…"
            : s.theme === "drill"
              ? drillText(s.task)
              : s.theme === "play"
                ? playText(s)
                : ply > 0
                  ? `Good. Not finished yet: ${side} to move again.`
                  : `${side} to move. ${s.task}`;
        textEl.dataset.tone = "info";
      }
      // A move being checked, or a drill move out of the book, stays on the board meanwhile.
      const shownMove = trying ?? offBook;
      view.sync(shownMove ? new GameState([shownMove], game.fen) : game);
      view.setMarks();
      for (const input of modeSet.querySelectorAll<HTMLInputElement>("input")) {
        input.checked = input.value === hintMode();
      }
    }
    renderButtons();
  }

  /** A drill's line above the board: the name of the position, then the task. */
  function drillText(task: string): string {
    if (!game) return task;
    const side = game.turn === "white" ? "White" : "Black";
    const name = positionName(game.moves);
    return game.moves.length && name ? `${name}. ${side} to move.` : `${side} to move. ${task}`;
  }

  /** A play-it-out exercise's line above the board: the task, and how the goal is going. */
  function playText(s: Extract<Step, { kind: "exercise" }> & { theme: "play" }): string {
    if (!game || !puzzle) return s.task;
    const side = game.turn === "white" ? "White" : "Black";
    if (s.goal !== "develop" || !s.maxMoves) return `${side} to move. ${s.task}`;
    const d = development(
      gameAt({ fen: puzzle.fen, moves: [...game.moves] }),
      game.turn[0] as "w" | "b",
    );
    return `${side} to move. ${s.task} ${developText(d, s.maxMoves - playerMoves())}`;
  }

  /** What the Ask the coach area works with on this step, or null to hide it. */
  function askView(): AskView | null {
    const s = step();
    if (!lesson || !progress || !s) return null;
    const key = `${lesson.id}:${progress.step}`;
    const base = { lessonTitle: lesson.title, kind: s.kind };
    const at = (place: string): AskPlace => ({
      lessonId: lesson!.id,
      lessonVersion: lesson!.version,
      place,
      bestMove: null,
    });
    if (s.kind === "explain") {
      return {
        key,
        step: key,
        questions: s.questions,
        ctx: {
          ...base,
          text: s.text,
          textSans: textMoves(s.text),
          position: { fen: s.fen },
          secret: false,
        },
        at: at(`step:${progress.step}`),
        reword: true,
        ready: true,
      };
    }
    if (s.kind === "show") {
      const played = s.line.slice(0, shown);
      const text = played.at(-1)?.text ?? s.intro;
      const g = gameAt({ fen: s.fen });
      const moves = played.map((m) => {
        const mv = g.move(m.san);
        return mv.from + mv.to + (mv.promotion ?? "");
      });
      return {
        key: `${key}:${shown}`,
        step: key,
        questions: s.questions,
        ctx: {
          ...base,
          text,
          textSans: [...textMoves(text), ...played.map((m) => m.san)],
          position: { fen: s.fen, moves },
          secret: false,
        },
        at: at(`step:${progress.step}:${shown}`),
        reword: true,
        ready: true,
      };
    }
    if (s.kind === "quiz") {
      // The box stays on a quiz. Until the answer is found the coach only sees the question
      // (kept secret, no ready-made answers), and the answers are filed apart.
      if (!quizDone) {
        return {
          key: `${key}:open`,
          step: key,
          questions: [],
          ctx: {
            ...base,
            text: s.prompt,
            textSans: textMoves(s.prompt),
            position: { fen: s.fen },
            secret: true,
            answerSquares: s.squares,
          },
          at: at(`step:${progress.step}:open`),
          reword: false,
          ready: true,
        };
      }
      const text = `${s.prompt} ${s.right}`;
      return {
        key,
        step: key,
        questions: s.questions,
        ctx: { ...base, text, textSans: textMoves(text), position: { fen: s.fen }, secret: false },
        at: at(`step:${progress.step}`),
        reword: false,
        ready: true,
      };
    }
    if (!game || !puzzle) return null;
    return {
      key: `${key}:${current}:${game.fen}`,
      step: key,
      questions: s.questions,
      ctx: {
        ...base,
        text: s.task,
        textSans: [],
        position: { fen: puzzle.fen, moves: [...game.moves] },
        secret: !solved,
      },
      // The position, not the run: the same puzzle position shares its answers.
      at: at(`fen:${game.fen.split(" ").slice(0, 4).join(" ")}`),
      reword: false,
      ready: !settingUp && !checking && !pending && !playedAnyway && !offBook,
    };
  }

  function renderButtons() {
    const s = step();
    if (!s || !progress) return;
    ask.update(askView());
    voice.sync();
    backBtn.disabled = progress.step === 0 || s.kind === "exercise";
    skipBtn.hidden = s.kind !== "exercise" || solved;
    if (s.kind === "show") {
      nextBtn.textContent = shown < s.line.length ? "Next move" : "Next";
      nextBtn.disabled = false;
    } else if (s.kind === "quiz") {
      nextBtn.textContent = "Next";
      nextBtn.disabled = !quizDone;
    } else if (s.kind === "exercise") {
      const lastOne = current + 1 >= puzzles.length;
      nextBtn.textContent = lastOne ? "Finish" : "Next exercise";
      nextBtn.disabled = !solved;
      const busy = solved || checking || !!pending || playedAnyway || settingUp || !!offBook;
      if (s.theme === "drill") {
        hintBtn.textContent = ["Hint: the piece", "Hint: the move"][drillHints] ?? "No more hints";
        hintBtn.disabled = drillHints >= 2 || busy;
        anotherBtn.hidden = true;
        skipBtn.disabled = checking;
        modeSet.hidden = true;
        return;
      }
      modeSet.hidden = false;
      const opts = hintOptions(hintsGiven, hintMode());
      hintBtn.textContent = opts.primary ? buttonLabel(opts.primary) : "No more hints";
      hintBtn.disabled = !opts.primary || busy;
      anotherBtn.hidden = !opts.another;
      anotherBtn.disabled = busy;
      skipBtn.disabled = checking;
    } else {
      nextBtn.textContent = "Next";
      nextBtn.disabled = false;
    }
  }

  nextBtn.addEventListener("click", goNext);
  backBtn.addEventListener("click", goBack);
  skipBtn.addEventListener("click", skipPuzzle);
  leaveBtn.addEventListener("click", showList);
  $("lesson-done").addEventListener("click", showList);
  $("lesson-again").addEventListener("click", () => lesson && open(lesson));

  return {
    /** Called when the Lessons screen is shown. */
    async show() {
      if (lesson) return;
      renderList();
      // Only the newest load counts, so a slow older one can't overwrite it.
      const mine = ++historyLoads;
      const gamesLoaded = loadHistory().then(
        (r) => {
          if (mine === historyLoads) history = r;
        },
        () => {
          if (mine === historyLoads) history = null;
        },
      );
      await connect();
      loaded = true;
      if (!lesson) renderList();
      await gamesLoaded;
      if (!lesson) renderList();
    },
  };
}
