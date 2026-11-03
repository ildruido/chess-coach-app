// Hands-free chat (CC-039b): while the switch is on, the page listens, sends what was said,
// waits for the answer to be read aloud, and listens again. The state machine lives here with
// everything it touches passed in, so it is unit-tested without a browser.
import type { Dictation, DictationError } from "../platform/types";

export type HandsFreeState = "off" | "listening" | "working" | "speaking";

/** Voice chat ends after this long without a word. */
export const SILENCE_MS = 30_000;
/** A short pause after the coach finishes, so its last word isn't picked up as speech. */
export const AFTER_SPEECH_MS = 400;

export const STOPPED_TEXT: Record<DictationError | "silence" | "hidden", string> = {
  denied: "Voice chat stopped: the microphone is blocked. Allow it for this site, or type instead.",
  "no-speech": "Voice chat stopped: I heard nothing.",
  network:
    "Voice chat stopped: listening needs an internet connection and the speech service can't be reached.",
  unavailable: "Voice chat stopped: speaking isn't working in this browser right now.",
  silence: "Voice chat stopped: I heard nothing for 30 seconds. Switch it on to talk again.",
  hidden: "Voice chat stopped because the page is no longer in view.",
};

/** Saying one of these (on its own) switches voice chat off. */
export function isStopPhrase(text: string): boolean {
  return /^(please )?(stop|stop listening|stop voice chat|end voice chat|turn off voice chat|goodbye|good bye)\.?$/i.test(
    text.trim(),
  );
}

export interface HandsFreeDeps {
  dictation: Dictation;
  /** True while the coach is being read aloud. */
  speaking(): boolean;
  /** Called when reading starts (true) or ends (false). */
  onSpeaking(fn: (speaking: boolean) => void): void;
  /** True while a request to the coach is still being answered. */
  busy(): boolean;
  /** False when the page is hidden or the Practice screen is not showing. */
  visible(): boolean;
  /** Sends what was said; resolves when the coach has answered. */
  submit(text: string): Promise<void>;
  /** Shows the words as they are heard. */
  showText(text: string): void;
  onState(state: HandsFreeState): void;
  /** Said when voice chat ends by itself. */
  onStopped(text: string): void;
  now?: () => number;
  later?: (fn: () => void, ms: number) => unknown;
}

export interface HandsFree {
  start(): void;
  /** Ends voice chat; with a reason, tells the player why. */
  stop(reason?: keyof typeof STOPPED_TEXT): void;
  isOn(): boolean;
  /** A request sent by hand (typed Send) while voice chat is on: wait for it, then carry on. */
  hold(request: Promise<void>): void;
}

export function createHandsFree(d: HandsFreeDeps): HandsFree {
  const now = d.now ?? Date.now;
  const later = d.later ?? ((fn, ms) => setTimeout(fn, ms));
  let on = false;
  let inFlight = 0;
  /** Bumped whenever a listening session ends, so a late event from an old one is ignored. */
  let session = 0;
  let lastHeard = 0;
  let wake = 0;

  const set = (s: HandsFreeState) => d.onState(s);

  /** Ends the current listening session and ignores anything it still reports. */
  function halt() {
    session++;
    wake++;
    d.dictation.stop();
  }

  function stop(reason?: keyof typeof STOPPED_TEXT) {
    if (!on) return;
    on = false;
    halt();
    set("off");
    if (reason) d.onStopped(STOPPED_TEXT[reason]);
  }

  /** Picks what to do now: wait for the coach, or listen. */
  function next() {
    if (!on || inFlight > 0) return;
    if (d.speaking()) return set("speaking");
    if (!d.visible()) return stop("hidden");
    const at = ++wake;
    set("working");
    // Also after a request that is still being answered somewhere else (a hint, a review):
    // look again shortly, so voice chat can never stall waiting for a signal that doesn't come.
    later(() => {
      if (at !== wake || !on || inFlight > 0) return;
      if (d.speaking()) return;
      if (d.busy()) return next();
      listen();
    }, AFTER_SPEECH_MS);
  }

  function listen() {
    if (!d.visible()) return stop("hidden");
    const mine = ++session;
    let heard = "";
    let failed: DictationError | null = null;
    set("listening");
    d.dictation.start({
      onText: (text) => {
        if (mine !== session) return;
        heard = text;
        d.showText(text);
      },
      onError: (code) => {
        if (mine === session && code !== "no-speech") failed = code;
      },
      onEnd: () => {
        if (mine !== session || !on) return;
        session++;
        if (failed) return stop(failed);
        if (!heard) {
          if (now() - lastHeard >= SILENCE_MS) return stop("silence");
          return listen();
        }
        lastHeard = now();
        if (!d.visible()) return stop("hidden");
        if (isStopPhrase(heard)) {
          d.showText("");
          return stop();
        }
        hold(d.submit(heard));
      },
    });
  }

  function hold(request: Promise<void>) {
    // The request itself may have ended voice chat (leaving the screen): stay off.
    if (!on) return;
    halt();
    inFlight++;
    set("working");
    // A request that fails is the panel's to report; voice chat just carries on.
    void request
      .catch(() => {})
      .finally(() => {
        inFlight--;
        lastHeard = now();
        next();
      });
  }

  d.onSpeaking((speaking) => {
    if (!on) return;
    if (speaking) {
      // Never listen while the coach talks: it would hear itself.
      halt();
      set("speaking");
    } else next();
  });

  return {
    start() {
      if (on) return;
      on = true;
      lastHeard = now();
      if (inFlight > 0) return set("working");
      next();
    },
    stop,
    isOn: () => on,
    hold(request) {
      if (on) hold(request);
    },
  };
}
