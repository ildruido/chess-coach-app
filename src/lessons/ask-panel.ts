// "Ask the coach" under every lesson step (CC-026). Suggested questions show
// their written answers (no coach call). Ale's own question and "Explain
// differently" each make one quick coach call, on the click only, with the
// engine's facts for the position; an answer that fails the fact check isn't
// shown, and nothing is retried automatically.
//
// Saved answers (CC-027): every coach answer shown is saved, and a question
// asked again, even in other words, gets its saved answer at once with no
// coach call ("You asked this before", with "Ask the coach anyway"). A near
// match is offered as "Did you mean …?". 👍 / 👎 under an answer; 👎 stops it
// being reused.

import { diagnosticsOn, onDiagnostics } from "../diagnostics";
import { gameAt } from "../chess/notation";
import { getSample } from "../claude";
import { buildFacts, type EngineFacts } from "../coach/hint";
import { lessonOf, type CoachCall } from "../coach/call";
import { isUsageLimit, usageGuard } from "../coach/usage";
import type { Analysis } from "../engine/uci";
import type { StockfishEngine } from "../engine/stockfish";
import { type AskPlace, isPositionPlace, lessonCtx, lessonQuery } from "../kb/contexts";
import { type KbEntry } from "../kb/entry";
import { knowledge, type KnowledgeBase } from "../kb/book";
import { type Match } from "../kb/matcher";
import {
  acceptAsk,
  acceptReword,
  type AskContext,
  coachErrorText,
  decideScope,
  HELD_BACK_TEXT,
  type NamedMove,
  namedMoveFacts,
  namesTheAnswer,
  parseNamedMove,
  splitScope,
  tidyQuestion,
  TRY_IT_TEXT,
} from "./ask";
import type { SuggestedQuestion } from "./lesson";

/** Time the engine gets to look at the position for a question, as for hints. */
const LOOK_MS = 1000;

