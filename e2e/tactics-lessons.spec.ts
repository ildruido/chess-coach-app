import { expect, test, type Page } from "@playwright/test";
import { LESSON_GROUPS } from "../src/lessons/catalog";
import { installFakeStore, squarePoint, tapMove } from "./helpers";

// Tactics lessons 2 to 9 (CC-028): each opens, plays through and ends with its
// takeaway and score. Lesson 2's exercises accept any move that loses nothing.

const text = (page: Page) => page.locator("#lesson-text");
const next = (page: Page) => page.locator("#lesson-next");

async function open(page: Page, title: string) {
  await installFakeStore(page, "u_ale");
  await page.goto("/");
  await page.locator("#screen-lessons").click();
  const card = page
    .locator(".lesson-card")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await card.getByRole("button", { name: "Start" }).click();
  await expect(page.locator("#lesson-title")).toHaveText(title);
}

async function clickSquare(page: Page, square: string) {
  const p = await squarePoint(page, "lesson-board", square);
  await page.mouse.click(p.x, p.y);
}

test.describe("tactics lessons", () => {
  test.slow();

  for (const lesson of LESSON_GROUPS[0]!.lessons.slice(1)) {
    test(`${lesson.title}: every step, then the takeaway and the score`, async ({ page }) => {
      await open(page, lesson.title);
      for (const [i, step] of lesson.steps.entries()) {
        await expect(page.locator("#lesson-where")).toContainText(
          `Step ${i + 1} of ${lesson.steps.length}`,
        );
        if (step.kind === "explain") await next(page).click();
        else if (step.kind === "show") {
          for (let m = 0; m <= step.line.length; m++) await next(page).click();
        } else if (step.kind === "quiz") {
          await expect(next(page)).toBeDisabled();
          await clickSquare(page, step.squares[0]!);
          await expect(text(page)).toContainText("Right");
          await next(page).click();
        } else {
          for (let n = 0; n < step.count; n++) {
            await expect(text(page)).toContainText("to move.");
            await page.locator("#lesson-skip").click();
          }
        }
      }
      await expect(page.locator("#lesson-end-title")).toHaveText(`${lesson.title}: done`);
      await expect(page.locator("#lesson-takeaway")).toHaveText(lesson.takeaway);
      await expect(page.locator("#lesson-score")).toContainText("skipped");
    });
  }

  test("Don't leave pieces hanging: a safe move solves it; a move that drops a piece is stopped", async ({
    page,
    hasTouch,
  }) => {
    await open(page, "Don't leave pieces hanging");
    await next(page).click();
    await next(page).click();
    await clickSquare(page, "f4");
    await next(page).click();

    // First position: the knight on d5 attacks the bishop on c3. Any safe square will do,
    // and while the engine checks it the bishop stays where it was put.
    await expect(text(page)).toContainText("White to move.");
    await page.evaluate(() => {
      const w = window as unknown as { bouncedBack: boolean };
      w.bouncedBack = false;
      const board = document.querySelector("#lesson-board")!;
      new MutationObserver(() => {
        if (!document.querySelector("#lesson-text")?.textContent?.startsWith("Checking")) return;
        const keys = [...board.querySelectorAll("piece")].map(
          (p) => (p as unknown as { cgKey?: string }).cgKey,
        );
        if (keys.includes("c3")) w.bouncedBack = true;
      }).observe(board, { subtree: true, childList: true, attributes: true });
    });
    await tapMove(page, "lesson-board", "c3", "d2", hasTouch, "white");
    await expect(text(page)).toHaveText("Solved first try!", { timeout: 15_000 });
    expect(
      await page.evaluate(() => (window as unknown as { bouncedBack: boolean }).bouncedBack),
    ).toBe(false);
    await next(page).click();

    // Second: the pawn on f5 attacks the knight on e4. A king move leaves it to be taken.
    await expect(text(page)).toContainText("White to move.");
    await tapMove(page, "lesson-board", "e1", "d1", hasTouch, "white");
    await expect(page.locator("#lesson-banner-text")).toHaveText(
      "Careful: after this move, your knight on e4 can be taken.",
      { timeout: 15_000 },
    );
    await page.locator("#lesson-try").click();
    await tapMove(page, "lesson-board", "e4", "c3", hasTouch, "white");
    await expect(text(page)).toHaveText("Solved, with help.", { timeout: 15_000 });
  });
});
