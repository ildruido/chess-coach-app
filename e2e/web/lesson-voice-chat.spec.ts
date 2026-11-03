import { expect, test, type Page } from "@playwright/test";
import { signUp } from "./helpers";

// Voice chat in lessons (CC-057) with a fake microphone and a fake voice. `window.said` is what
// the player will say next (one entry per listening turn); `window.log` records what the page did.
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
  await page.locator("#screen-lessons").click();
  await page.locator(".lesson-card").first().getByRole("button", { name: "Start" }).click();
  await expect(page.locator("#lesson-where")).toHaveText("Step 1 of 5");
}

const log = (page: Page) => page.evaluate(() => Reflect.get(window, "log") as string[]);
const saySoon = (page: Page, ...lines: string[]) =>
  page.evaluate((l) => (Reflect.get(window, "said") as string[]).push(...l), lines);

test.describe("voice chat in lessons", () => {
  test.slow();

  test("nothing listens until the switch is turned on", async ({ page }) => {
    await setup(page);
    await expect(page.locator("#lesson-voice-chat-label")).toBeVisible();
    await page.waitForTimeout(500);
    expect(await log(page)).toEqual([]);
  });

  test("a spoken question is answered aloud, then it listens again; 'next' goes on", async ({
    page,
  }) => {
    await setup(page);
    await saySoon(page, "why is the knight free", "next");
    await page.locator("#lesson-voice-chat-toggle").check();
    await expect(page.locator("#lesson-answer-q")).toHaveText("You asked: why is the knight free", {
      timeout: 20_000,
    });
    await expect(page.locator("#lesson-text")).toContainText(
      "Now the pawn on e6 defends the knight",
      { timeout: 20_000 },
    );
    const events = await log(page);
    expect(events.some((l) => l.startsWith("say:"))).toBe(true);
    expect(events).not.toContain("LISTENED WHILE SPEAKING");
    await expect(page.locator("#lesson-voice-chat-state")).toContainText(
      /Listening|speaking|Thinking/,
    );
  });

  test("leaving the lesson ends voice chat and stops listening", async ({ page }) => {
    await setup(page);
    await page.locator("#lesson-voice-chat-toggle").check();
    await expect(page.locator("#lesson-voice-chat-state")).toContainText("Listening");
    await page.locator("#lesson-leave").click();
    await expect(page.locator("#lesson-voice-chat-toggle")).not.toBeChecked();
    const listens = (await log(page)).filter((l) => l === "listen").length;
    await page.waitForTimeout(800);
    expect((await log(page)).filter((l) => l === "listen").length).toBe(listens);
  });

  test("saying 'leave lesson' leaves it and ends voice chat; the next lesson works again", async ({
    page,
  }) => {
    await setup(page);
    await saySoon(page, "leave lesson");
    await page.locator("#lesson-voice-chat-toggle").check();
    await expect(page.locator("#lesson-list")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#lesson-voice-chat-toggle")).not.toBeChecked();
    const listens = (await log(page)).filter((l) => l === "listen").length;
    await page.waitForTimeout(800);
    expect((await log(page)).filter((l) => l === "listen").length).toBe(listens);

    // A second visit works the same way.
    await page
      .locator(".lesson-card")
      .first()
      .getByRole("button", { name: /Start|Resume/ })
      .click();
    await saySoon(page, "why is the knight free", "leave lesson");
    await page.locator("#lesson-voice-chat-toggle").check();
    await expect(page.locator("#lesson-list")).toBeVisible({ timeout: 25_000 });
    await expect(page.locator("#lesson-voice-chat-toggle")).not.toBeChecked();
  });

  test("going to Practice ends voice chat", async ({ page }) => {
    await setup(page);
    await page.locator("#lesson-voice-chat-toggle").check();
    await expect(page.locator("#lesson-voice-chat-state")).toContainText("Listening");
    await page.locator("#screen-practice").click();
    await expect(page.locator("#lesson-voice-chat-toggle")).not.toBeChecked();
  });
});