/** What the lesson shows right now, for the Ask the coach area. */
export interface AskView {
  /** Changes whenever the step or the position changes: a late answer is then dropped. */
  key: string;
  /** Changes only when the step changes. */
  step: string;
  questions: SuggestedQuestion[];
  ctx: AskContext;
  /** Where saved answers apply: the step, or in an exercise the position (best move filled in later). */
  at: AskPlace;
  /** "Explain differently" is offered (Explain and Show steps). */
  reword: boolean;
  /** False while the board is busy (the opponent's move, a move being checked). */
  ready: boolean;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ASKED_BEFORE = "You asked this before.";
const SAID_BEFORE = "Explained this way before.";
const NOT_REUSED = "Got it: this answer won't be shown again.";
/** Shown while the coach works: never read aloud. */
export const WORKING = new Set(["The coach is looking at the position…", "The coach is writing…"]);

export function mountAskPanel(
  engine: StockfishEngine,
  fill: (el: HTMLElement, text: string) => void,
  /** Called when a typed question is answered (by the coach, a saved answer or the page). */
  onAnswer: (ctx: AskContext) => void,
  book: KnowledgeBase = knowledge,
) {
  const section = $<HTMLElement>("lesson-ask");
  const questionsEl = $<HTMLDivElement>("lesson-questions");
  const rewordBtn = $<HTMLButtonElement>("lesson-reword");
  const rewordRow = $<HTMLDivElement>("lesson-reword-row");
  const answerBox = $<HTMLDivElement>("lesson-answer");
  const answerQ = $<HTMLParagraphElement>("lesson-answer-q");
  const answerNote = $<HTMLParagraphElement>("lesson-answer-note");
  const answerA = $<HTMLParagraphElement>("lesson-answer-a");
  const offerRow = $<HTMLDivElement>("lesson-answer-actions");
  const showSavedBtn = $<HTMLButtonElement>("lesson-answer-show");
  const coachBtn = $<HTMLButtonElement>("lesson-answer-coach");
  const voteRow = $<HTMLDivElement>("lesson-vote");
  const upBtn = $<HTMLButtonElement>("lesson-vote-up");
  const downBtn = $<HTMLButtonElement>("lesson-vote-down");
  const countEl = $<HTMLParagraphElement>("lesson-answer-count");

  let view: AskView | null = null;
  let ctl: AbortController | null = null;
  /** Rewordings already shown for this step, so "Another way" asks for a new one. */
  let rewords: string[] = [];
  /** A saved answer offered for the question on screen: "Ask the coach (anyway)" and "Show that answer". */
  let offer: { question: string; record: KbEntry; ctx: AskContext } | null = null;
  /** The saved answer on screen, for 👍 / 👎. */
  let voted: KbEntry | null = null;
  /** Set while a spoken question is being answered (CC-057): the answer is read aloud as it appears. */
  let speakNow: ((text: string) => void) | null = null;

  function show(question: string, answer: string, written = false) {
    answerQ.textContent = question;
    if (written) fill(answerA, answer);
    else answerA.textContent = answer;
    answerA.hidden = !answer;
    answerNote.hidden = true;
    offerRow.hidden = true;
    offer = null;
    setVotes(null);
    answerBox.hidden = false;
    if (answer && !WORKING.has(answer)) speakNow?.(answer);
  }

  function note(text: string) {
    answerNote.textContent = text;
    answerNote.hidden = false;
  }

  function setVotes(r: KbEntry | null) {
    voted = r;
    voteRow.hidden = !r;
    upBtn.setAttribute("aria-pressed", String(r?.vote === 1));
    downBtn.setAttribute("aria-pressed", String(r?.vote === -1));
  }

  function renderCount() {
    countEl.textContent = book.diagLine("Lesson questions", "ask", "reword");
    countEl.hidden = !diagnosticsOn();
  }

  onDiagnostics(renderCount);

  function clear() {
    ctl?.abort();
    ctl = null;
    rewords = [];
    answerBox.hidden = true;
    answerQ.textContent = "";
    answerA.textContent = "";
    answerNote.hidden = true;
    offerRow.hidden = true;
    offer = null;
    setVotes(null);
  }

  function renderControls() {
    const busy = !!ctl || !view?.ready;
    rewordBtn.disabled = busy;
    coachBtn.disabled = busy;
    showSavedBtn.disabled = busy;
    rewordRow.hidden = !view?.reword;
    rewordBtn.textContent = rewords.length ? "Another way" : "Explain differently";
  }

  function renderQuestions() {
    questionsEl.replaceChildren(
      ...(view?.questions ?? []).map(({ q, a }) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "secondary";
        fill(b, q);
        b.addEventListener("click", () => {
          // A written answer replaces whatever the coach was writing.
          ctl?.abort();
          ctl = null;
          show(b.textContent ?? q, a, true);
          renderControls();
        });
        return b;
      }),
    );
    questionsEl.hidden = !view?.questions.length;
  }

  /** Shows a saved answer instead of asking the coach, and counts the reuse. */
  function showSaved(question: string, r: KbEntry, ctx: AskContext, label: string) {
    show(`You asked: ${question}`, r.answer);
    note(label);
    offer = { question, record: r, ctx };
    coachBtn.textContent = "Ask the coach anyway";
    showSavedBtn.hidden = true;
    offerRow.hidden = false;
    setVotes(r);
    book.feedback(r, "reused");
    renderCount();
    onAnswer(ctx);
  }

  /** A close match is shown at once; a near one is offered. False when nothing matched. */
  function offerSaved(question: string, m: Match, ctx: AskContext): boolean {
    if (m.kind === "none") return false;
    if (m.kind === "close") {
      showSaved(question, m.entry, ctx, ASKED_BEFORE);
      return true;
    }
    show(`You asked: ${question}`, "");
    const didYouMean = `Did you mean: “${m.entry.text.replace(/[?.!\s]+$/, "")}”?`;
    note(didYouMean);
    speakNow?.(didYouMean);
    offer = { question, record: m.entry, ctx };
    coachBtn.textContent = "Ask the coach";
    showSavedBtn.hidden = false;
    offerRow.hidden = false;
    return true;
  }

