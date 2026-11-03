import { describe, expect, it, vi } from "vitest";
import { createSpeaker, type Synth } from "../../src/voice/speaker";

type Utt = SpeechSynthesisUtterance & { text: string };

function fakeSynth(voices: { lang: string; default?: boolean }[] = [{ lang: "en-GB" }]) {
  const spoken: Utt[] = [];
  let onVoices: (() => void) | null = null;
  const synth: Synth & { voices: typeof voices } = {
    voices,
    speak: (u) => void spoken.push(u as Utt),
    cancel: vi.fn(),
    resume: vi.fn(),
    getVoices: () => synth.voices as SpeechSynthesisVoice[],
    addEventListener: (_t, fn) => void (onVoices = fn),
  };
  const make = (text: string) => ({ text }) as Utt;
  return { synth, spoken, make, fireVoices: () => onVoices?.() };
}

describe("createSpeaker", () => {
  it("reads each sentence in words, in order", async () => {
    const f = fakeSynth();
    const s = createSpeaker(f.synth, f.make);
    const seen: boolean[] = [];
    s.onAvailable((ok) => seen.push(ok));
    expect(seen).toEqual([true]);
    s.speak("Play Nf3. Then castle.");
    expect(f.spoken.map((u) => u.text)).toEqual(["Play knight f3.", "Then castle."]);
  });

  it("picks an English voice, the default one first", async () => {
    const f = fakeSynth([
      { lang: "it-IT", default: true },
      { lang: "en-US" },
      { lang: "en-GB", default: true },
    ]);
    const s = createSpeaker(f.synth, f.make);
    s.speak("Hello.");
    expect(f.spoken[0]!.lang).toBe("en-GB");
  });

  it("reports speaking until the last sentence ends, and stop cancels", async () => {
    const f = fakeSynth();
    const s = createSpeaker(f.synth, f.make);
    const states: boolean[] = [];
    s.onChange((on) => states.push(on));
    s.speak("One. Two.");
    f.spoken[0]!.onend!({} as SpeechSynthesisEvent);
    expect(states).toEqual([true]);
    f.spoken[1]!.onend!({} as SpeechSynthesisEvent);
    expect(states).toEqual([true, false]);
    s.speak("Three.");
    s.stop();
    expect(f.synth.cancel).toHaveBeenCalled();
    expect(f.synth.resume).toHaveBeenCalled();
    expect(states).toEqual([true, false, true, false]);
    // A late end event from a cancelled sentence changes nothing.
    f.spoken[2]!.onend!({} as SpeechSynthesisEvent);
    expect(states).toEqual([true, false, true, false]);
  });

  it("is unavailable without speech, or without any voice", () => {
    const none: boolean[] = [];
    createSpeaker(null, (t) => ({ text: t }) as Utt).onAvailable((ok) => none.push(ok));
    expect(none).toEqual([false]);
    vi.useFakeTimers();
    const f = fakeSynth([]);
    const seen: boolean[] = [];
    createSpeaker(f.synth, f.make).onAvailable((ok) => seen.push(ok));
    vi.advanceTimersByTime(1500);
    expect(seen).toEqual([false]);
    // Voices that turn up later still make it available.
    f.synth.voices = [{ lang: "en-US" }];
    f.fireVoices();
    expect(seen).toEqual([false, true]);
    vi.useRealTimers();
  });

  it("is available when voices arrive a moment later", () => {
    const f = fakeSynth([]);
    const s = createSpeaker(f.synth, f.make);
    const seen: boolean[] = [];
    s.onAvailable((ok) => seen.push(ok));
    f.synth.voices = [{ lang: "en-US" }];
    f.fireVoices();
    expect(seen).toEqual([true]);
  });

  it("cuts a long sentence into short utterances", () => {
    const f = fakeSynth();
    const s = createSpeaker(f.synth, f.make);
    s.speak(`${"Keep your pieces safe, ".repeat(12)}and play on.`);
    expect(f.spoken.length).toBeGreaterThan(1);
    expect(f.spoken.every((u) => u.text.length <= 160)).toBe(true);
  });

  it("unlock speaks one silent utterance, once", () => {
    const f = fakeSynth();
    const s = createSpeaker(f.synth, f.make);
    s.unlock();
    s.unlock();
    expect(f.spoken).toHaveLength(1);
    expect(f.spoken[0]!.volume).toBe(0);
  });

  it("picks up a voice that loaded after the speaker was made", () => {
    const f = fakeSynth([]);
    const s = createSpeaker(f.synth, f.make);
    f.synth.voices = [{ lang: "en-AU" }];
    s.speak("Hello.");
    expect(f.spoken[0]!.lang).toBe("en-AU");
  });

  it("clears 'speaking' when the browser lost the end event", () => {
    vi.useFakeTimers();
    const f = fakeSynth();
    f.synth.speaking = false;
    f.synth.pending = false;
    const s = createSpeaker(f.synth, f.make);
    const states: boolean[] = [];
    s.onChange((on) => states.push(on));
    s.speak("One.");
    vi.advanceTimersByTime(2500);
    expect(states).toEqual([true, false]);
    vi.useRealTimers();
  });

  it("keeps 'speaking' while the browser is still reading", () => {
    vi.useFakeTimers();
    const f = fakeSynth();
    f.synth.speaking = true;
    const s = createSpeaker(f.synth, f.make);
    const states: boolean[] = [];
    s.onChange((on) => states.push(on));
    s.speak("One.");
    vi.advanceTimersByTime(5000);
    expect(states).toEqual([true]);
    vi.useRealTimers();
  });
});
