import { expect, test, type Page } from "@playwright/test";
import { installFakeStore, squarePoint, tapMove } from "./helpers";

// Ask the coach in lessons (CC-026): suggested questions answer for free; Ale's
// own question and "Explain differently" make one coach call each, on the real
// engine's facts. The fake coach counts its calls and keeps the last prompt.
async function installFakes(page: Page, fail?: string) {
  await installFakeStore(page, "u_ale");
  await page.addInitScript((failCode) => {
    const w = window as unknown as { claude: { use: (n: string) => Promise<unknown> } };
    const sample = async (input: string) => {
      localStorage.setItem("ask-calls", String(Number(localStorage.getItem("ask-calls")) + 1));
      localStorage.setItem("ask-prompt", input);
      if (failCode) throw { code: failCode, message: "fake" };
      const question = /The player's question: "(.*)"/.exec(input)?.[1] ?? "";
      let text = "The pawn on e6 guards the knight, so taking it costs your queen.";
      if (input.includes("explained differently")) text = "Simpler: a guarded piece is not free.";
      else if (input.includes("solving this exercise")) text = "Look for a piece nothing defends.";
      else if (question.includes("Nf3")) text = "Play Nf3 instead.";
      else if (question.includes("Qxd5")) text = "After Qxd5 exd5 the pawn takes your queen.";
      return { text, truncated: false };
    };
    const real = w.claude.use;
    w.claude = { use: async (name: string) => (name === "sample" ? sample : real(name)) };
  }, fail);
}

const calls = (page: Page) => page.evaluate(() => Number(localStorage.getItem("ask-calls")));
const answer = (page: Page) => page.locator("#lesson-answer-a");
const next = (page: Page) => page.locator("#lesson-next");

async function start(page: Page) {
  await page.goto("/");
  await page.locator("#screen-lessons").click();
  await page.locator(".lesson-card").first().getByRole("button", { name: "Start" }).click();
  await expect(page.locator("#lesson-where")).toHaveText("Step 1 of 5");
}

async function ask(page: Page, question: string) {
  await page.locator("#lesson-voice-input").fill(question);
  await page.locator("#lesson-voice-send").click();
}