  function saveNew(
    kind: "ask" | "reword",
    at: AskPlace,
    question: string,
    answer: string,
    scope: "idea" | "place",
  ) {
    const r = book.save({
      kind,
      group: at.lessonId,
      ctx: lessonCtx(at),
      wide: kind === "ask" && scope === "idea",
      text: question,
      answer,
      meta: { lessonVersion: at.lessonVersion, place: at.place, bestMove: at.bestMove },
    });
    setVotes(r);
    renderCount();
    void book.settled().then(renderCount);
  }

  /** One coach call: the caller has checked the click is allowed. Never retried on its own. */
  async function call(
    label: string,
    /** The call to send; a function instead answers on the page (no call); null when aborted. */
    prompt: (signal: AbortSignal) => Promise<CoachCall | (() => void) | null>,
    /** The text to show from the coach's answer, or null when it fails the fact check. */
    accept: (text: string, truncated: boolean) => string | null,
    after: string,
    onShown?: (text: string) => void,
  ) {
    if (usageGuard.paused) {
      show(label, coachErrorText("rate_limited", after));
      return;
    }
    const c = new AbortController();
    ctl = c;
    renderControls();
    show(label, "The coach is looking at the position…");
    let stage: "engine" | "coach" = "engine";
    try {
      const sample = await getSample();
      if (c.signal.aborted) return;
      if (!sample) {
        show(label, `The coach isn't available here. ${after}`);
        return;
      }
      const text = await prompt(c.signal);
      if (c.signal.aborted || text === null) return;
      if (typeof text === "function") {
        text();
        return;
      }
      stage = "coach";
      show(label, "The coach is writing…");
      const r = await sample(text, { signal: c.signal });
      if (c.signal.aborted) return;
      const answer = accept(r.text.trim(), r.truncated);
      if (answer !== null) {
        show(label, answer);
        onShown?.(answer);
      } else show(label, HELD_BACK_TEXT);
    } catch (err) {
      if (c.signal.aborted) return;
      const code = (err as SampleError).code;
      if (isUsageLimit(code)) usageGuard.pause();
      show(
        label,
        stage === "coach"
          ? coachErrorText(code, after)
          : `The engine couldn't look at the position: ${(err as Error).message}`,
      );
    } finally {
      if (ctl === c) ctl = null;
      renderControls();
    }
  }

  /** Ale's own question: a saved answer if one matches (unless skipped), else one coach call. */
  function ask(question: string, skipSaved: boolean): Promise<void> {
    const v = view;
    if (!v || !v.ready || ctl || !question) return Promise.resolve();
    const ctx = v.ctx;
    const position = isPositionPlace(v.at.place);
    // On a step, saved answers are matched at once; in an exercise only once
    // the engine has said what the best move is.
    if (
      !skipSaved &&
      !position &&
      offerSaved(question, book.find(lessonQuery("ask", v.at, question)), ctx)
    )
      return Promise.resolve();
    let facts: EngineFacts | null = null;
    let named: NamedMove | null = null;
    let namedCall: { san: string; after: Analysis } | undefined;
    let at = v.at;
    let tag: "idea" | "place" = "place";
    const label = `You asked: ${question}`;
    return call(
      label,
      async (signal) => {
        await engine.start();
        if (signal.aborted) return null;
        const game = gameAt(ctx.position);
        const analysis = await engine.analyse(ctx.position, { movetime: LOOK_MS });
        const f = buildFacts(game, analysis);
        facts = f;
        if (signal.aborted) return null;
        const san = parseNamedMove(question, game);
        if (namesTheAnswer(ctx, f, san)) {
          return () => {
            show(label, TRY_IT_TEXT);
            onAnswer(ctx);
          };
        }
        if (position) {
          at = { ...v.at, bestMove: f.bestMove };
          const m = skipSaved ? null : book.find(lessonQuery("ask", at, question));
          // In an open exercise a saved answer must still keep the answer secret.
          if (
            m &&
            m.kind !== "none" &&
            (!ctx.secret || acceptAsk(m.entry.answer, false, ctx, f, null))
          )
            return () => offerSaved(question, m, ctx);
        }
        if (san) {
          // The engine checks the move first; the coach only explains its answer.
          const mv = gameAt(ctx.position).move(san);
          const uci = mv.from + mv.to + (mv.promotion ?? "");
          const afterPos = { fen: ctx.position.fen, moves: [...(ctx.position.moves ?? []), uci] };
          const after = await engine.analyse(afterPos, { movetime: LOOK_MS });
          if (signal.aborted) return null;
          named = namedMoveFacts(ctx.position, san, after);
          namedCall = { san, after };
        }
        return {
          purpose: "lesson-ask",
          lesson: lessonOf(ctx),
          secret: ctx.secret,
          position: ctx.position,
          analysis,
          question,
          ...(namedCall && { named: namedCall }),
          ...(skipSaved && { fresh: true }),
        };
      },
      (text, truncated) => {
        const split = splitScope(text);
        tag = split.tag;
        return facts && acceptAsk(split.answer, truncated, ctx, facts, named) ? split.answer : null;
      },
      "Try again, or pick one of the questions above.",
      (answer) => {
        onAnswer(ctx);
        saveNew("ask", at, question, answer, decideScope(tag, question, answer));
      },
    );
  }

