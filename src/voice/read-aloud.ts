// The "Read aloud" switch (CC-032), shared by Practice and Lessons. When it is on,
// coach texts are spoken as they appear; a move, Stop or the switch stops it.
import { getPlatform } from "../platform";
import { createSpeaker, type Speaker } from "./speaker";
import { reportSupport } from "./support";

const ON_KEY = "chess-coach.read-aloud";

let speaker: Speaker | null = null;
let on = false;
const speakingListeners: ((speaking: boolean) => void)[] = [];

/** Call from a tap (Speak, Send, the switch): lets a phone speak answers that arrive later. */
export function primeSpeech() {
  speaker?.unlock();
}

/** Speaks `text` when the switch is on; does nothing otherwise. */
export function say(
  text: string,
  screen: "practice-screen" | "lessons-screen" = "practice-screen",
) {
  // A late hint or comment doesn't follow Ale to the other screen.
  if (on && !document.getElementById(screen)?.hidden) speaker?.speak(text);
}

/** True while the coach is being read aloud. */
export function isSpeaking(): boolean {
  return speaker?.isSpeaking() ?? false;
}

/** Called when reading starts (true) or ends (false). */
export function onSpeaking(fn: (speaking: boolean) => void) {
  speakingListeners.push(fn);
}

/** Stops any reading at once. */
export function stopReading() {
  speaker?.stop();
}

/** The three elements of one Read aloud control: Practice and Lessons each have their own. */
const CONTROLS = ["", "lesson-"].map((prefix) => ({
  toggle: `${prefix}read-aloud-toggle`,
  label: `${prefix}read-aloud-label`,
  stop: `${prefix}read-aloud-stop`,
  note: `${prefix}read-aloud-note`,
}));

/** True when the Read aloud switch is on (it is shared by Practice and Lessons). */
export function isReadAloudOn(): boolean {
  return on;
}

export function mountReadAloud() {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const toggles = CONTROLS.map((c) => $<HTMLInputElement>(c.toggle));
  const labels = CONTROLS.map((c) => $<HTMLLabelElement>(c.label));
  const stopBtns = CONTROLS.map((c) => $<HTMLButtonElement>(c.stop));
  const notes = CONTROLS.map((c) => $<HTMLParagraphElement>(c.note));

  const out = getPlatform().voice().speechOut();
  speaker = createSpeaker(out?.synth ?? null, (text) => out!.utterance(text));

  const setAll = (checked: boolean) => toggles.forEach((t) => (t.checked = checked));
  try {
    setAll(localStorage.getItem(ON_KEY) === "on");
  } catch {
    // Storage may be blocked: reading aloud starts off.
  }
  for (const toggle of toggles) {
    toggle.addEventListener("change", () => {
      on = toggle.checked;
      setAll(on);
      if (on) primeSpeech();
      try {
        localStorage.setItem(ON_KEY, on ? "on" : "off");
      } catch {
        // Only a convenience; the switch still works for this visit.
      }
      if (!on) stopReading();
    });
  }
  stopBtns.forEach((stopBtn, i) =>
    stopBtn.addEventListener("click", () => {
      stopReading();
      toggles[i]!.focus();
    }),
  );
  // A phone that puts the page in the background silences it: don't carry on later.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopReading();
  });
  speaker.onChange((speaking) => {
    stopBtns.forEach((b) => (b.hidden = !speaking));
    speakingListeners.forEach((fn) => fn(speaking));
  });

  speaker.onAvailable((ok) => {
    labels.forEach((l) => (l.hidden = !ok));
    on = ok && toggles[0]!.checked;
    notes.forEach((note) => {
      note.textContent = ok
        ? ""
        : "Reading aloud isn't available here: this browser has no voice installed for speech.";
      note.hidden = ok;
    });
    reportSupport({ read: ok });
  });
}
