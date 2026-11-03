// "Talk to the coach" in the Practice coach card (CC-033). Ale speaks (the
// browser's dictation, where the browser has it, else the device's own dictation) or types; one
// Send is one request: a hint, the game review, a move to play (confirmed
// first) or a question. The answer is shown as text and read aloud only
// when "Read aloud" is on. Nothing listens on its own, and the coach is
// called only on Send, with the same fact checks as the other coach cards.
import { Chess } from "chess.js";
import { gameAt } from "../chess/notation";
import { getSample } from "../claude";
import { buildFacts } from "../coach/hint";
import { acceptPracticeAnswer } from "../coach/practice-ask";
import { isUsageLimit, usageGuard } from "../coach/usage";
import type { StockfishEngine } from "../engine/stockfish";
import type { Analysis } from "../engine/uci";
import { coachErrorText, HELD_BACK_TEXT, namedMoveFacts, parseNamedMove } from "../lessons/ask";
import { mountDictation } from "../voice/dictation-ui";
import { type Command, confirmation, normalise, parseCommand } from "../voice/command";
import { type Choice, pickChoice } from "../voice/phrasing";
import { createHandsFree, type HandsFreeState } from "../voice/hands-free";
import { isReadAloudOn, isSpeaking, onSpeaking, primeSpeech, say } from "../voice/read-aloud";
import { getPlatform } from "../platform";
import { speakable } from "../voice/speakable";
import type { PracticeGame } from "./practice-game";

const LOOK_MS = 1000;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface VoiceHost {
  practice(): PracticeGame | null;
  engineBusy(): boolean;
  /** Plays Ale's move as if dragged on the board; false when it isn't allowed. */
  playMove(from: string, to: string, promotion?: string): boolean;
}

type Pending = { key: string; move: Extract<Command, { kind: "move" }> };

