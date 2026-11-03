// The coach's hints during a practice game. The engine analyses the position
// once per turn; every step (question, plan, piece, move) explains that same
// analysis. Each hint is fact-checked against the engine before it is shown,
// and only a hint that passes counts as used.
import { getSample } from "../claude";
import { gameAt } from "../chess/notation";
import {
  type EarlierHint,
  type EngineFacts,
  type HeldBack,
  type HintStage,
  buildFacts,
  engineHint,
  factCheck,
  factCheckText,
  hintErrorMessage,
} from "../coach/hint";
import { type HintMode, buttonLabel, hintOptions, stepTitle } from "../coach/hint-session";
import { isUsageLimit, usageGuard } from "../coach/usage";
import type { StockfishEngine } from "../engine/stockfish";
import type { Analysis } from "../engine/uci";
import { knowledge } from "../kb/book";
import { hintQuery } from "../kb/contexts";
import type { KbEntry } from "../kb/entry";
import { diagnosticsOn, onDiagnostics } from "../diagnostics";
import { diagCounter, reuseNote } from "../kb/reuse-ui";
import type { PracticeGame } from "./practice-game";
import { say, stopReading } from "../voice/read-aloud";

/** Engine time per hint position: strong enough to trust, quick enough to wait for. */
const HINT_MOVETIME_MS = 1000;

const PAUSED_HINT = "Usage limit reached, so this hint comes from the engine.";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface HintHost {
  practice(): PracticeGame | null;
  /** True while the engine is choosing its move. */
  engineBusy(): boolean;
  /** A hint was recorded in the game; save it. */
  onHintUsed(): void;
}

