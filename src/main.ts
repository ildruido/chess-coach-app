import "./style.css";
import { setPlatform } from "./platform";
import { createWebPlatform } from "./platform/web";
import { mountSessionBar, requireSignIn } from "./web/auth-screen";
import { StockfishEngine } from "./engine/stockfish";
import { mountDiagnosticsSwitch } from "./diagnostics";
import { mountExportPanel } from "./export/export-panel";
import { mountImportPanel } from "./export/import-panel";
import { openHistoryStore } from "./storage/history-store";
import { mountLessonPanel } from "./lessons/lesson-panel";
import { mountPracticePanel } from "./practice/practice-panel";
import { mountUsageBanner } from "./practice/usage-banner";
import { sourceUrl } from "./about/source-link";
import { mountReadAloud, stopReading } from "./voice/read-aloud";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

$("version").textContent = `v${__APP_VERSION__}`;
$<HTMLAnchorElement>("source-link").href = sourceUrl(__APP_VERSION__);
if (__E2E__) {
  // The e2e build has no server: the specs fake `window.claude`.
  setPlatform((await import("./platform/e2e")).fakeRuntimePlatform);
} else {
  // The web app runs on the server's /api routes and starts only once someone is signed in.
  setPlatform(createWebPlatform());
  mountSessionBar(await requireSignIn(), $("version"));
}
const engine = new StockfishEngine();
mountUsageBanner();
mountExportPanel();
mountDiagnosticsSwitch();
if (!__E2E__) mountImportPanel();
mountReadAloud();
mountPracticePanel(engine);
const lessons = mountLessonPanel(engine, async () => {
  const r = await openHistoryStore();
  return r.ok ? (await r.store.list()).records : [];
});

// Two screens: Practice and Lessons. The last one used opens next time.
const SCREEN_KEY = "chess-coach.screen";
const LEDE: Record<"practice" | "lessons", [string, string]> = {
  practice: ["Practice", $("page-lede").textContent ?? ""],
  lessons: [
    "Lessons",
    "Short lessons on the board: the coach explains an idea, then you practise it. The engine warns you before a move that loses something.",
  ],
};
function showScreen(name: "practice" | "lessons") {
  stopReading();
  $("practice-screen").hidden = name !== "practice";
  $("lessons-screen").hidden = name !== "lessons";
  $("screen-practice").setAttribute("aria-pressed", String(name === "practice"));
  $("screen-lessons").setAttribute("aria-pressed", String(name === "lessons"));
  $("page-title").textContent = LEDE[name][0];
  $("page-lede").textContent = LEDE[name][1];
  if (name === "lessons") void lessons.show();
  try {
    localStorage.setItem(SCREEN_KEY, name);
  } catch {
    // Only a convenience.
  }
}
$("screen-practice").addEventListener("click", () => showScreen("practice"));
$("screen-lessons").addEventListener("click", () => showScreen("lessons"));
let lastScreen: string | null = null;
try {
  lastScreen = localStorage.getItem(SCREEN_KEY);
} catch {
  // Practice first.
}
showScreen(lastScreen === "lessons" ? "lessons" : "practice");
