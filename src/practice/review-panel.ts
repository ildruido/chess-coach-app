// The post-game review: after a finished practice game, on a click, the
// engine checks every position, the page shows the turning points from the
// engine alone, and then one default-tier coach call words the "why" of each
// and the lesson. Every coach text is fact-checked; a failing one keeps the
// engine's. Stop cancels the engine's check or the coach's call.
import { mountMiniBoard, type MiniBoard } from "../board/mini-board";
import { getSample } from "../claude";
import { describeError } from "../coach/errors";
import {
  type GameReview,
  KIND_LABEL,
  applyCoachAnswer,
  betterText,
  engineReview,
  happenedText,
  moveNumber,
  parseReviewAnswer,
  turningPoints,
} from "../coach/review";
import { ReviewStopped, analyseGame } from "../coach/review-analysis";
import { MAX_REVIEW_MOVES } from "../coach/call";
import { isUsageLimit, usageGuard } from "../coach/usage";
import type { StockfishEngine } from "../engine/stockfish";
import type { Analysis } from "../engine/uci";
import { knowledge } from "../kb/book";
import { keyQuery } from "../kb/contexts";
import type { KbEntry } from "../kb/entry";
import { diagCounter, reuseNote } from "../kb/reuse-ui";
import type { Color } from "../game/game-state";
import type { PracticeGame } from "./practice-game";

/** The finished game a review card is about. */
export interface ReviewSubject {
  /** Changes whenever the game does (a take back, another game): the review starts over. */
  key: string;
  moves: readonly string[];
  playerColor: Color;
  /** "2 (Beginner)", for the coach's prompt. */
  levelLabel: string;
  /** How the game ended, from the player's side. */
  result: string;
  /** A review saved earlier, shown straight away. */
  saved?: GameReview;
}

export interface ReviewHost {
  /** The game to review; null hides the card. */
  subject(): ReviewSubject | null;
  /** Called with each new state of the review (the engine's, then the coach's wording). */
  onReviewed?(key: string, review: GameReview): void;
  /** Reads a finished review aloud (CC-032); the practice card only. */
  say?(text: string): void;
  stopReading?(): void;
}

/** The subject for a practice game: only once it is over and the player has moved. */
export function practiceSubject(p: PracticeGame | null): ReviewSubject | null {
  if (!p?.isOver || !p.playerMoved) return null;
  return {
    key: `${p.id}|${p.game.moves.join(" ")}|${p.resigned}`,
    moves: [...p.game.moves],
    playerColor: p.playerColor,
    levelLabel: `${p.level.id} (${p.level.name})`,
    result: p.statusLine(),
  };
}

/** The coach has already worded `r`, or there is nothing for it to word. */
const PAUSED_NOTE = "The engine's review is shown. The coach is paused by your usage limit.";

const coachFinished = (r: GameReview) =>
  !r.points.length || r.lessonBy === "coach" || r.points.some((t) => t.whyBy === "coach");

/**
 * Mounts a review card. `card` holds the elements by class (review-start,
 * review-stop, review-status, review-summary, review-points, review-lesson,
 * review-lesson-text), so the card can appear more than once on the page.
 */
let cardCount = 0;

