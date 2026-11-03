import { expect, test, type Page } from "@playwright/test";
import { installFakeStore, tapMove } from "./helpers";

// Real engine, fake Claude and a fake speech voice (CC-032). The fake voice
// records every sentence in `window.spoken` and every stop in `window.cancels`.
// It never finishes a sentence by itself, so "Stop reading" stays up until
// `window.finishSpeech()` is called. `voices` = 0 is a device with no voice.
async function install(page: Page, voices = 1) {
  await installFakeStore(page, "u_ale");
  await page.addInitScript((voiceCount: number) => {
    const w = window as unknown as Record<string, unknown> & {
      claude: { use: (n: string) => Promise<unknown> };
    };
    const spoken: string[] = [];
    let queue: { onend?: () => void }[] = [];
    w.spoken = spoken;
    w.cancels = 0;
    w.finishSpeech = () => {
      for (const u of queue) u.onend?.();
      queue = [];
    };
    class Utterance {
      text: string;
      lang = "";
      voice: unknown = null;
      onend?: () => void;
      onerror?: () => void;
      constructor(text: string) {
        this.text = text;
      }
    }
    Object.defineProperty(window, "SpeechSynthesisUtterance", { value: Utterance });
    Object.defineProperty(window, "speechSynthesis", {
      value: {
        speak: (u: Utterance) => {
          if (u.text.trim()) spoken.push(u.text);
          queue.push(u);
        },
        cancel: () => {
          w.cancels = (w.cancels as number) + 1;
          queue = [];
        },
        resume: () => {},
        getVoices: () =>
          Array.from({ length: voiceCount }, () => ({ lang: "en-GB", default: true })),
        addEventListener: () => {},
      },
    });
    const sample = async (input: string) => {
      const text = input.includes("commenting on a beginner's last move")
        ? "Coach: it weakens your king."
        : "Take space in the middle of the board.";
      return { text, truncated: false, modelTierApplied: "quick" };
    };
    const real = w.claude.use;
    w.claude = { use: async (name: string) => (name === "sample" ? sample : real(name)) };
  }, voices);
}

const spoken = (page: Page) => page.evaluate(() => Reflect.get(window, "spoken") as string[]);
const cancels = (page: Page) => page.evaluate(() => Reflect.get(window, "cancels") as number);
const toggle = (page: Page) => page.locator("#read-aloud-toggle");
const stopBtn = (page: Page) => page.getByRole("button", { name: "Stop reading" });

async function startAsWhite(page: Page) {
  await page.locator("#practice-level").selectOption("1");
  await page.locator("#practice-setup").getByLabel("White").check();
  await page.getByRole("button", { name: "Start game" }).click();
  await expect(page.locator("#practice-status")).toHaveText("Your move.");
}

test.describe("coach reads aloud", () => {
  test.slow();

  test("is off by default and stays on after a reload", async ({ page }) => {
    await install(page);
    await page.goto("/");
    await startAsWhite(page);
    await expect(toggle(page)).toBeVisible();
    await expect(toggle(page)).not.toBeChecked();
    await page.getByRole("button", { name: "Hint: the plan" }).click();
    await expect(page.locator("#hint-log li")).toHaveCount(1, { timeout: 15_000 });
    expect(await spoken(page)).toEqual([]);
    await toggle(page).check();
    await page.reload();
    await expect(toggle(page)).toBeChecked();
  });

  test("when on, reads hints and comments; a move and Stop stop it", async ({ page, hasTouch }) => {
    await install(page);
    await page.goto("/");
    await startAsWhite(page);
    await toggle(page).check();
    await page.locator("#commentary-toggle").check();

    await page.getByRole("button", { name: "Hint: the plan" }).click();
    await expect.poll(() => spoken(page)).toEqual(["Take space in the middle of the board."]);
    await expect(stopBtn(page)).toBeVisible();

    // Ale's move stops the hint; the comment on that move is read next.
    const before = await cancels(page);
    await tapMove(page, "practice-board", "g2", "g4", hasTouch);
    await expect.poll(() => cancels(page)).toBeGreaterThan(before);
    await expect
      .poll(() => spoken(page), { timeout: 15_000 })
      .toContain("Coach: it weakens your king.");
    expect((await spoken(page)).some((s) => s.startsWith("g4: "))).toBe(true);

    await expect(stopBtn(page)).toBeVisible();
    const beforeStop = await cancels(page);
    await stopBtn(page).click();
    await expect(stopBtn(page)).toBeHidden();
    expect(await cancels(page)).toBeGreaterThan(beforeStop);
  });

  test("turning the switch off stops reading", async ({ page }) => {
    await install(page);
    await page.goto("/");
    await startAsWhite(page);
    await toggle(page).check();
    await page.getByRole("button", { name: "Hint: the plan" }).click();
    await expect(stopBtn(page)).toBeVisible({ timeout: 15_000 });
    await toggle(page).uncheck();
    await expect(stopBtn(page)).toBeHidden();
  });

  test("Stop reading hides once the coach has finished", async ({ page }) => {
    await install(page);
    await page.goto("/");
    await startAsWhite(page);
    await toggle(page).check();
    await page.getByRole("button", { name: "Hint: the plan" }).click();
    await expect(stopBtn(page)).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => (Reflect.get(window, "finishSpeech") as () => void)());
    await expect(stopBtn(page)).toBeHidden();
  });

  test("a device with no voice hides the switch and says why", async ({ page }) => {
    await install(page, 0);
    await page.goto("/");
    await startAsWhite(page);
    await expect(page.locator("#read-aloud-note")).toContainText("no voice", { timeout: 5_000 });
    await expect(toggle(page)).toBeHidden();
  });

  test("says what voice can do here, and a long answer is read in short pieces", async ({
    page,
  }) => {
    await install(page);
    await page.addInitScript(() => {
      const w = window as unknown as { claude: { use: (n: string) => Promise<unknown> } };
      const real = w.claude.use;
      const long = `${"Keep your pieces protected, ".repeat(12)}and play on.`;
      w.claude = {
        use: async (name: string) =>
          name === "sample"
            ? async () => ({ text: long, truncated: false, modelTierApplied: "quick" })
            : real(name),
      };
    });
    await page.goto("/");
    await startAsWhite(page);
    // The Claude-app build cannot use the microphone, so the line points to the keyboard.
    await expect(page.locator("#voice-support")).toContainText("can't listen");
    await toggle(page).check();
    await page.getByRole("button", { name: "Hint: the plan" }).click();
    await expect.poll(async () => (await spoken(page)).length).toBeGreaterThan(1);
    expect((await spoken(page)).every((t) => t.length <= 160)).toBe(true);
  });

  test("leaving the page stops reading", async ({ page }) => {
    await install(page);
    await page.goto("/");
    await startAsWhite(page);
    await toggle(page).check();
    await page.getByRole("button", { name: "Hint: the plan" }).click();
    await expect(stopBtn(page)).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { value: true, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(stopBtn(page)).toBeHidden();
  });
});
