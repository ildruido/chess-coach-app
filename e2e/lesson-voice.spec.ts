import { expect, test, type Page } from "@playwright/test";
import { installFakeStore, squarePoint } from "./helpers";
import puzzleFile from "../src/data/puzzles.json" with { type: "json" };

// Talk to the coach in lessons (CC-057): typed into the box, as the e2e build has no
// microphone (the real one is tested against the web build). Real engine, fake coach and a
// fake speech voice; `spoken` records every sentence read aloud, `calls` every coach call.
// A fake SpeechRecognition throws if the page ever tries to listen on its own.
type Tuple = [string, string, string, number];
const POOL = (puzzleFile.t.hangingPiece as Tuple[]).filter((t) => t[3] <= 800);
const first = POOL[0]!;
const solution = first[2].split(" ").slice(1);

async function install(page: Page) {
  await installFakeStore(page, "u_ale");
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown> & {
      claude: { use: (n: string) => Promise<unknown> };
    };
    const spoken: string[] = [];
    w.spoken = spoken;
    w.cancels = [] as number[];
    class Utterance {
      text: string;
      lang = "";
      voice: unknown = null;
      constructor(text: string) {
        this.text = text;
      }
    }
    Object.defineProperty(window, "SpeechSynthesisUtterance", { value: Utterance });
    Object.defineProperty(window, "speechSynthesis", {
      value: {
        speak: (u: Utterance) => void (u.text.trim() && spoken.push(u.text)),
        cancel: () => void (w.cancels as number[]).push(1),
        resume: () => {},
        getVoices: () => [{ lang: "en-GB", default: true }],
        addEventListener: () => {},
      },
    });
    for (const name of ["SpeechRecognition", "webkitSpeechRecognition"]) {
      Object.defineProperty(window, name, {
        value: function () {
          throw new Error("the page must never listen on its own");
        },
      });
    }
    const sample = async () => {
      localStorage.setItem("voice-calls", String(Number(localStorage.getItem("voice-calls")) + 1));
      return {
        text: "The pawn on e6 guards the knight, so taking it costs your queen.",
        truncated: false,
        modelTierApplied: "quick",
      };
    };
    const real = w.claude.use;
    w.claude = { use: async (name: string) => (name === "sample" ? sample : real(name)) };
  });
}

const spoken = (page: Page) =>
  page.evaluate(() => (Reflect.get(window, "spoken") as string[]).join(" | "));
const calls = (page: Page) => page.evaluate(() => Number(localStorage.getItem("voice-calls")));
const text = (page: Page) => page.locator("#lesson-text");

async function say(page: Page, words: string) {
  await page.locator("#lesson-voice-input").fill(words);
  await page.locator("#lesson-voice-send").click();
}

async function start(page: Page, readAloud = true) {
  await install(page);
  if (readAloud) {
    await page.addInitScript(() => localStorage.setItem("chess-coach.read-aloud", "on"));
  }
  await page.goto("/");
  await page.locator("#screen-lessons").click();
  await page.locator(".lesson-card").first().getByRole("button", { name: "Start" }).click();
  await expect(page.locator("#lesson-where")).toHaveText("Step 1 of 5");
}

