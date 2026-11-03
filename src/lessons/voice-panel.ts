// "Talk to the coach" in a lesson (CC-057). The same free browser speech as Practice:
// Ale speaks (or types) and presses Send, or switches on Voice chat. One request is a
// move to play (confirmed first), "next", "hint", "try again", "repeat", or a question
// for the Ask the coach area, whose answer is then read aloud. Nothing listens on its
// own and the coach is called only for a spoken or typed question.
import { type Command, confirmation, normalise } from "../voice/command";
import { mountDictation } from "../voice/dictation-ui";
import { createHandsFree, type HandsFreeState } from "../voice/hands-free";
import { type Choice, pickChoice } from "../voice/phrasing";
import {
  isReadAloudOn,
  isSpeaking,
  onSpeaking,
  primeSpeech,
  say,
  stopReading,
} from "../voice/read-aloud";
import { speakable } from "../voice/speakable";
import { getPlatform } from "../platform";
import { WORKING } from "./ask-panel";
import { parseLessonCommand } from "./voice-command";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** How often, and for how long, to wait for a played move to be judged before reading the result. */
const POLL_MS = 200;
const SETTLE_POLLS = 3;
const GIVE_UP_MS = 20_000;

/** The position Ale can move in right now. `key` changes whenever the board does. */
export interface MovePosition {
  fen: string;
  key: string;
}

export interface LessonVoiceHost {
  /** True while a lesson step is open. */
  active(): boolean;
  /** Null when no move can be made now (not an exercise, not Ale's turn, board busy). */
  movePosition(): MovePosition | null;
  /** Plays the move as if dragged on the board. */
  playMove(from: string, to: string, promotion?: string): void;
  /** True while a move is being checked or the opponent is answering. */
  boardBusy(): boolean;
  /** What the step says now (or the warning under it), to read aloud. */
  readText(): string;
  /** Asks the coach by voice; resolves when answered. */
  askAloud(question: string, speak: (text: string) => void): Promise<string | null>;
}

type Pending = { key: string; move: Extract<Command, { kind: "move" }> };