  coachBtn.addEventListener("click", () => {
    if (offer) void ask(offer.question, true);
  });

  showSavedBtn.addEventListener("click", () => {
    if (!offer || ctl || !view?.ready) return;
    showSaved(offer.question, offer.record, offer.ctx, ASKED_BEFORE);
  });

  rewordBtn.addEventListener("click", () => {
    const v = view;
    if (!v || !v.ready || !v.reword || ctl) return;
    const ctx = v.ctx;
    const label = rewords.length ? "Another way" : "Explain differently";
    // Saved rewordings of this step first, then the coach for a new one.
    const saved = book
      .list(lessonQuery("reword", v.at, ""))
      .find((r) => !rewords.includes(r.answer));
    if (saved) {
      show(label, saved.answer);
      note(SAID_BEFORE);
      setVotes(saved);
      rewords = [...rewords, saved.answer];
      book.feedback(saved, "reused");
      renderCount();
      renderControls();
      return;
    }
    const earlier = [...rewords];
    void call(
      label,
      async () => ({
        purpose: "reword" as const,
        lesson: lessonOf(ctx),
        position: ctx.position,
        earlier,
      }),
      (text, truncated) => (acceptReword(text, truncated, ctx) ? text : null),
      "The lesson text above still says it.",
      (text) => {
        rewords = [...rewords, text];
        saveNew("reword", v.at, "Explain differently", text, "place");
      },
    );
  });

  upBtn.addEventListener("click", () => {
    if (!voted) return;
    book.feedback(voted, { vote: voted.vote === 1 ? 0 : 1 });
    if (answerNote.textContent === NOT_REUSED) answerNote.hidden = true;
    setVotes(voted);
  });

  downBtn.addEventListener("click", () => {
    if (!voted) return;
    book.feedback(voted, { vote: voted.vote === -1 ? 0 : -1 });
    if (voted.vote === -1) note(NOT_REUSED);
    else if (answerNote.textContent === NOT_REUSED) answerNote.hidden = true;
    setVotes(voted);
  });

  return {
    /**
     * A question from the "Talk to the coach" box (CC-057): the answer is shown and read aloud
     * through `speak`. Resolves with why it couldn't be asked (to tell the player), else null,
     * once it has been answered.
     */
    async askAloud(question: string, speak: (text: string) => void): Promise<string | null> {
      const q = tidyQuestion(question);
      if (!q) return null;
      if (!view) return "Ask the coach opens once you have tried this step.";
      if (!view.ready || ctl) return "The coach is busy. Ask again in a moment.";
      speakNow = speak;
      try {
        await ask(q, false);
      } finally {
        speakNow = null;
      }
      return null;
    },
    /** Called on every lesson render; null hides the area (a quiz not answered yet, the end). */
    update(next: AskView | null) {
      const changed = next?.key !== view?.key;
      view = next;
      section.hidden = !next;
      if (next) void book.load("ask", next.at.lessonId).then(renderCount);
      if (changed) {
        clear();
        renderQuestions();
      }
      renderControls();
    },
  };
}