test.describe("talk to the coach in lessons", () => {
  test.slow();

  test("a spoken question is answered aloud with one coach call; 'next' and 'repeat' work", async ({
    page,
  }) => {
    await start(page);
    await say(page, "why can the queen take the knight");
    await expect(page.locator("#lesson-answer-a")).toContainText("so taking it costs your queen");
    await expect.poll(() => spoken(page)).toContain("taking it costs your queen");
    expect(await calls(page)).toBe(1);

    await say(page, "repeat");
    await expect.poll(() => spoken(page)).toContain("Black's knight on d5 has no defender");
    expect(await calls(page)).toBe(1);

    await say(page, "next");
    await expect(text(page)).toContainText("Now the pawn on e6 defends the knight");
    await expect.poll(() => spoken(page)).toContain("Now the pawn on e6 defends the knight");
    expect(await calls(page)).toBe(1);
  });

  test("a move said where there is no move to play is answered, not sent to the coach", async ({
    page,
  }) => {
    await start(page);
    await say(page, "play e4");
    await expect(page.locator("#lesson-voice-status")).toHaveText(
      "There is no move to play on this step.",
    );
    await expect(page.locator("#lesson-voice-confirm")).toBeHidden();
    expect(await calls(page)).toBe(0);
  });

  test("exercise: a spoken move is confirmed, a mistake is read out, try again and hint", async ({
    page,
  }) => {
    await start(page);
    // Walk to the first exercise by voice, except the quiz, which wants a click on g4.
    await say(page, "next");
    await say(page, "next");
    await say(page, "next move");
    await expect(text(page)).toContainText("Qxd5: the queen takes the knight");
    await say(page, "next");
    await expect(text(page)).toContainText("One black piece is free. Click it.");
    const p = await squarePoint(page, "lesson-board", "g4");
    await page.mouse.click(p.x, p.y);
    await say(page, "continue");
    await expect(page.locator("#lesson-where")).toHaveText("Step 5 of 5 · Exercise 1 of 5");
    await expect(text(page)).toContainText("White to move.");

    // A move to the wrong square (Rd5 lets Black mate): confirmed first, then warned.
    await say(page, "rook d5");
    await expect(page.locator("#lesson-voice-confirm-text")).toHaveText("Play Rd5?");
    expect(await page.locator("#lesson-board .cg-wrap, #lesson-board").first().isVisible()).toBe(
      true,
    );
    await say(page, "yes");
    await expect(page.locator("#lesson-banner")).toBeVisible({ timeout: 10_000 });
    await expect.poll(() => spoken(page), { timeout: 10_000 }).toContain("lets Black checkmate");

    // Try again by voice, then the engine's hint is read out.
    await say(page, "try again");
    await expect(page.locator("#lesson-banner")).toBeHidden();
    await say(page, "hint");
    await expect(page.locator("#lesson-hint-log li").first()).toBeVisible();
    const hint = (await page.locator("#lesson-hint-log li").first().textContent()) ?? "";
    await expect.poll(() => spoken(page), { timeout: 10_000 }).toContain(hint.slice(0, 20));

    // The right move, said as squares.
    const m = solution[0]!;
    await say(page, `${m.slice(0, 2)} to ${m.slice(2, 4)}`);
    await expect(page.locator("#lesson-voice-confirm")).toBeVisible();
    await say(page, "yes");
    await expect(page.locator("#lesson-voice-confirm")).toBeHidden();
    await expect(text(page)).toContainText(/Solved|Good/, { timeout: 15_000 });
    expect(await calls(page)).toBe(0);
  });

  test("'leave lesson' by voice leaves, and leaving by hand stops the reading", async ({
    page,
  }) => {
    await start(page);
    await say(page, "leave lesson");
    await expect(page.locator("#lesson-play")).toBeHidden();
    await expect(page.locator("#lesson-list")).toBeVisible();
    expect(await calls(page)).toBe(0);

    await page
      .locator(".lesson-card")
      .first()
      .getByRole("button", { name: /Start|Resume/ })
      .click();
    await say(page, "repeat");
    await expect.poll(() => spoken(page)).toContain("Black's knight on d5");
    const before = await page.evaluate(() => (Reflect.get(window, "cancels") as number[]).length);
    await page.locator("#lesson-leave").click();
    await expect
      .poll(() => page.evaluate(() => (Reflect.get(window, "cancels") as number[]).length))
      .toBeGreaterThan(before);
  });

  test("Read aloud in lessons reads suggested answers and the next step; off is quiet", async ({
    page,
  }) => {
    await start(page, false);
    const toggle = page.locator("#lesson-read-aloud-toggle");
    await expect(toggle).toBeVisible();
    await toggle.check();
    // The Practice switch follows the same setting.
    await expect(page.locator("#read-aloud-toggle")).toBeChecked();
    await page.locator("#lesson-questions button").first().click();
    await expect.poll(() => spoken(page)).toContain("The black king on e8 is too far away");
    await page.locator("#lesson-next").click();
    await expect.poll(() => spoken(page)).toContain("Now the pawn on e6 defends the knight");
    await toggle.uncheck();
    const quiet = await spoken(page);
    await page.locator("#lesson-next").click();
    await page.waitForTimeout(1500);
    expect(await spoken(page)).toBe(quiet);
  });

  test("with Read aloud off, answers, hints and results stay text", async ({ page }) => {
    await start(page, false);
    await expect(page.locator("#lesson-read-aloud-toggle")).not.toBeChecked();
    await say(page, "why can the queen take the knight");
    await expect(page.locator("#lesson-answer-a")).toContainText("so taking it costs your queen");
    await say(page, "repeat");
    await say(page, "next");
    await expect(text(page)).toContainText("Now the pawn on e6 defends the knight");
    await say(page, "play e4");
    await expect(page.locator("#lesson-voice-status")).toHaveText(
      "There is no move to play on this step.",
    );
    await page.waitForTimeout(1500);
    expect(await spoken(page)).toBe("");
  });

  test("the Read aloud switch is there on every kind of step, exercises included", async ({
    page,
  }) => {
    await start(page, false);
    const label = page.locator("#lesson-read-aloud-label");
    await expect(label).toBeVisible();
    for (let i = 0; i < 4; i++) {
      await page.locator("#lesson-next").click();
      await expect(label).toBeVisible();
    }
    // The quiz step: the box stays, before and after the answer.
    await expect(text(page)).toContainText("One black piece is free. Click it.");
    await expect(page.locator("#lesson-ask")).toBeVisible();
    await expect(page.locator("#lesson-voice-input")).toBeVisible();
    const p = await squarePoint(page, "lesson-board", "g4");
    await page.mouse.click(p.x, p.y);
    await page.locator("#lesson-next").click();
    await expect(page.locator("#lesson-where")).toHaveText("Step 5 of 5 · Exercise 1 of 5");
    await expect(label).toBeVisible();
    await expect(page.locator("#lesson-coach")).toBeVisible();
    await expect(page.locator("#lesson-ask")).toBeVisible();
    await expect(page.locator("#lesson-voice-input")).toBeVisible();
    // Switching it on in an exercise reads the next hint; off, the following one is silent.
    await expect(text(page)).toContainText("White to move.");
    await page.locator("#lesson-read-aloud-toggle").check();
    await say(page, "hint");
    await expect(page.locator("#lesson-hint-log li").first()).toBeVisible();
    const hint = (await page.locator("#lesson-hint-log li").first().textContent()) ?? "";
    await expect.poll(() => spoken(page)).toContain(hint.slice(0, 20));
  });

  test("typing and speaking share one box: the old question box is gone", async ({ page }) => {
    await start(page);
    await expect(page.locator("#lesson-question")).toHaveCount(0);
    await say(page, "why can the queen take the knight");
    await expect(page.locator("#lesson-answer-q")).toContainText("You asked: why can the queen");
  });

  test("nothing is listening and the box stays quiet until a request is sent", async ({ page }) => {
    await start(page);
    await expect(page.locator("#lesson-voice-chat-label")).toBeHidden();
    await expect(page.locator("#lesson-voice-keyboard-note")).toBeVisible();
    expect(await spoken(page)).toBe("");
  });
});
