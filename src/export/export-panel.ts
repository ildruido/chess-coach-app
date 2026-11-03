// "Export my data" (CC-043f): one click collects everything the player has kept and
// offers it as a file. Nothing runs until the click; the coach is never involved.
import { getPlatform } from "../platform";
import { openUserDb } from "../storage/game-store";
import { collectExport } from "./collect";
import { buildExport, exportFilename, serializeExport, summaryText } from "./export-data";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

type Tone = "info" | "ok" | "warn";

/** What to tell the player when the save did not happen; only some failures are worth a retry. */
export function saveFailureText(code?: string): string {
  switch (code) {
    case "declined":
      return "Nothing was saved. Press Export my data to try again.";
    case "rate_limited":
      return "A save is already waiting. Answer it, or wait a moment, then try again.";
    case "too_large":
      return "The file is too big to save here.";
    case "unavailable":
    case "not_granted":
    case "capability_disabled":
    case "capability_removed":
    case "extension_not_enabled":
      return "Saving files isn't available here, so nothing was saved.";
    default:
      return "Couldn't save the file. Press Export my data to try again.";
  }
}

export function mountExportPanel() {
  const button = $<HTMLButtonElement>("data-export-button");
  const status = $<HTMLParagraphElement>("data-export-status");
  const say = (text: string, tone: Tone) => {
    status.textContent = text;
    status.dataset.tone = tone;
  };

  async function run() {
    button.disabled = true;
    say("Collecting your data…", "info");
    try {
      if (!getPlatform().hasRuntime()) {
        say("Export isn't available here, so nothing was saved.", "warn");
        return;
      }
      const downloads = await getPlatform().downloads();
      if (!downloads) {
        say("This view can't save files, so there is nothing to export here.", "warn");
        return;
      }
      const opened = await openUserDb();
      if (!opened.ok) {
        say("Export isn't available here, so nothing was saved.", "warn");
        return;
      }
      const now = new Date();
      const file = buildExport(await collectExport(opened.db, opened.userId), __APP_VERSION__, now);
      const summary = summaryText(file.counts);
      try {
        await downloads.save({ filename: exportFilename(now), data: serializeExport(file) });
      } catch (err) {
        say(saveFailureText((err as { code?: string })?.code), "warn");
        return;
      }
      say(
        file.counts.skipped
          ? `Saved, but not everything: ${summary} Their raw copies are in the file.`
          : `Saved: ${summary}`,
        file.counts.skipped ? "warn" : "ok",
      );
    } catch {
      say(
        "Couldn't read all of your data, so no file was made. Press Export my data to try again.",
        "warn",
      );
    } finally {
      button.disabled = false;
    }
  }

  button.addEventListener("click", () => void run());
}
