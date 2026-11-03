import { expect, test, type Page } from "@playwright/test";
import { signUp } from "./helpers";

// Voice chat (CC-039b) with a fake microphone and a fake voice. `window.said` is what the
// player will say next (one entry per listening turn); `window.log` records what the page did.
async function setup(page: Page) {
  await page.addInitScript(() => {
    // Answers are only spoken with Read aloud on.
    localStorage.setItem("chess-coach.read-aloud", "on");
    const w = window as unknown as Record<string, unknown>;
    const log: string[] = [];
    w.log = log;
    w.said = [] as string[];
    w.speaking = false;
    class Rec {
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      timer: ReturnType<typeof setTimeout> | undefined;
      start() {
        if (w.speaking) log.push("LISTENED WHILE SPEAKING");
        log.push("listen");
        const next = (w.said as string[]).shift();
        if (next === undefined) return;
        this.timer = setTimeout(() => {
          this.onresult?.({
            results: [Object.assign([{ transcript: next }], { isFinal: true })],
          });
          this.onend?.();
        }, 60);
      }
      stop() {
        clearTimeout(this.timer);
        log.push("stop-listening");
        this.onend?.();
      }
    }
    Object.defineProperty(window, "SpeechRecognition", { value: Rec });
    class Utterance {
      text: string;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      lang = "";
      voice: unknown = null;
      volume = 1;
      constructor(text: string) {
        this.text = text;
      }
    }
    Object.defineProperty(window, "SpeechSynthesisUtterance", { value: Utterance });
    Object.defineProperty(window, "speechSynthesis", {
      value: {
        speaking: false,
        pending: false,
        speak(u: Utterance) {
          if (!u.text.trim()) return;
          log.push(`say:${u.text}`);
          w.speaking = true;
          setTimeout(() => {
            w.speaking = false;
            u.onend?.();
          }, 150);
        },
        cancel() {
          w.speaking = false;
        },
        resume() {},
        getVoices: () => [{ lang: "en-GB", default: true }],
        addEventListener() {},
      },
    });
  });
  await signUp(page);
  await page.locator("#practice-level").selectOption("1");
  await page.locator("#practice-setup").getByLabel("White").check();
  await page.getByRole("button", { name: "Start game" }).click();
  await expect(page.locator("#practice-status")).toHaveText("Your move.");
}

const log = (page: Page) => page.evaluate(() => Reflect.get(window, "log") as string[]);
const saySoon = (page: Page, ...lines: string[]) =>
  page.evaluate((l) => (Reflect.get(window, "said") as string[]).push(...l), lines);

test.describe("voice chat", () => {
  test.slow();

  test("nothing listens until the switch is turned on", async ({ page }) => {
    await setup(page);
    await expect(page.locator("#voice-chat-label")).toBeVisible();
    await page.waitForTimeout(500);
    expect(await log(page)).toEqual([]);
  });

  test("a spoken question is answered aloud, then it listens again", async ({ page }) => {
    await setup(page);
    await saySoon(page, "why is the centre important");
    await page.locator("#voice-chat-toggle").check();
    await expect(page.locator("#voice-chat-state")).toBeVisible();
    await expect(page.locator("#voice-answer-q")).toHaveText(
      "You asked: why is the centre important",
      { timeout: 20_000 },
    );
    await expect.poll(async () => (await log(page)).filter((l) => l === "listen").length).toBe(2);
    const events = await log(page);
    expect(events.some((l) => l.startsWith("say:"))).toBe(true);
    expect(events).not.toContain("LISTENED WHILE SPEAKING");
    // The second listen came after the answer was read.
    expect(events.indexOf("listen", 1)).toBeGreaterThan(
      events.findIndex((l) => l.startsWith("say:")),
    );
    await expect(page.locator("#voice-chat-state")).toContainText("Listening");
  });

  test("a spoken move still needs a spoken yes", async ({ page }) => {
    await setup(page);
    await saySoon(page, "play e4", "yes");
    await page.locator("#voice-chat-toggle").check();
    await expect(page.locator("#practice-moves")).toHaveAttribute("data-count", "2", {
      timeout: 20_000,
    });
    expect(await log(page)).toContain("say:Say yes, or press Play it.");
  });

  test("saying stop, or switching off, ends it and stops listening", async ({ page }) => {
    await setup(page);
    await saySoon(page, "stop");
    await page.locator("#voice-chat-toggle").check();
    await expect(page.locator("#voice-chat-toggle")).not.toBeChecked();
    await expect(page.locator("#voice-chat-state")).toBeHidden();
    const listens = (await log(page)).filter((l) => l === "listen").length;
    await page.waitForTimeout(800);
    expect((await log(page)).filter((l) => l === "listen").length).toBe(listens);

    await page.locator("#voice-chat-toggle").check();
    await expect(page.locator("#voice-chat-state")).toContainText("Listening");
    await page.locator("#voice-chat-toggle").uncheck();
    await expect(page.locator("#voice-chat-state")).toBeHidden();
    await expect(page.locator("#voice-mic")).toBeEnabled();
  });

  test("a blocked microphone ends it with a clear message", async ({ page }) => {
    await setup(page);
    await page.evaluate(() => {
      const R = Reflect.get(window, "SpeechRecognition") as { prototype: Record<string, unknown> };
      R.prototype.start = function (this: { onerror: (e: unknown) => void; onend: () => void }) {
        setTimeout(() => {
          this.onerror({ error: "not-allowed" });
          this.onend();
        }, 30);
      };
    });
    await page.locator("#voice-chat-toggle").check();
    await expect(page.locator("#voice-status")).toContainText("microphone is blocked");
    await expect(page.locator("#voice-chat-toggle")).not.toBeChecked();
  });

  test("voice chat ends when the page goes to the background", async ({ page }) => {
    await setup(page);
    await page.locator("#voice-chat-toggle").check();
    await expect(page.locator("#voice-chat-state")).toContainText("Listening");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { value: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.locator("#voice-chat-toggle")).not.toBeChecked();
    await expect(page.locator("#voice-status")).toContainText("no longer in view");
  });
});
