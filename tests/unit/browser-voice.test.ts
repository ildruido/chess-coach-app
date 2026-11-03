import { afterEach, describe, expect, it, vi } from "vitest";
import { browserDictation } from "../../src/platform/browser-voice";
import { createWebPlatform } from "../../src/platform/web";

class FakeRecognition {
  static last: FakeRecognition;
  lang = "";
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = 0;
  stopped = 0;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started++;
  }
  stop() {
    this.stopped++;
    this.onend?.();
  }
}

function fakeWindow(extra: Record<string, unknown>) {
  (globalThis as { window?: unknown }).window = extra;
  vi.stubGlobal("navigator", { language: "en-GB" });
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.unstubAllGlobals();
});

const result = (...parts: [string, boolean][]) => ({
  results: parts.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f })),
});

describe("browser dictation", () => {
  it("is absent without speech recognition", () => {
    fakeWindow({});
    expect(browserDictation()).toBeNull();
    expect(createWebPlatform().voice().dictation()).toBeNull();
  });

  it("listens only after start and reports the words heard", () => {
    fakeWindow({ webkitSpeechRecognition: FakeRecognition });
    const d = browserDictation()!;
    expect(FakeRecognition.last).toBeUndefined();
    const texts: [string, boolean][] = [];
    let ended = 0;
    d.start({ onText: (t, f) => texts.push([t, f]), onEnd: () => ended++, onError: () => {} });
    const rec = FakeRecognition.last;
    expect(rec.started).toBe(1);
    expect(rec.lang).toBe("en-GB");
    rec.onresult?.(result(["play e", false]));
    rec.onresult?.(result(["play e4 ", true]));
    expect(texts).toEqual([
      ["play e", false],
      ["play e4", true],
    ]);
    d.stop();
    expect(ended).toBe(1);
  });

  it("maps a blocked microphone and other failures", () => {
    fakeWindow({ SpeechRecognition: FakeRecognition });
    const d = browserDictation()!;
    const errors: string[] = [];
    d.start({ onText: () => {}, onEnd: () => {}, onError: (c) => errors.push(c) });
    FakeRecognition.last.onerror?.({ error: "not-allowed" });
    FakeRecognition.last.onerror?.({ error: "no-speech" });
    FakeRecognition.last.onerror?.({ error: "network" });
    FakeRecognition.last.onerror?.({ error: "something-new" });
    expect(errors).toEqual(["denied", "no-speech", "network", "unavailable"]);
  });

  it("reports unavailable if the browser refuses to start", () => {
    class Broken extends FakeRecognition {
      start() {
        throw new Error("already started");
      }
    }
    fakeWindow({ SpeechRecognition: Broken });
    const errors: string[] = [];
    let ended = 0;
    browserDictation()!.start({
      onText: () => {},
      onEnd: () => ended++,
      onError: (c) => errors.push(c),
    });
    expect(errors).toEqual(["unavailable"]);
    expect(ended).toBe(1);
  });
});
