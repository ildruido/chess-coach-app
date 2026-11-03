import { expect, test, type Page } from "@playwright/test";
import { installFakeStore } from "./helpers";

// Real engine, fake Claude and a fake speech voice (CC-033). `spoken` records
// every sentence read aloud, `sampleInputs` every coach prompt. A fake
// SpeechRecognition throws if the page ever tries to listen on its own.
async function install(page: Page) {
  await installFakeStore(page, "u_ale");
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown> & {
      claude: { use: (n: string) => Promise<unknown> };
    };
    const spoken: string[] = [];
    w.spoken = spoken;
    w.sampleInputs = [] as string[];
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
        cancel: () => {},
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
    const sample = async (input: string) => {
      (w.sampleInputs as string[]).push(input);
      const text = input.includes("The player's question")
        ? "A strong centre gives your pieces room to move."
        : "Take space in the middle of the board.";
      return { text, truncated: false, modelTierApplied: "quick" };
    };
    const real = w.claude.use;
    w.claude = { use: async (name: string) => (name === "sample" ? sample : real(name)) };
  });
}

/** Turns the Read aloud switch on before the page loads (it is remembered on the device). */
const readAloudOn = (page: Page) =>
  page.addInitScript(() => localStorage.setItem("chess-coach.read-aloud", "on"));

const spoken = (page: Page) => page.evaluate(() => Reflect.get(window, "spoken") as string[]);
const prompts = (page: Page) =>
  page.evaluate(() => Reflect.get(window, "sampleInputs") as string[]);
const moveCount = (page: Page) => page.locator("#practice-moves").getAttribute("data-count");

async function startAsWhite(page: Page) {
  await page.locator("#practice-level").selectOption("1");
  await page.locator("#practice-setup").getByLabel("White").check();
  await page.getByRole("button", { name: "Start game" }).click();
  await expect(page.locator("#practice-status")).toHaveText("Your move.");
}

async function say(page: Page, text: string) {
  await page.locator("#voice-input").fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

test.describe("talk to the coach", () => {
  test.slow();

  test("a spoken move is confirmed before it is played", async ({ page }) => {
    await install(page);
    await readAloudOn(page);
    await page.goto("/");
    await startAsWhite(page);
    await say(page, "play e four");
    await expect(page.locator("#voice-confirm-text")).toHaveText("Play e4?");
    expect(await moveCount(page)).toBe("0");
    expect(await spoken(page)).toContain("Play e4?");
    await say(page, "yes");
    await expect(page.locator("#practice-moves")).toHaveAttribute("data-count", "2", {
      timeout: 15_000,
    });
    await expect(page.locator("#voice-confirm")).toBeHidden();
    expect((await prompts(page)).length).toBe(0);
  });

  test("everyday wording: a side word plays, a vague one asks which", async ({ page }) => {
    await install(page);
    await page.goto("/");
    await startAsWhite(page);
    await say(page, "the right knight to f3");
    await expect(page.locator("#voice-confirm-text")).toHaveText("Play Nf3?");
    await say(page, "no");
    await say(page, "a pawn two squares");
    await expect(page.locator("#voice-status")).toContainText("Which pawn:");
    expect(await moveCount(page)).toBe("0");
    await say(page, "the one on e2");
    await expect(page.locator("#voice-confirm-text")).toHaveText("Play e4?");
    expect((await prompts(page)).length).toBe(0);
  });

  test("the Play it button also confirms, and no cancels", async ({ page }) => {
    await install(page);
    await page.goto("/");
    await startAsWhite(page);
    await say(page, "knight f3");
    await expect(page.locator("#voice-confirm-text")).toHaveText("Play Nf3?");
    await say(page, "no");
    await expect(page.locator("#voice-confirm")).toBeHidden();
    await expect(page.locator("#voice-status")).toContainText("Nothing was played");
    expect(await moveCount(page)).toBe("0");
    await say(page, "e2 to e4");
    await page.getByRole("button", { name: "Play it" }).click();
    await expect(page.locator("#practice-moves")).toHaveAttribute("data-count", "2", {
      timeout: 15_000,
    });
  });

  test("a move that isn't possible is explained, not offered", async ({ page }) => {
    await install(page);
    await page.goto("/");
    await startAsWhite(page);
    await say(page, "play e5");
    await expect(page.locator("#voice-status")).toContainText("isn't a move you can make");
    await expect(page.locator("#voice-confirm")).toBeHidden();
  });

  test("asking for a hint reads it aloud only when Read aloud is on", async ({ page }) => {
    await install(page);
    await readAloudOn(page);
    await page.goto("/");
    await startAsWhite(page);
    await say(page, "give me a hint");
    await expect(page.locator("#hint-log li")).toHaveCount(1, { timeout: 15_000 });
    await expect.poll(() => spoken(page)).toContain("Take space in the middle of the board.");
  });

  test("with Read aloud off, talking to the coach stays text", async ({ page }) => {
    await install(page);
    await page.goto("/");
    await startAsWhite(page);
    await expect(page.locator("#read-aloud-toggle")).not.toBeChecked();
    await say(page, "give me a hint");
    await expect(page.locator("#hint-log li")).toHaveCount(1, { timeout: 15_000 });
    await say(page, "why is the centre important?");
    await expect(page.locator("#voice-answer-text")).toHaveText(
      "A strong centre gives your pieces room to move.",
      { timeout: 15_000 },
    );
    await say(page, "play e four");
    await expect(page.locator("#voice-confirm-text")).toHaveText("Play e4?");
    await page.waitForTimeout(500);
    expect(await spoken(page)).toEqual([]);
  });

  test("a question is answered on the page and aloud, with the best move kept secret", async ({
    page,
  }) => {
    await install(page);
    await readAloudOn(page);
    await page.goto("/");
    await startAsWhite(page);
    expect((await prompts(page)).length).toBe(0);
    await say(page, "why is the centre important?");
    await expect(page.locator("#voice-answer-text")).toHaveText(
      "A strong centre gives your pieces room to move.",
      { timeout: 15_000 },
    );
    await expect(page.locator("#voice-answer-q")).toHaveText(
      "You asked: why is the centre important?",
    );
    await expect
      .poll(() => spoken(page))
      .toContain("A strong centre gives your pieces room to move.");
    await page.getByRole("button", { name: "Hint: the plan" }).click();
    await expect(page.locator("#hint-log li")).toHaveCount(1, { timeout: 15_000 });
    const sent = await prompts(page);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toContain("kept secret");
    expect(sent[0]).not.toContain("Engine best move");
  });

  test("the review is only for a finished game", async ({ page }) => {
    await install(page);
    await page.goto("/");
    await startAsWhite(page);
    await say(page, "review the game");
    await expect(page.locator("#voice-status")).toContainText("once the game is over");
  });
});
