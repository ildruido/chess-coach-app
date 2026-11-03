// A thin wrapper over the browser's built-in speech (speechSynthesis): no
// tokens, no permission prompt. Each sentence is its own utterance, queued.
import { chunks, speakable } from "./speakable";

/** The part of speechSynthesis the speaker uses (a fake in tests). */
export interface Synth {
  speak(u: SpeechSynthesisUtterance): void;
  cancel(): void;
  resume(): void;
  getVoices(): SpeechSynthesisVoice[];
  /** Whether the browser is still reading (absent in simple fakes). */
  speaking?: boolean;
  pending?: boolean;
  addEventListener(type: "voiceschanged", fn: () => void): void;
}

export interface Speaker {
  /**
   * Called with false when no voice turns up in time, and with true when one
   * is there (even if it turns up later, as on a slow first load).
   */
  onAvailable(fn: (ok: boolean) => void): void;
  /** Queues the text after anything still being read. */
  speak(text: string): void;
  /**
   * Call from a tap: phones only let a page speak after the user has tapped, so this
   * wakes the voice with a silent utterance, once, and answers arriving later can be read.
   */
  unlock(): void;
  /** Stops at once and drops the queue. */
  stop(): void;
  /** Called with true when reading starts and false when it ends or stops. */
  onChange(fn: (speaking: boolean) => void): void;
  /** True while anything is queued or being read. */
  isSpeaking(): boolean;
}

const VOICE_WAIT_MS = 1500;
/** How often a "reading" state with nothing really being read is noticed and cleared. */
const WATCH_MS = 1000;

export function createSpeaker(
  synth: Synth | null,
  makeUtterance: (text: string) => SpeechSynthesisUtterance,
): Speaker {
  let voice: SpeechSynthesisVoice | null = null;
  // Kept so the browser can't drop an utterance (and its end event) mid-sentence.
  let queue: SpeechSynthesisUtterance[] = [];
  const listeners: ((speaking: boolean) => void)[] = [];
  const notify = () => listeners.forEach((fn) => fn(queue.length > 0));

  const pickVoice = (): boolean => {
    const voices = synth?.getVoices() ?? [];
    const english = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
    voice = english.find((v) => v.default) ?? english[0] ?? voices[0] ?? null;
    return voices.length > 0;
  };

  let available: boolean | null = null;
  const availability: ((ok: boolean) => void)[] = [];
  const setAvailable = (ok: boolean) => {
    if (available === ok || available === true) return;
    available = ok;
    availability.forEach((fn) => fn(ok));
  };
  if (!synth) setAvailable(false);
  else if (pickVoice()) setAvailable(true);
  else {
    // Some browsers list their voices a moment, or a while, after the page loads.
    setTimeout(() => setAvailable(pickVoice()), VOICE_WAIT_MS);
    if (typeof synth.addEventListener === "function") {
      synth.addEventListener("voiceschanged", () => {
        if (pickVoice()) setAvailable(true);
      });
    }
  }

  // Some phones lose the end event of an utterance; then "Stop" would stay up for ever.
  let watch: ReturnType<typeof setInterval> | null = null;
  let idleTicks = 0;
  const startWatch = () => {
    if (watch || !synth || typeof synth.speaking !== "boolean") return;
    watch = setInterval(() => {
      if (!queue.length) {
        idleTicks = 0;
        clearInterval(watch!);
        watch = null;
        return;
      }
      idleTicks = synth.speaking || synth.pending ? 0 : idleTicks + 1;
      if (idleTicks >= 2) {
        idleTicks = 0;
        queue = [];
        synth.cancel();
        notify();
      }
    }, WATCH_MS);
  };

  let unlocked = false;
  function unlock() {
    if (!synth || unlocked) return;
    unlocked = true;
    const u = makeUtterance(" ");
    u.volume = 0;
    synth.speak(u);
  }

  function speak(text: string) {
    if (!synth) return;
    // A voice that loaded after the page did is picked up here.
    if (!voice) pickVoice();
    const wasIdle = queue.length === 0;
    for (const s of chunks(speakable(text))) {
      const u = makeUtterance(s);
      u.lang = voice?.lang ?? "en";
      if (voice) u.voice = voice;
      const done = () => {
        if (!queue.includes(u)) return;
        queue = queue.filter((q) => q !== u);
        if (!queue.length) notify();
      };
      u.onend = done;
      u.onerror = done;
      queue.push(u);
      synth.speak(u);
    }
    if (wasIdle && queue.length) notify();
    if (queue.length) startWatch();
  }

  function stop() {
    if (!synth) return;
    const was = queue.length > 0;
    queue = [];
    synth.cancel();
    // Chrome can be left paused after a cancel, which silences the next reading.
    synth.resume();
    if (was) notify();
  }

  return {
    onAvailable: (fn) => {
      availability.push(fn);
      if (available !== null) fn(available);
    },
    speak,
    unlock,
    stop,
    onChange: (fn) => void listeners.push(fn),
    isSpeaking: () => queue.length > 0,
  };
}