export function mountReviewPanel(engine: StockfishEngine, card: HTMLElement, host: ReviewHost) {
  const $ = <T extends HTMLElement>(cls: string) => card.querySelector(`.${cls}`) as T;
  const startBtn = $<HTMLButtonElement>("review-start");
  const stopBtn = $<HTMLButtonElement>("review-stop");
  const status = $<HTMLParagraphElement>("review-status");
  const summary = $<HTMLParagraphElement>("review-summary");
  const list = $<HTMLOListElement>("review-points");
  const lessonBox = $<HTMLDivElement>("review-lesson");
  const lessonText = $<HTMLParagraphElement>("review-lesson-text");

  const diagCount = diagCounter(status, `review-diag-count-${cardCount++}`, () =>
    knowledge.diagLine("Reviews", "review"),
  );
  /** The mark on a review shown from an earlier answer. */
  let reuseEl: HTMLElement | null = null;

  let sample: SampleFn | null = null;
  let connecting = true;
  /** The finished game the review belongs to; a take back or another game clears it. */
  let key = "";
  let subject: ReviewSubject | null = null;
  let review: GameReview | null = null;
  /** The engine-only review of this game: the base for every coach prompt and every check, so saved coach text is never fed back. */
  let engineBase: GameReview | null = null;
  /** The engine's view of every position of this game, which the coach is sent. */
  let analysesOf: Analysis[] | null = null;
  /** The coach has worded this review: no second call for the same game. */
  let coachDone = false;
  let ctl: AbortController | null = null;
  let boards: MiniBoard[] = [];

  function setStatus(text: string, tone: "info" | "ok" | "warn" = "info") {
    status.textContent = text;
    status.dataset.tone = tone;
  }

  function clear() {
    reuseEl?.remove();
    reuseEl = null;
    for (const b of boards) b.destroy();
    boards = [];
    list.replaceChildren();
    summary.textContent = "";
    lessonBox.hidden = true;
  }

  /** Call after anything changes on the board. */
  function sync() {
    const next = host.subject();
    const k = next?.key ?? "";
    if (k !== key) {
      key = k;
      subject = next;
      ctl?.abort();
      ctl = null;
      review = next?.saved ?? null;
      engineBase = review && !coachWorded(review) ? review : null;
      analysesOf = null;
      coachDone = review ? coachFinished(review) : false;
      clear();
      // Opened during a pause: say here why the coach waits (the banner may be out of view).
      setStatus(review && !coachDone && sample && usageGuard.paused ? PAUSED_NOTE : "");
    }
    card.hidden = !next;
    // The boards measure themselves, so a saved review is drawn once the card shows.
    if (subject && review && !list.childElementCount && !summary.textContent) {
      render(subject, review);
    }
    const running = !!ctl;
    const coachMissing = !connecting && !sample;
    // Once the review is shown, the button only asks the coach (again).
    startBtn.hidden = coachDone || (!!review && coachMissing);
    startBtn.textContent = review ? "Ask the coach to explain" : "Review this game";
    // A usage limit pauses the coach: the engine's review still runs, the coach waits.
    const paused = !!review && usageGuard.paused;
    startBtn.disabled = running || (!!review && connecting) || paused;
    stopBtn.hidden = !running;
  }

  function render(p: ReviewSubject, r: GameReview) {
    clear();
    const n = r.points.length;
    summary.textContent =
      n === 0
        ? `${r.result} No turning points: the engine found no real mistakes in your moves.`
        : n < 3
          ? `${r.result} Only ${n} turning point${n === 1 ? "" : "s"} in this game:`
          : `${r.result} The ${n} moments that decided the game:`;
    for (const t of r.points) {
      const li = document.createElement("li");
      li.dataset.kind = t.kind;
      li.dataset.ply = String(t.ply);
      const h = document.createElement("h4");
      h.textContent = `${moveNumber(t.ply)} ${t.playedSan}: ${KIND_LABEL[t.kind]}`;
      const board = document.createElement("div");
      board.className = "review-board";
      board.setAttribute("role", "img");
      board.setAttribute(
        "aria-label",
        t.kind === "spotted" || t.isBest
          ? `The position before ${t.playedSan}, with an arrow for your move.`
          : `The position before ${t.playedSan}: a red arrow for your move, a green one for ${t.bestSan}.`,
      );
      const texts = document.createElement("div");
      texts.className = "review-texts";
      const line = (label: string, text: string, cls: string) => {
        const para = document.createElement("p");
        para.className = cls;
        const b = document.createElement("strong");
        b.textContent = `${label} `;
        para.append(b, text);
        return para;
      };
      texts.append(
        h,
        line("What happened:", happenedText(t), "review-happened"),
        line(
          t.kind === "spotted" ? "The engine's view:" : "Better:",
          betterText(t),
          "review-better",
        ),
        line("Why:", t.why, "review-why"),
      );
      li.append(board, texts);
      list.append(li);
    }
    lessonText.textContent = r.lesson;
    lessonBox.hidden = false;
    // The boards measure themselves, so they are drawn once on the page.
    const orientation = p.playerColor;
    for (const [i, li] of [...list.children].entries()) {
      const t = r.points[i]!;
      const arrows =
        t.kind === "spotted" || t.isBest
          ? [{ uci: t.playedUci, brush: "green" as const }]
          : [
              { uci: t.playedUci, brush: "red" as const },
              { uci: t.bestUci, brush: "green" as const },
            ];
      boards.push(
        mountMiniBoard(
          li.querySelector<HTMLElement>(".review-board")!,
          t.fenBefore,
          orientation,
          arrows,
        ),
      );
    }
  }

  const coachWorded = (r: GameReview) =>
    r.lessonBy === "coach" || r.points.some((t) => t.whyBy === "coach");

  function showReuse(entry: KbEntry) {
    reuseEl = reuseNote({
      onAnyway: () => {
        if (ctl) return;
        coachDone = false;
        void run(true);
      },
      onDown: () => knowledge.feedback(entry, { vote: -1 }),
    }).el;
    status.after(reuseEl);
  }

  /** The whole review as one text to read aloud, once it is final. */
  function speak(r: GameReview) {
    if (!host.say) return;
    const parts = [summary.textContent ?? ""];
    for (const t of r.points) {
      parts.push(
        `${moveNumber(t.ply)} ${t.playedSan}: ${KIND_LABEL[t.kind]}.`,
        `What happened: ${happenedText(t)}`,
        `${t.kind === "spotted" ? "The engine's view" : "Better"}: ${betterText(t)}`,
        `Why: ${t.why}`,
      );
    }
    parts.push(`The lesson: ${r.lesson}`);
    host.say(parts.map((p) => (/[.!?]$/.test(p.trim()) ? p : `${p}.`)).join(" "));
  }

  /** `fresh`: skip a saved review (Ask the coach anyway). */
  async function run(fresh = false) {
    const p = subject;
    if (!p || ctl) return;
    const k = key;
    const c = new AbortController();
    ctl = c;
    sync();
    stopBtn.focus();
    const moves = [...p.moves];
    try {
      if (!review) {
        const analyses = await analyseGame(engine, moves, {
          signal: c.signal,
          onProgress: (done, total) =>
            setStatus(
              `The engine is checking the game: position ${Math.min(done + 1, total)} of ${total}…`,
            ),
        });
        if (c.signal.aborted || key !== k) return;
        const points = turningPoints(moves, analyses, p.playerColor === "white" ? 0 : 1);
        review = engineReview(p.result, points);
        engineBase = review;
        analysesOf = analyses;
        render(p, review);
        host.onReviewed?.(k, review);
      }
      // Nothing to explain: the engine's short note and lesson do, without a coach call.
      if (!review.points.length) {
        coachDone = true;
        setStatus("");
        speak(review);
        return;
      }
      // The same game at the same level gets its saved review, no coach call.
      const query = keyQuery("review", `${moves.join(" ")}|${p.playerColor}|${p.levelLabel}`);
      if (!fresh) {
        await knowledge.load("review", query.group);
        if (c.signal.aborted || key !== k) return;
        const m = knowledge.find(query);
        const worded =
          m.kind === "close"
            ? applyCoachAnswer(
                engineBase ?? review,
                parseReviewAnswer(m.entry.answer),
                false,
                moves,
              )
            : null;
        // A saved review is checked against the engine again, like a new one.
        if (m.kind === "close" && worded && coachWorded(worded)) {
          review = worded;
          coachDone = true;
          host.onReviewed?.(k, worded);
          render(p, worded);
          showReuse(m.entry);
          knowledge.feedback(m.entry, "reused");
          diagCount();
          speak(worded);
          setStatus("");
          return;
        }
      }
      if (usageGuard.paused) {
        setStatus(PAUSED_NOTE);
        speak(review);
        return;
      }
      if (!sample) {
        speak(review);
        setStatus(
          connecting
            ? "The engine's review is shown. The coach is still connecting: ask it to explain in a moment."
            : "The engine's review is shown. The coach isn't available right now.",
        );
        return;
      }
      if (moves.length > MAX_REVIEW_MOVES) {
        speak(review);
        setStatus("This game is too long for the coach to review. The engine's review is shown.");
        return;
      }
      // A review opened from the past has no analysis in memory: the coach needs the engine's
      // view of each position, so the game is checked again.
      analysesOf ??= await analyseGame(engine, moves, {
        signal: c.signal,
        onProgress: (done, total) =>
          setStatus(
            `The engine is checking the game: position ${Math.min(done + 1, total)} of ${total}…`,
          ),
      });
      if (c.signal.aborted || key !== k) return;
      setStatus("The coach is writing the review…");
      const result = await sample(
        {
          purpose: "review",
          moves,
          analyses: analysesOf,
          playerFirst: p.playerColor === "white" ? 0 : 1,
          result: p.result,
          player: p.playerColor,
          level: p.levelLabel,
          ...(fresh && { fresh: true }),
        },
        { signal: c.signal },
      );
      if (c.signal.aborted || key !== k) return;
      const answer = parseReviewAnswer(result.text);
      const worded = applyCoachAnswer(engineBase ?? review, answer, result.truncated, moves);
      const used = coachWorded(worded);
      const allCoach =
        worded.lessonBy === "coach" && worded.points.every((t) => t.whyBy === "coach");
      review = worded;
      if (used) {
        host.onReviewed?.(k, worded);
        knowledge.save({
          kind: "review",
          group: query.group,
          ctx: query.ctx,
          wide: false,
          text: "",
          answer: result.text.trim(),
          meta: { level: p.levelLabel },
        });
        diagCount();
      }
      // Only an answer that was used ends the coach's part; otherwise the player may ask again.
      coachDone = used;
      render(p, worded);
      speak(worded);
      setStatus(
        allCoach
          ? ""
          : result.truncated
            ? "The coach's answer was cut off, so the engine's explanations are shown. You can ask again."
            : !answer
              ? "The coach's answer couldn't be read, so the engine's explanations are shown. You can ask again."
              : used
                ? "Some explanations come from the engine: the coach's wording was missing or didn't match the engine."
                : "None of the coach's wording matched the engine, so the engine's explanations are shown.",
      );
    } catch (err) {
      // Stopped, or the game changed: that has already said what happened.
      if (c.signal.aborted || key !== k || err instanceof ReviewStopped) return;
      const e = err as SampleError | Error;
      if ("code" in e) {
        // No retry: the engine's review stays; the player may ask again.
        const advice = describeError(e.code);
        if (advice.disable) sample = null;
        if (isUsageLimit(e.code)) usageGuard.pause();
        setStatus(
          isUsageLimit(e.code)
            ? PAUSED_NOTE
            : advice.disable
              ? `${advice.message} The engine's review is shown.`
              : "The coach couldn't write the review, so the engine's is shown. You can ask again.",
          "warn",
        );
        if (review) speak(review);
      } else {
        setStatus(`The engine couldn't check the game: ${e.message}`, "warn");
      }
    } finally {
      if (ctl === c) ctl = null;
      sync();
      if (document.activeElement === stopBtn || document.activeElement === document.body) {
        (startBtn.hidden ? card : startBtn).focus();
      }
    }
  }

  startBtn.addEventListener("click", () => void run());
  stopBtn.addEventListener("click", () => {
    ctl?.abort();
    host.stopReading?.();
    ctl = null;
    setStatus(review ? "Stopped. The engine's review is shown." : "Stopped.");
    sync();
    startBtn.focus();
  });

  usageGuard.subscribe((paused) => {
    // The note follows the pause; back from it, the coach may be asked again, by hand.
    if (review && !coachDone && !ctl && sample) setStatus(paused ? PAUSED_NOTE : "");
    sync();
  });
  sync();
  void getSample()
    .catch(() => null)
    .then((s) => {
      sample = s;
      connecting = false;
      sync();
    });

  return { sync };
}
