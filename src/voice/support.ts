// What voice can do in this browser, in one plain line under the coach card (CC-039a).
// Listening and reading aloud are found out at different moments, so each reports on its own.
export interface VoiceSupport {
  listen?: boolean;
  read?: boolean;
}

/** Safari and every iPhone browser: speech works, but less reliably than in Chrome or Edge. */
export function isSafariLike(ua: string): boolean {
  return (
    /iPhone|iPad|iPod/.test(ua) || (/Safari/.test(ua) && !/Chrome|Chromium|Edg|Android/.test(ua))
  );
}

export function supportNote(s: Required<VoiceSupport>, safari: boolean): string {
  if (s.listen && s.read)
    return safari
      ? "Voice: you can speak to the coach and hear it read aloud. On Safari and iPhone this can be less reliable: if it stops working, type instead."
      : "Voice: you can speak to the coach and hear it read aloud.";
  if (s.read)
    return "Voice: this browser can read answers aloud but can't listen. Type your questions, or tap the microphone key on your phone's keyboard.";
  if (s.listen)
    return "Voice: you can speak to the coach, but this browser has no voice to read answers aloud.";
  return "Voice isn't available in this browser. You can type instead.";
}

const state: VoiceSupport = {};

/** Records one half of the answer and refreshes the line once both are known. */
export function reportSupport(part: VoiceSupport) {
  Object.assign(state, part);
  if (state.listen === undefined || state.read === undefined) return;
  const el = document.getElementById("voice-support");
  if (!el) return;
  el.textContent = supportNote(state as Required<VoiceSupport>, isSafariLike(navigator.userAgent));
  el.hidden = false;
}