export function mountHintPanel(engine: StockfishEngine, host: HintHost) {
  const nextBtn = $<HTMLButtonElement>("hint-next");
  const anotherBtn = $<HTMLButtonElement>("hint-another");
  const stopBtn = $<HTMLButtonElement>("hint-stop");
  const status = $<HTMLParagraphElement>("hint-status");
  const log = $<HTMLOListElement>("hint-log");
  const modeInputs = [...document.querySelectorAll<HTMLInputElement>('input[name="hint-mode"]')];

  let sample: SampleFn | null = null;
  let connecting = true;
  /** The position the hints below belong to; a new position starts afresh. */
  let key = "";
  let given: EarlierHint[] = [];
  /** The last hint the check held back in this position, by step: the next try avoids its slip. */
  let heldBack: { stage: HintStage; hint: HeldBack } | null = null;
  let facts: { key: string; promise: Promise<{ f: EngineFacts; analysis: Analysis }> } | null =
    null;
  let ctl: AbortController | null = null;
  /** The game the log was last filled for; a different one (a resumed game) restores its steps. */
  let shownFor: PracticeGame | null = null;

  /** Chosen in the game setup and fixed for the game; the card only shows it. */
  const mode = (): HintMode => host.practice()?.hintMode ?? "tell";

  /** Diagnostics: the hint that was held back and the rule that caught it. */
  let note: HTMLParagraphElement | null = null;
  function diagNote(text: string) {
    if (!note) {
      note = document.createElement("p");
      note.id = "hint-diag-note";
      note.className = "diag-note";
      status.after(note);
    }
    note.textContent = text;
    note.hidden = !diagnosticsOn();
  }
  onDiagnostics(() => {
    if (note) note.hidden = !diagnosticsOn();
  });

  function setStatus(text: string, tone: "info" | "ok" | "warn" = "info") {
    status.textContent = text;
    status.dataset.tone = tone;
  }

  function positionKey(p: PracticeGame | null): string {
    return p ? `${p.game.moves.join(" ")}|${p.resigned}` : "";
  }

  /** Call after anything changes on the board. */
  function update() {
    const p = host.practice();
    const k = positionKey(p);
    if (k !== key) {
      key = k;
      given = [];
      heldBack = null;
      ctl?.abort();
      ctl = null;
      log.replaceChildren();
      note?.remove();
      note = null;
      if (!connecting && sample) setStatus("");
      // After a reload the hint texts are gone, but the steps carry on where they were.
      if (p && p !== shownFor) {
        for (const stage of p.hintsHere()) {
          show(stage, "Given before the page was reloaded.", [...given.map((h) => h.stage), stage]);
          given.push({ stage, text: "" });
        }
      }
      shownFor = p;
    }
    for (const i of modeInputs) i.checked = i.value === mode();
    const running = !!ctl;
    const steps = given.map((h) => h.stage);
    const opts = hintOptions(steps, mode());
    // While a usage limit pauses the coach, hints still come from the engine.
    const ready =
      (!!sample || usageGuard.paused) && !!p?.isPlayerTurn && !host.engineBusy() && !running;
    nextBtn.textContent = buttonLabel(opts.primary);
    nextBtn.disabled = !ready || !opts.primary;
    anotherBtn.hidden = !opts.another;
    anotherBtn.disabled = !ready;
    stopBtn.hidden = !running;
    nextBtn.dataset.step = opts.primary ?? "";
  }

  function factsFor(p: PracticeGame, k: string): Promise<{ f: EngineFacts; analysis: Analysis }> {
    if (facts?.key !== k) {
      const moves = [...p.game.moves];
      const promise = engine
        .analyse({ moves }, { movetime: HINT_MOVETIME_MS })
        .then((a) => ({ f: buildFacts(gameAt({ moves }), a), analysis: a }));
      promise.catch(() => {
        if (facts?.promise === promise) facts = null;
      });
      facts = { key: k, promise };
    }
    return facts.promise;
  }

  const diagCount = diagCounter(status, "hint-diag-count", () =>
    knowledge.diagLine("Hints", "hint"),
  );

  function show(stage: HintStage, text: string, steps: HintStage[]) {
    // Only the latest reused hint can be asked again.
    for (const old of log.querySelectorAll(".reuse-note")) old.remove();
    const li = document.createElement("li");
    li.dataset.step = stage;
    const h = document.createElement("h4");
    h.textContent = stepTitle(stage, steps);
    const para = document.createElement("p");
    para.textContent = text;
    li.append(h, para);
    log.append(li);
    return li;
  }

  /** Shows a saved hint: no coach call. */
  function reuse(p: PracticeGame, stage: HintStage, entry: KbEntry, counted?: boolean) {
    given.push({ stage, text: entry.answer });
    heldBack = null;
    const li = show(
      stage,
      entry.answer,
      given.map((g) => g.stage),
    );
    li.append(
      reuseNote({
        onAnyway: () => {
          if (ctl || key !== positionKey(host.practice())) return;
          const kept = given.pop();
          li.remove();
          const before = given.length;
          void hint(stage, { fresh: true, counted: true }).then(() => {
            // The new hint failed or was stopped: the player keeps the one they had.
            if (kept && given.length === before && key === positionKey(host.practice())) {
              given.push(kept);
              log.append(li);
            }
          });
        },
        onDown: () => knowledge.feedback(entry, { vote: -1 }),
      }).el,
    );
    say(entry.answer);
    if (!counted) {
      p.recordHint(stage);
      host.onHintUsed();
    }
    knowledge.feedback(entry, "reused");
    diagCount();
    setStatus("", "info");
  }

  /** `fresh`: skip saved hints (Ask the coach anyway). `counted`: the step is already in the game's record. */
  async function hint(stage: HintStage, opts: { fresh?: boolean; counted?: boolean } = {}) {
    const p = host.practice();
    if ((!sample && !usageGuard.paused) || !p?.isPlayerTurn || ctl) return;
    const k = key;
    const c = new AbortController();
    // Keep keyboard focus on the hint controls while the buttons change.
    const refocus = [nextBtn, anotherBtn].includes(document.activeElement as HTMLButtonElement);
    ctl = c;
    update();
    if (refocus) stopBtn.focus();
    setStatus("The coach is looking at the position…");
    note?.remove();
    note = null;
    try {
      const { f, analysis } = await factsFor(p, k);
      if (c.signal.aborted) return;
      const allowed = [...gameAt({ moves: [...p.game.moves] }).history(), ...f.lineSans];
      // The same hint for the same position and step is shown again, with no coach call
      // (a second "another hint" always asks).
      const query = hintQuery(
        p.game.moves,
        stage,
        given.map((g) => g.stage),
        f.bestMove ?? "none",
      );
      const again = stage === "question" && given.some((g) => g.stage === "question");
      if (!opts.fresh && !again) {
        await knowledge.load("hint", query.group);
        if (c.signal.aborted || key !== k) return;
        const m = knowledge.find(query);
        if (m.kind === "close") {
          const fc = factCheck(m.entry.answer, stage, f, allowed);
          // A saved hint is checked against today's engine facts like a new one.
          if (!fc.unknownMoves.length && !fc.revealedMove) {
            reuse(p, stage, m.entry, opts.counted);
            return;
          }
        }
      }
      if (usageGuard.paused || !sample) {
        // No coach call: the engine's plain hint, checked like any other (CC-016).
        const plain = engineHint(f, stage, again);
        if (!plain || factCheck(plain, stage, f, allowed).revealedMove) {
          // Rare: skip this step rather than offer it again and again. Not counted as used.
          given.push({ stage, text: "" });
          show(
            stage,
            "The engine has no plain hint for this step. Ask for the next one.",
            given.map((g) => g.stage),
          );
          setStatus(PAUSED_HINT, "info");
          return;
        }
        given.push({ stage, text: plain });
        heldBack = null;
        show(
          stage,
          plain,
          given.map((g) => g.stage),
        );
        say(plain);
        if (!opts.counted) {
          p.recordHint(stage);
          host.onHintUsed();
        }
        setStatus(PAUSED_HINT, "info");
        return;
      }
      setStatus("The coach is writing…");
      const avoid = heldBack?.stage === stage ? heldBack.hint : undefined;
      const result = await sample(
        {
          purpose: "hint",
          position: { moves: [...p.game.moves] },
          analysis,
          stage,
          earlier: given,
          ...(avoid && { heldBack: avoid }),
          ...(opts.fresh && { fresh: true }),
        },
        { signal: c.signal },
      );
      if (c.signal.aborted || key !== k) return;
      const text = result.text.trim();
      const fc = factCheck(text, stage, f, allowed);
      // Never show a hint that disagrees with the engine or gives too much away.
      const rejected = !text
        ? "The coach couldn't write this hint. Try again."
        : fc.unknownMoves.length
          ? "That hint named a move the engine didn't give, so it isn't shown. Ask again."
          : fc.revealedMove
            ? "That hint gave away too much too early, so it isn't shown. Ask again."
            : null;
      let shown = text;
      let status = result.truncated ? "The hint was cut short." : "";
      if (rejected) {
        // A second slip on the same step: a plainer hint from the engine's facts, so the
        // player can always go on (CC-023). The first time, the player may ask again.
        const plain = heldBack?.stage === stage ? engineHint(f, stage, again) : "";
        const plainOk = !!plain && !factCheck(plain, stage, f, allowed).revealedMove;
        if (diagnosticsOn()) diagNote(`Held back (${stage}): ${factCheckText(fc, stage)}\n${text}`);
        if (!plainOk) {
          heldBack = { stage, hint: { text, ...(fc.leak && { leak: fc.leak }) } };
          setStatus(rejected, "warn");
          return;
        }
        shown = plain;
        status = "The coach's wording was held back again, so this hint comes from the engine.";
      }
      given.push({ stage, text: shown });
      heldBack = null;
      show(
        stage,
        shown,
        given.map((g) => g.stage),
      );
      say(shown);
      if (!opts.counted) {
        p.recordHint(stage);
        host.onHintUsed();
      }
      // Only the coach's own checked hint is kept for next time, never the engine's stand-in.
      if (shown === text) {
        knowledge.save({
          kind: "hint",
          group: query.group,
          ctx: query.ctx,
          wide: false,
          text: "",
          answer: shown,
          meta: { stage, bestMove: f.bestMove },
        });
        diagCount();
      }
      setStatus(status, "info");
    } catch (err) {
      // A stopped or outdated hint has already said what happened.
      if (key !== k || c.signal.aborted) return;
      const e = err as SampleError | Error;
      if ("code" in e) {
        const advice = hintErrorMessage(e.code);
        if (isUsageLimit(e.code)) {
          // The page-wide note says why; the next hint comes from the engine.
          usageGuard.pause();
          setStatus("Usage limit reached: ask again for a hint from the engine.", "warn");
          return;
        }
        setStatus(advice.message, "warn");
        if (advice.disable) sample = null;
      } else {
        setStatus(`The engine couldn't look at the position: ${e.message}`, "warn");
      }
    } finally {
      if (ctl === c) ctl = null;
      update();
      const lost = document.activeElement === document.body || document.activeElement === stopBtn;
      if (refocus && lost && !ctl && !c.signal.aborted) {
        [nextBtn, anotherBtn].find((b) => !b.hidden && !b.disabled)?.focus();
      }
    }
  }

  nextBtn.addEventListener("click", () => {
    const step = hintOptions(
      given.map((h) => h.stage),
      mode(),
    ).primary;
    if (step) void hint(step);
  });
  anotherBtn.addEventListener("click", () => void hint("question"));
  stopBtn.addEventListener("click", () => {
    // Hint comes back at once, even if a late answer is still on its way (it is ignored).
    ctl?.abort();
    stopReading();
    ctl = null;
    update();
    setStatus("Stopped.");
    nextBtn.focus();
  });
  usageGuard.subscribe((paused) => {
    // Back from a pause: the old note about the engine's hints no longer applies.
    if (!paused && !ctl && sample) setStatus("");
    update();
  });
  update();
  setStatus("Connecting to your coach…");
  void getSample()
    .catch(() => null)
    .then((s) => {
      sample = s;
      connecting = false;
      setStatus(
        s ? "" : "Hints from your coach aren't available right now. Reload the page to try again.",
        s ? "info" : "warn",
      );
      update();
    });

  return { update };
}
