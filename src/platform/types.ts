// What the page needs from the place it runs in. The web app provides these
// through `/api/*` (docs/API.md); the e2e test build fakes them.
// Every getter resolves null when that part is not available, and the page must cope.

export interface Platform {
  /** False when there is no host runtime at all (an ordinary browser tab, unit tests). */
  hasRuntime(): boolean;
  /** Ask the coach. Takes the coach request and streams text back. */
  sample(): Promise<SampleFn | null>;
  /** Per-user documents. */
  db(): Promise<DbApi | null>;
  /** Who is using the page. */
  user(): Promise<UserApi | null>;
  /** Offer the player a generated file to save. */
  downloads(): Promise<DownloadsFn | null>;
  /** Speech in and out. Always present; each part is null where this place cannot do it. */
  voice(): Voice;
}

/** The browser's speech synthesis, as much as the speaker uses. */
export interface SpeechOut {
  synth: SpeechSynthesis;
  utterance(text: string): SpeechSynthesisUtterance;
}

export type DictationError = "denied" | "no-speech" | "network" | "unavailable";

export interface DictationHandlers {
  /** The words heard so far (replaces any earlier text of this session). */
  onText(text: string, final: boolean): void;
  /** Listening has stopped, for any reason. */
  onEnd(): void;
  onError(code: DictationError): void;
}

/** One dictation: listens only between `start` and `stop` (or the end of speech). */
export interface Dictation {
  start(handlers: DictationHandlers): void;
  stop(): void;
}

/**
 * Voice for the page. Both parts are the browser's own speech today; a server speech
 * service (CC-039, `/api/voice/*` in docs/API.md) can replace them here without touching
 * the rest of the app.
 */
export interface Voice {
  /** Reading aloud; null when the browser has no speech synthesis. */
  speechOut(): SpeechOut | null;
  /** Talking to the coach with the microphone; null where the host gives no microphone. */
  dictation(): Dictation | null;
}
