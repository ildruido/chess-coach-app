// Running commentary during a practice game: when switched on, one line after
// each of the player's moves. The engine decides the verdict (good move,
// inaccuracy, mistake, missed chance); the coach only says why, in one quick
// call per move, and only for moves that weren't good. The engine's searches
// for it run in the background lane, so play and hints never wait for them.
import { getSample } from "../claude";
import { gameAt } from "../chess/notation";
import {
  type MoveReview,
  VERDICT_LABEL,
  acceptComment,
  bestStillThere,
  fallbackText,
  goodMoveText,
  reviewMove,
} from "../coach/commentary";
import { hintErrorMessage } from "../coach/hint";
import { isUsageLimit, usageGuard } from "../coach/usage";
import { EngineBusyError, type StockfishEngine } from "../engine/stockfish";
import type { Analysis } from "../engine/uci";
import { knowledge } from "../kb/book";
import { keyQuery } from "../kb/contexts";
import type { KbEntry } from "../kb/entry";
import { diagCounter, reuseNote } from "../kb/reuse-ui";
import { say } from "../voice/read-aloud";
import type { PracticeGame } from "./practice-game";

/** Engine time for each of the (at most two) searches behind one comment. */
const COMMENT_MOVETIME_MS = 400;
/** Candidate lines in the search before the move, so most moves are judged within it. */
const COMMENT_LINES = 4;
const ON_KEY = "chess-coach.commentary";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface CommentaryHost {
  practice(): PracticeGame | null;
}

interface Shown {
  /** Index of the player's move in the game. */
  ply: number;
  li: HTMLLIElement;
}

