import { expect, test, type Page } from "@playwright/test";
import { installFakeStore } from "./helpers";

// Exploratory QA for CC-033: edge cases around the "Talk to the coach" box.
async function install(page: Page, seed?: string[]) {
  await installFakeStore(page, "u_ale");
  await page.addInitScript((moves: string[] | null) => {
    if (moves && !sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      const at = new Date().toISOString();
      const all = JSON.parse(localStorage.getItem("fake-db") ?? "{}");
      all["data/users/u_ale/practice-game"] = {
        version: 1,
        moves,
        createdAt: at,
        updatedAt: at,
        level: 1,
        color: "white",
        resigned: false,
        hints: [],
        hintMode: "tell",
      };
      localStorage.setItem("fake-db", JSON.stringify(all));
    }
    const w = window as unknown as Record<string, unknown> & {
      claude: { use: (n: string) => Promise<unknown> };
    };
    w.sampleInputs = [] as string[];
    w.gate = null as null | (() => void);
    const sample = async (input: string) => {
      (w.sampleInputs as string[]).push(input);
      if (localStorage.getItem("slow")) await new Promise<void>((r) => (w.gate = r));
      return {
        text: input.includes("The player's question")
          ? "A strong centre gives your pieces room to move."
          : "Take space in the middle of the board.",
        truncated: false,
        modelTierApplied: "quick",
      };
    };
    const real = w.claude.use;
    w.claude = { use: async (n: string) => (n === "sample" ? sample : real(n)) };
  }, seed ?? null);
}
const prompts = (page: Page) =>
  page.evaluate(() => Reflect.get(window, "sampleInputs") as string[]);
async function start(page: Page) {
  await page.locator("#practice-level").selectOption("1");
  await page.locator("#practice-setup").getByLabel("White").check();
  await page.getByRole("button", { name: "Start game" }).click();
  await expect(page.locator("#practice-status")).toHaveText("Your move.");
}
async function say(page: Page, text: string) {
  await page.locator("#voice-input").fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}

