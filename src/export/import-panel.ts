// "Import my data" (CC-043g), web app only: pick the file saved by Export my data, see what
// is in it, then add it to the signed-in account. Nothing runs until the clicks.
import { getPlatform } from "../platform";
import {
  MAX_IMPORT_BYTES,
  countDocs,
  countsText,
  importFailureText,
  parseImport,
  type ImportPlan,
} from "./import-data";
import { runImport } from "./import-run";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

type Tone = "info" | "ok" | "warn";

/** One plain sentence for the end of an import. */
export function outcomeText(
  added: ReturnType<typeof countDocs>,
  existing: number,
  stoppedBy: string | null,
): string {
  const done = `Added ${countsText(added)}.`;
  const kept = existing ? ` ${existing} already here, so left as they are.` : "";
  if (!stoppedBy) return `${done}${kept}`;
  return `${done}${kept} It stopped early (${stoppedBy}). Pick the same file and import again to finish; nothing is duplicated.`;
}

export function mountImportPanel() {
  const section = $<HTMLElement>("data-import");
  section.hidden = false;
  const file = $<HTMLInputElement>("data-import-file");
  const go = $<HTMLButtonElement>("data-import-go");
  const reload = $<HTMLButtonElement>("data-import-reload");
  const status = $<HTMLParagraphElement>("data-import-status");
  let plan: ImportPlan | null = null;
  const say = (text: string, tone: Tone) => {
    status.textContent = text;
    status.dataset.tone = tone;
  };

  file.addEventListener("change", () => {
    void (async () => {
      plan = null;
      go.hidden = true;
      reload.hidden = true;
      const f = file.files?.[0];
      if (!f) return;
      if (f.size > MAX_IMPORT_BYTES) {
        say("That file is too big to be an export from Chess Coach.", "warn");
        return;
      }
      const userId = await (await getPlatform().user())?.id();
      if (!userId) {
        say("Sign in first, then pick the file.", "warn");
        return;
      }
      let text: string;
      try {
        text = await f.text();
      } catch {
        say("Couldn't read that file. Try picking it again.", "warn");
        return;
      }
      const parsed = parseImport(text, userId);
      if (!parsed.ok) {
        say(importFailureText(parsed.reason), "warn");
        return;
      }
      plan = parsed.plan;
      const left = plan.rejected + plan.unreadable;
      const note = left
        ? ` ${left} ${left === 1 ? "item" : "items"} in the file can't be used and will be left out.`
        : "";
      if (!plan.docs.length) {
        say(`There is nothing to import in that file.${note}`, "warn");
        return;
      }
      say(`The file has ${countsText(countDocs(plan.docs))}.${note}`, left ? "warn" : "info");
      go.hidden = false;
    })();
  });

  go.addEventListener("click", () => {
    void (async () => {
      const db = await getPlatform().db();
      if (!plan || !db) return;
      const { docs } = plan;
      go.disabled = true;
      file.disabled = true;
      say("Importing…", "info");
      try {
        const r = await runImport(db, docs, {
          onProgress: (done, total) => say(`Importing… ${done} of ${total}`, "info"),
        });
        say(outcomeText(r.added, r.existing, r.stoppedBy), r.stoppedBy ? "warn" : "ok");
        if (Object.values(r.added).some((n) => n > 0)) reload.hidden = false;
        go.hidden = true;
        plan = null;
      } finally {
        go.disabled = false;
        file.disabled = false;
      }
    })();
  });

  reload.addEventListener("click", () => location.reload());
}
