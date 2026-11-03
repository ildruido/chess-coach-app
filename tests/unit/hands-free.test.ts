import { describe, expect, it } from "vitest";
import {
  AFTER_SPEECH_MS,
  createHandsFree,
  type HandsFreeState,
  isStopPhrase,
  SILENCE_MS,
  STOPPED_TEXT,
} from "../../src/voice/hands-free";
import type { DictationError, DictationHandlers } from "../../src/platform/types";

function setup() {
  let t = 0;
  const timers: { at: number; fn: () => void }[] = [];
  let handlers: DictationHandlers | null = null;
  let speaking = false;
  let busy = false;
  let visible = true;
  let speakFn: (s: boolean) => void = () => {};
  const log = { starts: 0, stops: 0, states: [] as HandsFreeState[], stopped: [] as string[] };
  const sent: string[] = [];
  let release: (() => void) | null = null;
  let whileSubmitting: (() => void) | null = null;
  const hf = createHandsFree({
    dictation: {
      start(h) {
        log.starts++;
        handlers = h;
      },
      stop() {
        log.stops++;
        const h = handlers;
        handlers = null;
        h?.onEnd();
      },
    },
    speaking: () => speaking,
    onSpeaking: (fn) => (speakFn = fn),
    busy: () => busy,
    visible: () => visible,
    submit: (text) => {
      sent.push(text);
      whileSubmitting?.();
      return new Promise<void>((r) => (release = r));
    },
    showText: () => {},
    onState: (s) => log.states.push(s),
    onStopped: (text) => log.stopped.push(text),
    now: () => t,
    later: (fn, ms) => timers.push({ at: t + ms, fn }),
  });
  return {
    hf,
    log,
    sent,
    advance(ms: number) {
      t += ms;
      for (const x of timers.filter((x) => x.at <= t)) {
        timers.splice(timers.indexOf(x), 1);
        x.fn();
      }
    },
    /** The player says something and the recogniser ends. */
    say(text: string) {
      handlers!.onText(text, true);
      handlers!.onEnd();
    },
    silence() {
      handlers!.onEnd();
    },
    fail(code: DictationError) {
      handlers!.onError(code);
      handlers!.onEnd();
    },
    answer: () => release!(),
    /** Runs inside the next request, as if the request itself did something. */
    duringRequest: (fn: () => void) => (whileSubmitting = fn),
    speak(v: boolean) {
      speaking = v;
      speakFn(v);
    },
    setBusy: (v: boolean) => (busy = v),
    setVisible: (v: boolean) => (visible = v),
    listening: () => handlers !== null,
    state: () => log.states[log.states.length - 1],
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("hands-free chat", () => {
  it("listens, sends, waits for the spoken answer, then listens again", async () => {
    const s = setup();
    s.hf.start();
    s.advance(AFTER_SPEECH_MS);
    expect(s.state()).toBe("listening");
    s.say("why is the centre important");
    expect(s.sent).toEqual(["why is the centre important"]);
    expect(s.state()).toBe("working");
    s.speak(true);
    s.answer();
    await flush();
    expect(s.state()).toBe("speaking");
    expect(s.listening()).toBe(false);
    s.speak(false);
    s.advance(AFTER_SPEECH_MS);
    expect(s.state()).toBe("listening");
    expect(s.listening()).toBe(true);
  });

  it("does not listen while the coach is speaking", () => {
    const s = setup();
    s.hf.start();
    s.advance(AFTER_SPEECH_MS);
    s.speak(true);
    expect(s.listening()).toBe(false);
    s.advance(10_000);
    expect(s.listening()).toBe(false);
  });

  it("does not listen while a request is still being answered", async () => {
    const s = setup();
    s.hf.start();
    s.advance(AFTER_SPEECH_MS);
    s.say("hint");
    s.advance(AFTER_SPEECH_MS * 2);
    expect(s.listening()).toBe(false);
    s.answer();
    await flush();
    s.advance(AFTER_SPEECH_MS);
    expect(s.listening()).toBe(true);
  });

  it("waits for work started elsewhere (a hint) and then listens, with no signal needed", () => {
    const s = setup();
    s.setBusy(true);
    s.hf.start();
    s.advance(AFTER_SPEECH_MS * 3);
    expect(s.listening()).toBe(false);
    expect(s.state()).toBe("working");
    s.setBusy(false);
    s.advance(AFTER_SPEECH_MS);
    expect(s.listening()).toBe(true);
  });

  it("keeps listening through short silences, then stops after 30 seconds", () => {
    const s = setup();
    s.hf.start();
    s.advance(AFTER_SPEECH_MS);
    s.advance(5_000);
    s.silence();
    expect(s.listening()).toBe(true);
    s.advance(SILENCE_MS);
    s.silence();
    expect(s.state()).toBe("off");
    expect(s.hf.isOn()).toBe(false);
    expect(s.log.stopped).toEqual([STOPPED_TEXT.silence]);
  });

  it("treats a no-speech error like silence", () => {
    const s = setup();
    s.hf.start();
    s.advance(AFTER_SPEECH_MS);
    s.fail("no-speech");
    expect(s.hf.isOn()).toBe(true);
    expect(s.listening()).toBe(true);
  });

  it.each(["denied", "network", "unavailable"] as const)("stops on %s and says why", (code) => {
    const s = setup();
    s.hf.start();
    s.advance(AFTER_SPEECH_MS);
    s.fail(code);
    expect(s.hf.isOn()).toBe(false);
    expect(s.log.stopped).toEqual([STOPPED_TEXT[code]]);
    expect(s.listening()).toBe(false);
  });

  it("stops when the page is hidden, and never starts listening hidden", () => {
    const s = setup();
    s.setVisible(false);
    s.hf.start();
    s.advance(AFTER_SPEECH_MS);
    expect(s.hf.isOn()).toBe(false);
    expect(s.log.starts).toBe(0);
    expect(s.log.stopped).toEqual([STOPPED_TEXT.hidden]);
  });

  it("stops at once when switched off, and ignores what it hears afterwards", () => {
    const s = setup();
    s.hf.start();
    s.advance(AFTER_SPEECH_MS);
    s.hf.stop();
    expect(s.state()).toBe("off");
    expect(s.listening()).toBe(false);
    s.advance(SILENCE_MS * 2);
    expect(s.log.starts).toBe(1);
    expect(s.sent).toEqual([]);
  });

  it("stops when the player says stop", () => {
    const s = setup();
    s.hf.start();
    s.advance(AFTER_SPEECH_MS);
    s.say("stop");
    expect(s.hf.isOn()).toBe(false);
    expect(s.sent).toEqual([]);
    expect(s.log.stopped).toEqual([]);
  });

  it("waits for a request typed by hand, then listens again", async () => {
    const s = setup();
    s.hf.start();
    s.advance(AFTER_SPEECH_MS);
    let done!: () => void;
    s.hf.hold(new Promise<void>((r) => (done = r)));
    expect(s.listening()).toBe(false);
    done();
    await flush();
    s.advance(AFTER_SPEECH_MS);
    expect(s.listening()).toBe(true);
  });

  it("carries on after a request that fails", async () => {
    const s = setup();
    s.hf.start();
    s.advance(AFTER_SPEECH_MS);
    s.hf.hold(Promise.reject(new Error("boom")));
    await flush();
    s.advance(AFTER_SPEECH_MS);
    expect(s.listening()).toBe(true);
  });

  it("stays off when the request itself ends voice chat (leaving the lesson)", async () => {
    const s = setup();
    s.hf.start();
    s.advance(AFTER_SPEECH_MS);
    s.duringRequest(() => s.hf.stop());
    s.say("leave lesson");
    expect(s.hf.isOn()).toBe(false);
    expect(s.log.states.at(-1)).toBe("off");
    s.answer();
    await flush();
    s.advance(AFTER_SPEECH_MS * 2);
    expect(s.listening()).toBe(false);
    expect(s.log.states.at(-1)).toBe("off");
  });

  it("ignores hold when off", () => {
    const s = setup();
    s.hf.hold(Promise.resolve());
    expect(s.log.states).toEqual([]);
  });
});

describe("isStopPhrase", () => {
  it("matches stop phrases on their own only", () => {
    for (const t of ["stop", "Stop.", "stop listening", "turn off voice chat", "goodbye"])
      expect(isStopPhrase(t)).toBe(true);
    for (const t of ["stop the clock", "why did you stop", "play e4", ""])
      expect(isStopPhrase(t)).toBe(false);
  });
});
