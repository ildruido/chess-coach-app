import { expect, test, type Page } from "@playwright/test";
import { showDiagnostics, installFakeStore, squarePoint } from "./helpers";

// Saved coach answers in lessons (CC-027): a question asked again, even in
// other words, gets its saved answer with no coach call. The fake coach counts
// its calls; the fake db keeps answers across reloads (localStorage).
async function installFakes(page: Page) {
  await installFakeStore(page, "u_ale");
  await page.addInitScript(() => {
    const w = window as unknown as { claude: { use: (n: string) => Promise<unknown> } };
    const sample = async (input: string) => {
      localStorage.setItem("ask-calls", String(Number(localStorage.getItem("ask-calls")) + 1));
      const n = localStorage.getItem("ask-calls");
      const question = /The player's question: "(.*)"/.exec(input)?.[1] ?? "";
      let text = `Nothing defends it, so it is free (answer ${n}).\nScope: position`;
      if (input.includes("explained differently")) text = `Said another way (answer ${n}).`;
      else if (/pin/i.test(question))
        text = `A pin holds a piece in front of a bigger one (answer ${n}).\nScope: idea`;
      else if (input.includes("solving this exercise"))
        text = `Look for a piece nothing defends (answer ${n}).`;
      return { text, truncated: false };
    };
    const real = w.claude.use;
    w.claude = { use: async (name: string) => (name === "sample" ? sample : real(name)) };
  });
}

const calls = (page: Page) => page.evaluate(() => Number(localStorage.getItem("ask-calls")));
const answer = (page: Page) => page.locator("#lesson-answer-a");
const answerNote = (page: Page) => page.locator("#lesson-answer-note");
const next = (page: Page) => page.locator("#lesson-next");

async function start(page: Page) {
  await page.goto("/");
  await page.locator("#screen-lessons").click();
  await page
    .locator(".lesson-card")
    .first()
    .getByRole("button", { name: /Start|Resume/ })
    .click();
}

async function ask(page: Page, question: string) {
  await page.locator("#lesson-voice-input").fill(question);
  await page.locator("#lesson-voice-send").click();
}

test.describe("saved coach answers in lessons", () => {
  test.beforeEach(async ({ page }) => showDiagnostics(page));
  test.slow();

  test("a question asked again, in other words, reuses the answer; 👎 stops it; answers survive a reload", async ({
    page,
  }) => {
    await installFakes(page);
    await start(page);
    await expect(page.locator("#lesson-where")).toHaveText("Step 1 of 5");

    await ask(page, "Why can't I take the horse?");
    await expect(answer(page)).toHaveText("Nothing defends it, so it is free (answer 1).", {
      timeout: 15_000,
    });
    await expect(page.locator("#lesson-vote")).toBeVisible();

    // The same question in other words: the saved answer at once, no call.
    await ask(page, "why not capture the knight");
    await expect(answerNote(page)).toHaveText("You asked this before.");
    await expect(answer(page)).toHaveText("Nothing defends it, so it is free (answer 1).");
    expect(await calls(page)).toBe(1);
    await expect(page.locator("#lesson-answer-count")).toHaveText(
      "Lesson questions: 1 reused, 1 asked the coach.",
    );

    // Ask the coach anyway: a new answer.
    await page.locator("#lesson-answer-coach").click();
    await expect(answer(page)).toHaveText("Nothing defends it, so it is free (answer 2).", {
      timeout: 15_000,
    });

    // Another piece is another question.
    await ask(page, "Why can't I take the bishop?");
    await expect.poll(() => calls(page), { timeout: 15_000 }).toBe(3);
    await expect(answerNote(page)).toBeHidden();

    // A general question is reused on another step.
    await ask(page, "What is a pin?");
    await expect(answer(page)).toContainText("A pin holds a piece", { timeout: 15_000 });
    await next(page).click();
    await expect(page.locator("#lesson-where")).toHaveText("Step 2 of 5");
    await ask(page, "what's a pin");
    await expect(answerNote(page)).toHaveText("You asked this before.");
    await expect(answer(page)).toHaveText(
      "A pin holds a piece in front of a bigger one (answer 4).",
    );
    expect(await calls(page)).toBe(4);

    // 👎: never shown again; the next ask goes to the coach.
    await page.locator("#lesson-vote-down").click();
    await expect(page.locator("#lesson-vote-down")).toHaveAttribute("aria-pressed", "true");
    await expect(answerNote(page)).toHaveText("Got it: this answer won't be shown again.");
    await ask(page, "What is a pin?");
    await expect(answer(page)).toContainText("(answer 5)", { timeout: 15_000 });

    // After a reload the saved answers are still there.
    await page.reload();
    await start(page);
    await expect(page.locator("#lesson-where")).toHaveText("Step 2 of 5");
    await page.locator("#lesson-back").click();
    await ask(page, "Why can't I take the horse?");
    await expect(answerNote(page)).toHaveText("You asked this before.");
    expect(await calls(page)).toBe(5);
  });

  test("a near match is offered, and Explain differently reuses saved rewordings first", async ({
    page,
  }) => {
    await installFakes(page);
    await start(page);
    await ask(page, "Why can't the knight run away to safety?");
    await expect(answer(page)).toContainText("(answer 1)", { timeout: 15_000 });

    await ask(page, "Why can't the knight run?");
    await expect(answerNote(page)).toHaveText(
      "Did you mean: “Why can't the knight run away to safety”?",
    );
    await expect(answer(page)).toBeHidden();
    await page.locator("#lesson-answer-show").click();
    await expect(answer(page)).toContainText("(answer 1)");
    expect(await calls(page)).toBe(1);

    const reword = page.locator("#lesson-reword");
    await reword.click();
    await expect(answer(page)).toHaveText("Said another way (answer 2).", { timeout: 15_000 });
    await next(page).click();
    await page.locator("#lesson-back").click();
    await reword.click();
    await expect(answerNote(page)).toHaveText("Explained this way before.");
    await expect(answer(page)).toHaveText("Said another way (answer 2).");
    expect(await calls(page)).toBe(2);
    await expect(reword).toHaveText("Another way");
    await reword.click();
    await expect(answer(page)).toHaveText("Said another way (answer 3).", { timeout: 15_000 });
  });

  test("in an exercise an answer is saved with the position and the engine's best move, and reused there", async ({
    page,
  }) => {
    await installFakes(page);
    await start(page);
    for (let i = 0; i < 4; i++) await next(page).click();
    const p = await squarePoint(page, "lesson-board", "g4");
    await page.mouse.click(p.x, p.y);
    await next(page).click();
    await expect(page.locator("#lesson-text")).toContainText("White to move.");

    await ask(page, "Where should I look?");
    await expect(answer(page)).toHaveText("Look for a piece nothing defends (answer 1).", {
      timeout: 15_000,
    });
    await ask(page, "where do I look");
    await expect(answerNote(page)).toHaveText("You asked this before.", { timeout: 15_000 });
    expect(await calls(page)).toBe(1);
    const saved = await page.evaluate(() =>
      Object.entries(
        JSON.parse(localStorage.getItem("fake-db") ?? "{}") as Record<
          string,
          { meta: { place: string; bestMove: string } }
        >,
      )
        .filter(([k]) => k.startsWith("coach-kb/lesson.") && k.includes("/entries/"))
        .map(([, v]) => v.meta),
    );
    expect(saved).toHaveLength(1);
    expect(saved[0]!.place).toMatch(/^fen:\S+ w /);
    expect(saved[0]!.bestMove).toBe("Rxd8+");
  });
});