const PAUSED_COMMENT = "Usage limit reached: comments come from the engine.";
export function mountCommentaryPanel(engine: StockfishEngine, host: CommentaryHost) {
  const toggle = $<HTMLInputElement>("commentary-toggle");
  const status = $<HTMLParagraphElement>("commentary-status");
  const log = $<HTMLOListElement>("commentary-log");

  const diagCount = diagCounter(status, "commentary-diag-count", () =>
    knowledge.diagLine("Comments", "commentary"),
  );

  let sample: SampleFn | null = null;
  /** The game the comments belong to; another game (new or resumed) starts afresh. */
  let shownFor: PracticeGame | null = null;
  let shown: Shown[] = [];
  /** Bumped by a take back or another game: comments asked for before it are dropped. */
  let epoch = 0;
  let lastPlies = 0;
  /** The coach call in flight, if any: at most one. */
  let pending: { ctl: AbortController; finish: () => void } | null = null;

  try {
    toggle.checked = localStorage.getItem(ON_KEY) === "on";
  } catch {
    // Storage may be blocked: commentary starts off.
  }

  function setStatus(text: string) {
    status.textContent = text;
  }

  function stopPending() {
    pending?.ctl.abort();
    pending = null;
    setStatus("");
  }

  /** Call after anything changes on the board. */
  function sync() {
    const p = host.practice();
    if (p !== shownFor) {
      shownFor = p;
      shown = [];
      log.replaceChildren();
      stopPending();
      epoch++;
    }
    // A take back removes the comments on the moves it undid.
    const plies = p?.game.moves.length ?? 0;
    if (plies < lastPlies) epoch++;
    lastPlies = plies;
    for (const s of shown.filter((s) => s.ply >= plies)) s.li.remove();
    shown = shown.filter((s) => s.ply < plies);
    log.hidden = !toggle.checked;
  }

  /** Still the same game, no take back since, and commentary still on. */
  function current(p: PracticeGame, at: number) {
    return toggle.checked && host.practice() === p && epoch === at;
  }

  function show(ply: number, review: MoveReview, text: string, reused?: KbEntry) {
    const number = `${Math.floor(ply / 2) + 1}.${ply % 2 ? ".." : ""}`;
    const li = document.createElement("li");
    li.dataset.verdict = review.verdict;
    const h = document.createElement("h4");
    h.textContent = `${number} ${review.playedSan}: ${VERDICT_LABEL[review.verdict]}`;
    const para = document.createElement("p");
    para.textContent = text;
    li.append(h, para);
    if (reused) {
      li.append(
        reuseNote({
          onAnyway: () => {
            const p = host.practice();
            if (p && !pending && toggle.checked) void moved(p, ply, true);
          },
          onDown: () => knowledge.feedback(reused, { vote: -1 }),
        }).el,
      );
    }
    say(`${review.playedSan}: ${VERDICT_LABEL[review.verdict]}. ${text}`);
    for (const s of shown.filter((s) => s.ply === ply)) s.li.remove();
    shown = shown.filter((s) => s.ply !== ply);
    // Newest move first, even when an older comment arrives late.
    const below = shown.filter((s) => s.ply < ply).sort((a, b) => b.ply - a.ply)[0];
    if (below) below.li.before(li);
    else log.append(li);
    shown.push({ ply, li });
  }

  /** The player just made the move at index `ply`. `fresh`: skip saved comments (Ask the coach anyway). */
  async function moved(p: PracticeGame, ply: number, fresh = false) {
    if (!toggle.checked) return;
    const moves = p.game.moves.slice(0, ply);
    const uci = p.game.moves[ply]!;
    const at = epoch;
    let review: MoveReview | null;
    let before: Analysis;
    let after: Analysis | null;
    try {
      before = await engine.analyse(
        { moves },
        { movetime: COMMENT_MOVETIME_MS, multiPv: COMMENT_LINES, background: true },
      );
      const listed = before.lines?.some((l) => l.pv[0] === uci) || before.bestMove === uci;
      after = listed
        ? null
        : await engine.analyse(
            { moves: [...moves, uci] },
            { movetime: COMMENT_MOVETIME_MS, background: true },
          );
      review = reviewMove({ moves }, before, after, uci);
    } catch (err) {
      // The engine was needed for play or a hint: this move goes without a comment.
      if (!(err instanceof EngineBusyError) && current(p, at)) {
        setStatus("The engine couldn't judge that move.");
      }
      return;
    }
    if (!review || !current(p, at)) return;
    if (review.verdict === "good") {
      setStatus("");
      show(ply, review, goodMoveText(review));
      return;
    }
    const hide = bestStillThere(p.game.moves, p.game.turn === p.playerColor, review.bestUci);
    const fallback = fallbackText(review, hide);
    const played = gameAt({ moves: [...p.game.moves] }).history();
    // The same move in the same position with the same verdict gets its saved comment, no coach
    // call; it is checked against today's engine facts first.
    const query = keyQuery("commentary", `${moves.join(" ")}|${uci}|${review.verdict}|${hide}`);
    if (!fresh) {
      await knowledge.load("commentary", query.group);
      if (!current(p, at)) return;
      const m = knowledge.find(query);
      if (m.kind === "close" && acceptComment(m.entry.answer, false, review, hide, played)) {
        knowledge.feedback(m.entry, "reused");
        diagCount();
        setStatus("");
        show(ply, review, m.entry.answer, m.entry);
        return;
      }
    }
    // Paused by a usage limit: the engine's line, and no call (the banner says why).
    if (!sample || usageGuard.paused) {
      if (sample) setStatus(PAUSED_COMMENT);
      show(ply, review, fallback);
      return;
    }
    // A newer move's comment replaces an older one still being written.
    pending?.finish();
    const ctl = new AbortController();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      ctl.abort();
      if (pending?.ctl === ctl) pending = null;
      if (current(p, at)) show(ply, review, fallback);
    };
    pending = { ctl, finish };
    setStatus("The coach is commenting…");
    try {
      const result = await sample(
        {
          purpose: "comment",
          position: { moves },
          before,
          after,
          playedUci: uci,
          hideBest: hide,
          ...(fresh && { fresh: true }),
        },
        { signal: ctl.signal },
      );
      if (done || ctl.signal.aborted) return;
      const text = result.text.trim();
      const ok = acceptComment(text, result.truncated, review, hide, played);
      done = true;
      if (pending?.ctl === ctl) pending = null;
      setStatus("");
      if (current(p, at)) show(ply, review, ok ? text : fallback);
      if (ok) {
        knowledge.save({
          kind: "commentary",
          group: query.group,
          ctx: query.ctx,
          wide: false,
          text: "",
          answer: text,
          meta: { verdict: review.verdict, move: review.playedSan },
        });
        diagCount();
      }
    } catch (err) {
      // Stopped (switched off, another game): it has already said what happened.
      if (done || ctl.signal.aborted) return;
      done = true;
      if (pending?.ctl === ctl) pending = null;
      // No retry: the engine's own line stands in, and the status says why.
      const code = (err as SampleError).code;
      if (hintErrorMessage(code).disable) sample = null;
      if (isUsageLimit(code)) usageGuard.pause();
      setStatus(
        !sample
          ? "The coach is off in this view, so comments come from the engine alone."
          : isUsageLimit(code)
            ? PAUSED_COMMENT
            : "The coach couldn't word that comment; the engine's verdict is shown.",
      );
      if (current(p, at)) show(ply, review, fallback);
    }
  }

  toggle.addEventListener("change", () => {
    try {
      localStorage.setItem(ON_KEY, toggle.checked ? "on" : "off");
    } catch {
      // Only a convenience; the switch still works for this visit.
    }
    // Off stops everything at once: the call in flight and any late answer.
    if (!toggle.checked) stopPending();
    sync();
  });

  usageGuard.subscribe((paused) => {
    // Back from a pause: the note about engine comments no longer applies.
    if (!paused && !pending && sample) setStatus("");
  });
  sync();
  void getSample()
    .catch(() => null)
    .then((s) => {
      sample = s;
    });

  return { sync, moved: (p: PracticeGame, ply: number) => void moved(p, ply) };
}