export function mountLessonVoice(host: LessonVoiceHost) {
  const form = $<HTMLFormElement>("lesson-voice-form");
  const input = $<HTMLInputElement>("lesson-voice-input");
  const sendBtn = $<HTMLButtonElement>("lesson-voice-send");
  const confirmBox = $<HTMLDivElement>("lesson-voice-confirm");
  const confirmText = $<HTMLParagraphElement>("lesson-voice-confirm-text");
  const status = $<HTMLParagraphElement>("lesson-voice-status");
  const screen = $("lessons-screen");

  let pending: Pending | null = null;
  let choices: { key: string; list: Choice[] } | null = null;
  let working = false;

  const setStatus = (text: string, tone: "info" | "ok" | "warn" = "info") => {
    status.textContent = text;
    status.dataset.tone = tone;
  };
  const dictation = mountDictation(input, setStatus, {
    mic: "lesson-voice-mic",
    micNote: "lesson-voice-mic-note",
    keyboardNote: "lesson-voice-keyboard-note",
  });

  /** Reads `text` aloud when the Read aloud switch is on; otherwise everything stays text. */
  let lastSpoken = { text: "", at: 0 };
  function speak(text: string) {
    if (!host.active()) return;
    lastSpoken = { text, at: Date.now() };
    say(text, "lessons-screen");
  }
  function reply(text: string, tone: "info" | "ok" | "warn" = "info") {
    setStatus(text, tone);
    speak(text);
  }

  function clearConfirm() {
    pending = null;
    confirmBox.hidden = true;
  }

  /** Waits until the board has judged a played move, then reads what the lesson now says. */
  async function followMove() {
    const until = Date.now() + GIVE_UP_MS;
    let calm = 0;
    await new Promise((r) => setTimeout(r, POLL_MS));
    while (Date.now() < until && calm < SETTLE_POLLS) {
      calm = host.boardBusy() ? 0 : calm + 1;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    if (!host.active()) return;
    const text = host.readText();
    if (text) speak(text);
  }

  function proposeMove(key: string, cmd: Extract<Command, { kind: "move" }>) {
    pending = { key, move: cmd };
    confirmText.textContent = `Play ${cmd.san}?`;
    confirmBox.hidden = false;
    setStatus("");
    speak(`Play ${speakable(cmd.san)}? Say yes, or press Play it.`);
    $<HTMLButtonElement>("lesson-voice-yes").focus();
  }

  async function confirmMove(): Promise<void> {
    const m = pending;
    const now = host.movePosition();
    clearConfirm();
    if (!m || !now || now.key !== m.key)
      return reply("That move can't be played any more.", "warn");
    setStatus(`Played ${m.move.san}.`, "ok");
    host.playMove(m.move.from, m.move.to, m.move.promotion);
    await followMove();
  }

  /** Reads the new line of the hint log once the engine has added it (or says why not). */
  async function followHint(before: number) {
    const log = $("lesson-hint-log");
    const until = Date.now() + GIVE_UP_MS;
    while (Date.now() < until && log.children.length <= before) {
      const failed = $("lesson-hint-status").textContent ?? "";
      if (failed && !failed.startsWith("Looking")) return reply(failed, "warn");
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    const text = log.lastElementChild?.textContent;
    if (text && host.active()) speak(text);
  }

  function pressIfReady(
    id: string,
    notReady: string,
    started: string,
    follow: () => Promise<void> = followMove,
  ): Promise<void> {
    const btn = $<HTMLButtonElement>(id);
    if (btn.disabled || !btn.getClientRects().length) {
      reply(notReady, "warn");
      return Promise.resolve();
    }
    setStatus(started);
    btn.click();
    // The next step, a hint or a retry shows new text: read it once it is there.
    return follow();
  }

  /** One request, from the box or from voice chat. Resolves when it has been handled. */
  async function run(text: string): Promise<void> {
    if (!text || !host.active()) return;
    if (working)
      return setStatus("Still working on the last request. Try again in a moment.", "warn");
    working = true;
    sendBtn.disabled = true;
    try {
      await handle(text);
    } finally {
      working = false;
      sendBtn.disabled = false;
    }
  }

  async function handle(text: string): Promise<void> {
    const where = host.movePosition();
    const answerTo = pending ? confirmation(text) : null;
    if (answerTo) {
      input.value = "";
      if (answerTo === "yes") return confirmMove();
      clearConfirm();
      return reply("Cancelled. Nothing was played.");
    }
    clearConfirm();
    const offered = choices && where && choices.key === where.key ? choices.list : null;
    choices = null;
    const picked = offered ? pickChoice(normalise(text), offered) : null;
    if (picked && where) {
      input.value = "";
      return proposeMove(where.key, { kind: "move", ...picked });
    }
    const cmd = parseLessonCommand(text, where);
    input.value = "";
    switch (cmd.kind) {
      case "empty":
        return;
      case "next":
        return pressIfReady("lesson-next", "You can't go on yet. Finish this step first.", "Next…");
      case "hint": {
        const before = $("lesson-hint-log").children.length;
        return pressIfReady(
          "lesson-hint",
          "There is no hint for this step. Try asking the coach a question.",
          "Asking for a hint…",
          () => followHint(before),
        );
      }
      case "retry":
        return pressIfReady("lesson-try", "There is nothing to try again.", "Try again…");
      case "back":
        return pressIfReady("lesson-back", "You can't go back from here.", "Back…");
      case "skip":
        return pressIfReady("lesson-skip", "There is nothing to skip here.", "Skipping…");
      case "leave":
        return pressIfReady("lesson-leave", "You can't leave from here.", "Leaving…", () =>
          Promise.resolve(),
        );
      case "repeat": {
        const t = host.readText();
        return t ? reply(t) : reply("There is nothing to read here.", "warn");
      }
      case "no-move":
        return reply("There is no move to play on this step.", "warn");
      case "bad-move":
        return reply(cmd.reason, "warn");
      case "which":
        if (!where) return reply("There is no move to play on this step.", "warn");
        choices = { key: where.key, list: cmd.choices };
        return reply(cmd.question);
      case "move":
        if (!where) return reply("There is no move to play on this step.", "warn");
        return proposeMove(where.key, cmd);
      case "question": {
        setStatus("");
        const problem = await host.askAloud(cmd.text, speak);
        return problem ? reply(problem, "warn") : undefined;
      }
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    primeSpeech();
    dictation.stop();
    const text = input.value.trim();
    const request = run(text);
    // A request typed while voice chat is on: wait for it, then listen again.
    if (text) handsFree?.hold(request);
  });
  $("lesson-voice-yes").addEventListener("click", () => void confirmMove());
  $("lesson-voice-no").addEventListener("click", () => {
    clearConfirm();
    reply("Cancelled. Nothing was played.");
    input.focus();
  });

  // Voice chat: the switch, the line saying what it is doing, and the listen/speak loop.
  const chatToggle = $<HTMLInputElement>("lesson-voice-chat-toggle");
  const chatLabel = $<HTMLLabelElement>("lesson-voice-chat-label");
  const chatState = $<HTMLParagraphElement>("lesson-voice-chat-state");
  const micBtn = $<HTMLButtonElement>("lesson-voice-mic");
  const STATE_TEXT: Record<HandsFreeState, string> = {
    off: "",
    listening: "Listening… say your move or question.",
    working: "Thinking…",
    speaking: "The coach is speaking…",
  };
  const chatDictation = getPlatform().voice().dictation();
  const handsFree = chatDictation
    ? createHandsFree({
        dictation: chatDictation,
        speaking: isSpeaking,
        onSpeaking,
        busy: () => working,
        visible: () => !document.hidden && !screen.hidden && host.active(),
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
    // Leaving the Lessons screen, or the page going to the background, ends voice chat.
    new MutationObserver(() => {
      if (screen.hidden) handsFree.stop("hidden");
    }).observe(screen, { attributes: true, attributeFilter: ["hidden"] });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) handsFree.stop("hidden");
    });
  }

  // Read aloud (the switch next to this box): the coach's texts that appear without a request
  // here, such as a suggested question's answer, a hint, a warning or the next step.
  const readIfOn = (text: string | null | undefined) => {
    const t = text?.trim();
    if (!t || !isReadAloudOn() || working || !host.active()) return;
    if (t === lastSpoken.text && Date.now() - lastSpoken.at < 8000) return;
    speak(t);
  };
  const watch = (id: string, fn: () => void, wait: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(fn, wait);
    }).observe($(id), { childList: true, subtree: true, characterData: true });
  };
  let lastStepText = "";
  let wasOpen = false;
  const bannerShown = () => !$("lesson-banner").hidden;
  watch(
    "lesson-answer-a",
    () => {
      const t = $("lesson-answer-a").textContent;
      if (t && !WORKING.has(t)) readIfOn(t);
    },
    200,
  );
  watch("lesson-hint-log", () => readIfOn($("lesson-hint-log").lastElementChild?.textContent), 200);
  watch(
    "lesson-banner-text",
    () => bannerShown() && readIfOn($("lesson-banner-text").textContent),
    300,
  );
  watch(
    "lesson-text",
    () => {
      if (host.boardBusy() || bannerShown()) return;
      // The page rewrites this line on every render: read it only when the words changed.
      const t = host.readText();
      if (t === lastStepText) return;
      lastStepText = t;
      readIfOn(t);
    },
    700,
  );

  return {
    /** Call after anything changes on the lesson: a move waiting for "yes" may no longer apply. */
    sync() {
      const where = host.movePosition();
      if (pending && where?.key !== pending.key) clearConfirm();
      if (choices && where?.key !== choices.key) choices = null;
      const open = host.active();
      if (!open) {
        clearConfirm();
        dictation.stop();
        handsFree?.stop();
        setStatus("");
        // Silence the reading once, when the lesson closes: not on later renders.
        if (wasOpen) stopReading();
        lastStepText = "";
      }
      wasOpen = open;
    },
  };
}
