// The browser's own speech: reading aloud (speechSynthesis) and dictation (SpeechRecognition,
// prefixed in Safari and Chrome). Looked up lazily so tests can fake them late.
import type { Dictation, DictationError, DictationHandlers, SpeechOut } from "./types";

export function browserSpeechOut(): SpeechOut | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  return {
    synth: window.speechSynthesis,
    utterance: (text) => new SpeechSynthesisUtterance(text),
  };
}

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
interface RecognitionResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, RecognitionCtor | undefined>;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, DictationError> = {
  "not-allowed": "denied",
  "service-not-allowed": "denied",
  "no-speech": "no-speech",
  "audio-capture": "unavailable",
  "language-not-supported": "unavailable",
  network: "network",
};

export function browserDictation(): Dictation | null {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;
  let active: Recognition | null = null;
  let activeEnd: (() => void) | null = null;
  return {
    start(h: DictationHandlers) {
      this.stop();
      const rec = new Ctor();
      active = rec;
      activeEnd = h.onEnd;
      rec.lang = navigator.language || "en-US";
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      rec.onresult = (e) => {
        if (active !== rec) return;
        let text = "";
        let final = true;
        for (let i = 0; i < e.results.length; i++) {
          const r = e.results[i]!;
          text += r[0]?.transcript ?? "";
          if (!r.isFinal) final = false;
        }
        h.onText(text.trim(), final);
      };
      rec.onerror = (e) => {
        // A deliberate stop can report "aborted"; that is not a failure.
        if (active === rec && e.error !== "aborted") h.onError(ERRORS[e.error] ?? "unavailable");
      };
      rec.onend = () => {
        if (active !== rec) return;
        active = null;
        h.onEnd();
      };
      try {
        rec.start();
      } catch {
        active = null;
        h.onError("unavailable");
        h.onEnd();
      }
    },
    stop() {
      // Stopping hands the session back at once: nothing it reports later is passed on.
      const rec = active;
      if (!rec) return;
      active = null;
      rec.stop();
      activeEnd?.();
    },
  };
}
