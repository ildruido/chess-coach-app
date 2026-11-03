// The "Speak" button next to "Talk to the coach" (CC-043h). Where the host gives a
// microphone (the web app), one press listens once and puts the words in the box; Ale
// checks them and presses Send. Nothing listens on its own and nothing is sent by it.
import { getPlatform } from "../platform";
import type { DictationError } from "../platform/types";
import { primeSpeech } from "./read-aloud";
import { reportSupport } from "./support";

const MESSAGES: Record<DictationError, string> = {
  denied: "The microphone is blocked. Allow it for this site in your browser, or type instead.",
  "no-speech": "I didn't hear anything. Press Speak and try again.",
  network:
    "Listening needs an internet connection in this browser, and it can't reach its speech service. Check your connection, or type instead.",
  unavailable: "Speaking isn't working in this browser right now. You can type instead.",
};

/** The element ids of one Speak button and its two notes (Practice and Lessons each have their own). */
export interface DictationIds {
  mic: string;
  micNote: string;
  keyboardNote: string;
}
const PRACTICE_IDS: DictationIds = {
  mic: "voice-mic",
  micNote: "voice-mic-note",
  keyboardNote: "voice-keyboard-note",
};

export function mountDictation(
  input: HTMLInputElement,
  setStatus: (text: string, tone?: "info" | "ok" | "warn") => void,
  ids: DictationIds = PRACTICE_IDS,
) {
  const btn = document.getElementById(ids.mic) as HTMLButtonElement;
  const dictation = getPlatform().voice().dictation();
  reportSupport({ listen: dictation !== null });
  if (!dictation) return { stop() {} };

  btn.hidden = false;
  document.getElementById(ids.micNote)!.hidden = false;
  document.getElementById(ids.keyboardNote)!.hidden = true;

  let listening = false;
  let failed = false;
  let stoppedByUser = false;
  const set = (on: boolean) => {
    listening = on;
    btn.setAttribute("aria-pressed", String(on));
    btn.textContent = on ? "Stop" : "Speak";
  };
  const stop = () => {
    stoppedByUser = true;
    dictation.stop();
  };

  btn.addEventListener("click", () => {
    if (listening) return stop();
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setStatus(MESSAGES.network, "warn");
      return;
    }
    // Phones only let the page speak after a tap: wake the voice now, for the answer later.
    primeSpeech();
    setStatus("Listening…");
    failed = false;
    stoppedByUser = false;
    set(true);
    dictation.start({
      onText: (text) => {
        input.value = text.slice(0, input.maxLength);
      },
      onError: (code) => {
        failed = true;
        setStatus(MESSAGES[code], "warn");
      },
      onEnd: () => {
        set(false);
        if (failed) return;
        if (input.value) setStatus("Check the words, then press Send.");
        // Some phones end listening without a word or an error.
        else setStatus(stoppedByUser ? "" : MESSAGES["no-speech"], stoppedByUser ? "info" : "warn");
        input.focus();
      },
    });
  });
  return { stop };
}