export function mountVoicePanel(engine: StockfishEngine, host: VoiceHost) {
  const form = $<HTMLFormElement>("voice-form");
  const input = $<HTMLInputElement>("voice-input");
  const sendBtn = $<HTMLButtonElement>("voice-send");
  const confirmBox = $<HTMLDivElement>("voice-confirm");
  const confirmText = $<HTMLParagraphElement>("voice-confirm-text");
  const status = $<HTMLParagraphElement>("voice-status");
  const answerBox = $<HTMLDivElement>("voice-answer");
  const answerQ = $<HTMLParagraphElement>("voice-answer-q");
  const answerText = $<HTMLParagraphElement>("voice-answer-text");

  let pending: Pending | null = null;
  /** Moves offered by "which one?", waiting for the answer. */
  let choices: { key: string; list: Choice[] } | null = null;
  let asking = false;
  /** Bumped on a new request or position, so a late answer is dropped. */
  let generation = 0;

  const keyOf = (p: PracticeGame) => `${p.game.moves.join(" ")}|${p.resigned}`;
  const setStatus = (text: string, tone: "info" | "ok" | "warn" = "info") => {
    status.textContent = text;
    status.dataset.tone = tone;
  };

  const dictation = mountDictation(input, setStatus);

  function clearConfirm() {
    pending = null;
    confirmBox.hidden = true;
  }

  /** Call after anything changes on the board: a move waiting for "yes" no longer applies. */
  function sync() {
    const p = host.practice();
    if (pending && (!p || keyOf(p) !== pending.key)) clearConfirm();
    if (choices && (!p || keyOf(p) !== choices.key)) choices = null;
    if (!p) {
      generation++;
      asking = false;
      answerBox.hidden = true;
      setStatus("");
    }
    sendBtn.disabled = asking;
  }

  /** Replies in the status line and, when this browser has a voice, aloud. */
  function reply(text: string, tone: "info" | "ok" | "warn" = "info") {
    setStatus(text, tone);
    say(text);
  }

  function clickIfReady(id: string, notReady: string, started: string) {
    const btn = $<HTMLButtonElement>(id);
    // Its whole card may be hidden (no review before the game is over).
    if (btn.disabled || !btn.getClientRects().length) return reply(notReady, "warn");
    setStatus(started);
    btn.click();
  }

  function proposeMove(p: PracticeGame, cmd: Extract<Command, { kind: "move" }>) {
    pending = { key: keyOf(p), move: cmd };
    const words = speakable(cmd.san);
    confirmText.textContent = `Play ${cmd.san}?`;
    confirmBox.hidden = false;
    setStatus("");
    say(`Play ${words}? Say yes, or press Play it.`);
    $<HTMLButtonElement>("voice-yes").focus();
  }

  function confirmMove() {
    const p = host.practice();
    const m = pending;
    if (!p || !m || keyOf(p) !== m.key) return clearConfirm();
    clearConfirm();
    if (!p.isPlayerTurn || host.engineBusy()) return reply("It isn't your turn yet.", "warn");
    if (!host.playMove(m.move.from, m.move.to, m.move.promotion)) {
      return reply("That move isn't allowed.", "warn");
    }
    setStatus(`Played ${m.move.san}.`, "ok");
    input.focus();
  }

  async function question(p: PracticeGame, text: string) {
    if (usageGuard.paused) return reply(coachErrorText("rate_limited", "Try again later."), "warn");
    const gen = ++generation;
    asking = true;
    sync();
    answerQ.textContent = `You asked: ${text}`;
    answerText.textContent = "The coach is looking at the position…";
    answerBox.hidden = false;
    setStatus("");
    const dropped = () => gen !== generation;
    let stage: "engine" | "coach" = "engine";
    try {
      const sample = await getSample();
      if (dropped()) return;
      if (!sample) {
        answerText.textContent = "The coach isn't available here.";
        return;
      }
      const position = { moves: [...p.game.moves] };
      await engine.start();
      const game = gameAt(position);
      const analysis = await engine.analyse(position, { movetime: LOOK_MS });
      const facts = buildFacts(game, analysis);
      if (dropped()) return;
      const san = parseNamedMove(text, game);
      let named = null;
      let namedCall: { san: string; after: Analysis } | undefined;
      if (san) {
        const mv = gameAt(position).move(san);
        const after = { moves: [...position.moves, mv.from + mv.to + (mv.promotion ?? "")] };
        const afterAnalysis = await engine.analyse(after, { movetime: LOOK_MS });
        named = namedMoveFacts(position, san, afterAnalysis);
        namedCall = { san, after: afterAnalysis };
        if (dropped()) return;
      }
      stage = "coach";
      answerText.textContent = "The coach is writing…";
      const r = await sample({
        purpose: "ask",
        position,
        analysis,
        question: text,
        ...(namedCall && { named: namedCall }),
      });
      if (dropped()) return;
      const answer = r.text.trim();
      if (acceptPracticeAnswer(answer, r.truncated, position, facts, named)) {
        answerText.textContent = answer;
        say(answer);
      } else answerText.textContent = HELD_BACK_TEXT;
    } catch (err) {
      if (dropped()) return;
      const code = (err as { code?: string }).code;
      if (isUsageLimit(code)) usageGuard.pause();
      answerText.textContent =
        stage === "coach"
          ? coachErrorText(code, "Try again.")
          : `The engine couldn't look at the position: ${(err as Error).message}`;
    } finally {
      if (!dropped()) {
        asking = false;
        sync();
      }
    }
  }

  /** One request, from the box or from voice chat. Resolves when the coach has answered. */
  async function run(text: string): Promise<void> {
    const p = host.practice();
    if (!p || !text) return;
    if (asking) return setStatus("The coach is still answering. Send again in a moment.", "warn");
    const answerTo = pending ? confirmation(text) : null;
    if (answerTo) {
      input.value = "";
      if (answerTo === "yes") return confirmMove();
      clearConfirm();
      return reply("Cancelled. Nothing was played.");
    }
    clearConfirm();
    const offered = choices && choices.key === keyOf(p) ? choices.list : null;
    choices = null;
    const picked = offered ? pickChoice(normalise(text), offered) : null;
    if (picked) {
      input.value = "";
      if (p.isOver || !p.isPlayerTurn || host.engineBusy()) {
        return reply("It isn't your turn, so I can't play a move.", "warn");
      }
      return proposeMove(p, { kind: "move", ...picked });
    }
    const cmd = parseCommand(text, new Chess(gameAt({ moves: [...p.game.moves] }).fen()));
    input.value = "";
    switch (cmd.kind) {
      case "empty":
        return;
      case "hint":
        return clickIfReady(
          "hint-next",
          "I can't give a hint right now. Wait for your turn.",
          "Asking for a hint…",
        );
      case "review":
        return clickIfReady(
          "review-start",
          "The review is ready once the game is over.",
          "Starting the review…",
        );
      case "bad-move":
        return reply(cmd.reason, "warn");
      case "which":
        if (p.isOver || !p.isPlayerTurn || host.engineBusy()) {
          return reply("It isn't your turn, so I can't play a move.", "warn");
        }
        choices = { key: keyOf(p), list: cmd.choices };
        return reply(cmd.question);
      case "move":
        if (p.isOver || !p.isPlayerTurn || host.engineBusy()) {
          return reply("It isn't your turn, so I can't play a move.", "warn");
        }
        return proposeMove(p, cmd);
      case "question":
        return question(p, cmd.text);
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    primeSpeech();
    dictation.stop();
    const text = input.value.trim();
    const request = run(text);
    // A request typed while voice chat is on: wait for its answer, then listen again.
    if (text) handsFree?.hold(request);
  });

  $("voice-yes").addEventListener("click", confirmMove);
  $("voice-no").addEventListener("click", () => {
    clearConfirm();
    reply("Cancelled. Nothing was played.");
    input.focus();
  });

  // Voice chat (CC-039b): the switch, the line saying what it is doing, and the loop itself.
  const chatToggle = $<HTMLInputElement>("voice-chat-toggle");
  const chatLabel = $<HTMLLabelElement>("voice-chat-label");
  const chatState = $<HTMLParagraphElement>("voice-chat-state");
  const micBtn = $<HTMLButtonElement>("voice-mic");
  const STATE_TEXT: Record<HandsFreeState, string> = {
    off: "",
    listening: "Listening… say your move or question.",
    working: "Thinking…",
    speaking: "The coach is speaking…",
  };
  const chatDictation = getPlatform().voice().dictation();
  const practiceScreen = document.getElementById("practice-screen");
  const handsFree = chatDictation
    ? createHandsFree({
        dictation: chatDictation,
        speaking: isSpeaking,
        onSpeaking,
        busy: () => asking || !$("hint-stop").hidden || !$("review-stop").hidden,
        visible: () => !document.hidden && !practiceScreen?.hidden && host.practice() !== null,
        submit: (text) => {
          setStatus(`Heard: ${text}`);
          input.value = "";
          return run(text);
        },
        showText: (text) => void (input.value = text.slice(0, input.maxLength)),
        onState: (state) => {
          chatState.textContent = STATE_TEXT[state];
          chatState.hidden = state === "off";
          chatToggle.checked = state !== "off";
          micBtn.disabled = state !== "off";
        },
        onStopped: (text) => setStatus(text, "warn"),
      })
    : null;
  if (handsFree) {
    chatLabel.hidden = false;
    chatToggle.addEventListener("change", () => {
      if (!chatToggle.checked) return handsFree.stop();
      // A tap: lets the phone listen and speak for the rest of the chat.
      primeSpeech();
      dictation.stop();
      setStatus(isReadAloudOn() ? "" : "Read aloud is off, so answers will show as text only.");
      handsFree.start();
    });
    // Going to the Lessons screen ends voice chat at once.
    if (practiceScreen) {
      new MutationObserver(() => {
        if (practiceScreen.hidden) handsFree.stop("hidden");
      }).observe(practiceScreen, { attributes: true, attributeFilter: ["hidden"] });
    }
    // A phone that puts the page in the background stops listening: don't carry on later.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) handsFree.stop("hidden");
    });
  }

  return {
    sync() {
      sync();
      if (!host.practice()) handsFree?.stop();
    },
  };
}