test.describe("ask the coach in lessons", () => {
  test.slow();

  test("suggested questions, own questions, the fact check and Explain differently", async ({
    page,
  }) => {
    await installFakes(page);
    await start(page);

    // Step 1: a suggested question shows its written answer, with no coach call.
    const questions = page.locator("#lesson-questions button");
    await expect(questions).toHaveCount(3);
    await questions.filter({ hasText: "Why is the knight free?" }).click();
    await expect(page.locator("#lesson-answer-q")).toHaveText("Why is the knight free?");
    await expect(answer(page)).toContainText("The black king on e8 is too far away");
    expect(await calls(page)).toBe(0);

    // Step 2: a question naming a move gets the engine's answer in the prompt.
    await next(page).click();
    await expect(page.locator("#lesson-answer")).toBeHidden();
    await ask(page, "What if Qxd5?");
    await expect(answer(page)).toHaveText("After Qxd5 exd5 the pawn takes your queen.", {
      timeout: 15_000,
    });
    expect(await calls(page)).toBe(1);
    const prompt = await page.evaluate(() => localStorage.getItem("ask-prompt"));
    expect(prompt).toContain("The player asks about the move Qxd5");
    expect(prompt).toContain("The engine's best answer to it: exd5");

    // An answer naming a move the engine never gave is held back; asking again is a new click.
    await ask(page, "Why not Nf3?");
    await expect(answer(page)).toHaveText(
      "The coach's answer didn't match the engine, so it isn't shown. Ask again to try once more.",
      { timeout: 15_000 },
    );
    expect(await calls(page)).toBe(2);
    await page.waitForTimeout(500);
    expect(await calls(page)).toBe(2);
    await ask(page, "Why not Nf3?");
    await expect.poll(() => calls(page), { timeout: 15_000 }).toBe(3);

    // Explain differently rewords the step; a second press asks for another way.
    const reword = page.locator("#lesson-reword");
    await expect(reword).toHaveText("Explain differently");
    await reword.click();
    await expect(answer(page)).toHaveText("Simpler: a guarded piece is not free.");
    await expect(reword).toHaveText("Another way");
    expect(await calls(page)).toBe(4);
    const rewordPrompt = await page.evaluate(() => localStorage.getItem("ask-prompt"));
    expect(rewordPrompt).toContain("Now the pawn on e6 defends the knight");

    // Show step: Explain differently too.
    await next(page).click();
    await expect(reword).toBeVisible();
    await next(page).click();
    await next(page).click();

    // Quiz: the box is there, with no ready-made questions until the answer is found, and no Explain differently.
    await expect(page.locator("#lesson-text")).toContainText("One black piece is free.");
    await expect(page.locator("#lesson-ask")).toBeVisible();
    await expect(page.locator("#lesson-questions button")).toHaveCount(0);
    const p = await squarePoint(page, "lesson-board", "g4");
    await page.mouse.click(p.x, p.y);
    await expect(page.locator("#lesson-ask")).toBeVisible();
    await expect(reword).toBeHidden();
    await expect(questions.first()).toContainText("Why not the rook on a5?");

    // Exercise: questions about the idea; no Explain differently.
    await next(page).click();
    await expect(page.locator("#lesson-text")).toContainText("to move.");
    await expect(questions).toHaveCount(3);
    await expect(reword).toBeHidden();
    await questions.filter({ hasText: "Which one?" }).click();
    await expect(answer(page)).toContainText("Usually the cheaper one.");
    expect(await calls(page)).toBe(4);
  });

  test("Enter asks, an empty question does nothing, and a late answer never lands on the next step", async ({
    page,
  }) => {
    await installFakes(page);
    // A slow coach that ignores the abort: the page itself must drop the late answer.
    await page.addInitScript(() => {
      const w = window as unknown as { claude: { use: (n: string) => Promise<unknown> } };
      const real = w.claude.use;
      w.claude = {
        use: async (name: string) => {
          const cap = await real(name);
          if (name !== "sample") return cap;
          const fast = cap as (i: string, o: unknown) => Promise<unknown>;
          return async (i: string, o: unknown) => {
            await new Promise((r) => setTimeout(r, 2500));
            return fast(i, o);
          };
        },
      };
    });
    await start(page);
    const input = page.locator("#lesson-voice-input");
    await input.fill("   ");
    await input.press("Enter");
    await expect(page.locator("#lesson-answer")).toBeHidden();
    expect(await calls(page)).toBe(0);

    await input.fill("Why is it free?");
    await input.press("Enter");
    await expect(answer(page)).toHaveText("The coach is writing…", { timeout: 15_000 });
    await expect(page.locator("#lesson-voice-send")).toBeDisabled();
    await next(page).click();
    await expect(page.locator("#lesson-where")).toHaveText("Step 2 of 5");
    await expect.poll(() => calls(page)).toBe(1);
    await page.waitForTimeout(3000);
    await expect(page.locator("#lesson-answer")).toBeHidden();
    await expect(page.locator("#lesson-voice-send")).toBeEnabled();

    // Leaving the lesson while the coach writes drops the answer too.
    await input.fill("And now?");
    await page.locator("#lesson-voice-send").click();
    await expect(answer(page)).toHaveText("The coach is writing…", { timeout: 15_000 });
    await page.locator("#lesson-leave").click();
    await page
      .locator(".lesson-card")
      .first()
      .getByRole("button", { name: /Start|Resume/ })
      .click();
    await expect(page.locator("#lesson-where")).toHaveText("Step 2 of 5");
    await page.waitForTimeout(3000);
    await expect(page.locator("#lesson-answer")).toBeHidden();
  });

  test("a question typed while the opponent's move plays is kept", async ({ page }) => {
    await installFakes(page);
    await start(page);
    for (let i = 0; i < 4; i++) await next(page).click();
    const p = await squarePoint(page, "lesson-board", "g4");
    await page.mouse.click(p.x, p.y);
    await next(page).click();
    await expect(page.locator("#lesson-text")).toContainText("Watch your opponent's move");
    const input = page.locator("#lesson-voice-input");
    await input.fill("Which piece is free?");
    await page.locator("#lesson-voice-send").click();
    await expect(page.locator("#lesson-voice-status")).toHaveText(
      "The coach is busy. Ask again in a moment.",
    );
    await expect(page.locator("#lesson-text")).toContainText("to move.");
    await expect(input).toHaveValue("");
  });

  test("the talk box and Send button fit inside the card", async ({ page }) => {
    await installFakes(page);
    await page.setViewportSize({ width: 375, height: 740 });
    await start(page);
    const form = (await page.locator("#lesson-voice-form").boundingBox())!;
    const send = (await page.locator("#lesson-voice-send").boundingBox())!;
    expect(send.x + send.width).toBeLessThanOrEqual(form.x + form.width + 0.5);
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scroll).toBeLessThanOrEqual(375);
  });

  test("in an open exercise the answer stays secret, and asking counts as help", async ({
    page,
    hasTouch,
  }) => {
    await installFakes(page);
    await start(page);
    for (let i = 0; i < 4; i++) await next(page).click();
    const p = await squarePoint(page, "lesson-board", "g4");
    await page.mouse.click(p.x, p.y);
    await next(page).click();
    // The first bundled puzzle (UqYwH): White plays Rxd8+, Black Qf8, then Rxf8.
    await expect(page.locator("#lesson-text")).toContainText("White to move.");

    // Naming the answer gets no coach call.
    await ask(page, "What if Rxd8?");
    await expect(answer(page)).toHaveText("Good idea: try it on the board and see what happens.", {
      timeout: 15_000,
    });
    expect(await calls(page)).toBe(0);

    // Any other question: the prompt keeps the best move secret.
    await ask(page, "Where should I look?");
    await expect(answer(page)).toHaveText("Look for a piece nothing defends.", { timeout: 15_000 });
    expect(await calls(page)).toBe(1);
    const prompt = await page.evaluate(() => localStorage.getItem("ask-prompt"));
    expect(prompt).toContain("Don't give the answer away");
    expect(prompt).not.toContain("Rxd8");

    await tapMove(page, "lesson-board", "d1", "d8", hasTouch, "white");
    await page.waitForTimeout(800);
    await tapMove(page, "lesson-board", "d8", "f8", hasTouch, "white");
    await expect(page.locator("#lesson-text")).toHaveText("Solved, with help.");
  });

  test("at the usage limit the coach pauses and isn't called again", async ({ page }) => {
    await installFakes(page, "rate_limited");
    await start(page);
    await ask(page, "Why is it free?");
    await expect(answer(page)).toHaveText(
      "The coach is paused at your usage limit. Try again, or pick one of the questions above.",
      { timeout: 15_000 },
    );
    await expect(page.locator("#coach-paused")).toBeVisible();
    await ask(page, "Why is it free?");
    await expect(answer(page)).toContainText("paused at your usage limit");
    expect(await calls(page)).toBe(1);
  });

  test("with no coach it says the coach isn't available", async ({ page }) => {
    await installFakeStore(page, "u_ale");
    await page.addInitScript(() => {
      const w = window as unknown as { claude: { use: (n: string) => Promise<unknown> } };
      const real = w.claude.use;
      w.claude = { use: async (name: string) => (name === "sample" ? null : real(name)) };
    });
    await start(page);
    await ask(page, "Why is it free?");
    await expect(answer(page)).toHaveText(
      "The coach isn't available here. Try again, or pick one of the questions above.",
    );
  });
});
