import { diagnosticsOn, onDiagnostics } from "../diagnostics";
// The mark on a reused answer (CC-031): "Reused from an earlier answer", with
// "Ask the coach anyway" and 👎 (which stops it being reused). Used by every
// feature that shows a saved answer in place of a coach call; the lessons have
// their own, richer controls in ask-panel.ts.

export const REUSED_TEXT = "Reused from an earlier answer.";
export const NOT_REUSED_TEXT = "Got it: this answer won't be shown again.";

export interface ReuseNote {
  el: HTMLDivElement;
}

export function reuseNote(opts: { onAnyway: () => void; onDown: () => void }): ReuseNote {
  const el = document.createElement("div");
  el.className = "reuse-note";
  const label = document.createElement("span");
  label.textContent = REUSED_TEXT;
  const anyway = document.createElement("button");
  anyway.type = "button";
  anyway.className = "secondary";
  anyway.textContent = "Ask the coach anyway";
  const down = document.createElement("button");
  down.type = "button";
  down.className = "secondary";
  down.textContent = "👎";
  down.setAttribute("aria-label", "Bad answer: don't show it again");
  down.setAttribute("aria-pressed", "false");
  anyway.addEventListener("click", opts.onAnyway);
  down.addEventListener("click", () => {
    if (down.getAttribute("aria-pressed") === "true") return;
    down.setAttribute("aria-pressed", "true");
    label.textContent = NOT_REUSED_TEXT;
    opts.onDown();
  });
  el.append(label, anyway, down);
  return { el };
}

/** Diagnostics: a line under a feature saying how many answers were reused and how many went to the coach. */
export function diagCounter(anchor: HTMLElement, id: string, line: () => string): () => void {
  const p = document.createElement("p");
  p.id = id;
  p.className = "diag-note";
  anchor.after(p);
  const update = () => {
    p.textContent = line();
    p.hidden = !diagnosticsOn();
  };
  onDiagnostics(update);
  update();
  return update;
}