test.describe("voice QA", () => {
  test.slow();

  test("no horizontal scroll with answer and confirmation shown", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await install(page);
    await page.goto("/");
    await start(page);
    await say(
      page,
      "why is the centre important and what about all the long words in this very long question please explain thoroughly",
    );
    await expect(page.locator("#voice-answer-text")).toContainText("centre", { timeout: 15_000 });
    await say(page, "play e4");
    await expect(page.locator("#voice-confirm")).toBeVisible();
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(over).toBeLessThanOrEqual(0);
  });

  test("pending confirmation is cleared when the board changes (take back / new game)", async ({
    page,
  }) => {
    await install(page);
    await page.goto("/");
    await start(page);
    await page.locator("#practice-board").scrollIntoViewIfNeeded();
    await say(page, "play e4");
    await expect(page.locator("#voice-confirm")).toBeVisible();
    await page.locator("#practice-resign").click();
    await expect(page.locator("#voice-confirm")).toBeHidden();
    await say(page, "yes");
    await expect(page.locator("#practice-moves")).toHaveAttribute("data-count", "0");
  });

  test("new game clears the answer and a late answer is dropped", async ({ page }) => {
    await install(page);
    await page.goto("/");
    await start(page);
    await say(page, "why is the centre important?");
    await expect(page.locator("#voice-answer-text")).toContainText("centre", { timeout: 15_000 });
    await page.locator("#practice-new").click();
    await expect(page.locator("#voice-answer")).toBeHidden();
    await start(page);
    await expect(page.locator("#voice-answer")).toBeHidden();
  });

  test("late answer after New game is dropped", async ({ page }) => {
    await install(page);
    await page.addInitScript(() => localStorage.setItem("slow", "1"));
    await page.goto("/");
    await start(page);
    await say(page, "why is the centre important?");
    await expect(page.locator("#voice-answer-text")).toHaveText("The coach is writing…", {
      timeout: 15_000,
    });
    await page.locator("#practice-new").click();
    await page.evaluate(() => (Reflect.get(window, "gate") as () => void)());
    await start(page);
    await expect(page.locator("#voice-answer")).toBeHidden();
    await expect(page.locator("#voice-send")).toBeEnabled();
  });

  test("double Send sends one request", async ({ page }) => {
    await install(page);
    await page.addInitScript(() => localStorage.setItem("slow", "1"));
    await page.goto("/");
    await start(page);
    await say(page, "why is the centre important?");
    await expect(page.locator("#voice-answer-text")).toHaveText("The coach is writing…", {
      timeout: 15_000,
    });
    await expect(page.locator("#voice-send")).toBeDisabled();
    await page.locator("#voice-input").fill("what is a fork?");
    await page.locator("#voice-input").press("Enter");
    expect((await prompts(page)).length).toBe(1);
    await page.evaluate(() => (Reflect.get(window, "gate") as () => void)());
    await expect(page.locator("#voice-answer-text")).toContainText("centre");
  });

  test("hint when it is not your turn is refused; question while engine thinks", async ({
    page,
  }) => {
    await install(page);
    await page.goto("/");
    await page.locator("#practice-level").selectOption("1");
    await page.locator("#practice-setup").getByLabel("Black").check();
    await page.getByRole("button", { name: "Start game" }).click();
    // engine is to move first
    await say(page, "give me a hint");
    const st = await page.locator("#voice-status").textContent();
    const n = (await prompts(page)).length;
    await expect(page.locator("#practice-status")).toHaveText("Your move.", { timeout: 15_000 });
    expect(st === "" ? "" : st).toMatch(/hint right now|Asking/);
    expect(n).toBe(0);
  });

  test("question while engine thinks does not break the move", async ({ page }) => {
    await install(page);
    await page.goto("/");
    await start(page);
    await say(page, "play e4");
    await page.getByRole("button", { name: "Play it" }).click();
    await say(page, "why is the centre important?");
    await expect(page.locator("#voice-answer-text")).toContainText("centre", { timeout: 20_000 });
    await expect(page.locator("#practice-status")).toHaveText("Your move.", { timeout: 15_000 });
  });

  test("spoken promotion to a knight is offered as a move", async ({ page }) => {
    await install(page, ["a2a4", "b7b5", "a4b5", "a7a6", "b5a6", "g8f6", "a6a7", "f6g8"]);
    await page.goto("/");
    await expect(page.locator("#practice-status")).toHaveText(/^Your move/, { timeout: 15_000 });
    await say(page, "a7 to b8 promote to a knight");
    await expect(page.locator("#voice-confirm-text")).toHaveText("Play axb8=N?");
  });

  test("promotion by voice", async ({ page }) => {
    await install(page, ["a2a4", "b7b5", "a4b5", "a7a6", "b5a6", "g8f6", "a6a7", "f6g8"]);
    await page.goto("/");
    await expect(page.locator("#practice-status")).toHaveText(/^Your move/, { timeout: 15_000 });
    await say(page, "axb8 promote to knight");
    await expect(page.locator("#voice-confirm-text")).toContainText("N");
    await page.getByRole("button", { name: "Play it" }).click();
    await expect(page.locator("#practice-moves")).toHaveAttribute("data-count", "9", {
      timeout: 15_000,
    });
    await expect(page.locator("#practice-moves")).toContainText("=N");
  });

  test("resign then review by voice", async ({ page }) => {
    await install(page, ["e2e4", "e7e5", "d1h5", "b8c6", "h5f7"]);
    await page.goto("/");
    await expect(page.locator("#practice-status")).toHaveText(/^Your move/, { timeout: 15_000 });
    await page.locator("#practice-resign").click();
    await say(page, "review");
    await expect(page.locator("#voice-status")).toContainText("Starting the review");
    await expect(page.locator("#review-points li").first()).toBeVisible({ timeout: 40_000 });
  });
});
