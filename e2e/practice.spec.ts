import { expect, test, type Page } from "@playwright/test";
import { installFakeStore, tapMove } from "./helpers";

const status = (page: Page) => page.locator("#practice-status");
const moves = (page: Page) => page.locator("#practice-moves");

async function start(page: Page, level: string, color: "White" | "Black" | "Random") {
  await page.locator("#practice-level").selectOption(level);
  await page.locator("#practice-setup").getByLabel(color).check();
  await page.getByRole("button", { name: "Start game" }).click();
}

test.describe("practice match", () => {
  test.slow();
  let touch = false;
  test.beforeEach(async ({ page, hasTouch }) => {
    touch = hasTouch;
    await installFakeStore(page, "u_ale");
    await page.goto("/");
  });

  test("as White: the engine replies to each move within 3 seconds", async ({ page }) => {
    await expect(page.locator("#practice-level option")).toHaveCount(6);
    await start(page, "1", "White");
    await expect(status(page)).toHaveText("Your move.");
    await expect(page.locator("#practice-info")).toHaveText(
      "Level 1, First games. You play white. Hints: Tell me.",
    );
    const t0 = Date.now();
    await tapMove(page, "practice-board", "e2", "e4", touch);
    await expect(moves(page)).toHaveAttribute("data-count", "2", { timeout: 15_000 });
    expect(Date.now() - t0).toBeLessThan(3000 + 1500); // reply plus test overhead
    await expect(status(page)).toHaveText("Your move.");
  });

  test("taps still land on the right square after the page shifts", async ({ page }) => {
    await start(page, "1", "White");
    await expect(status(page)).toHaveText("Your move.");
    // Make the board measure itself, then push it down without scrolling
    // (like web fonts loading or a message appearing above it).
    const board = page.locator("#practice-board");
    await board.scrollIntoViewIfNeeded();
    await board.hover();
    await page.evaluate(() => {
      const spacer = document.createElement("div");
      spacer.style.height = "60px";
      document.getElementById("practice-info")!.before(spacer);
    });
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    const box = (await board.boundingBox())!;
    const sq = box.width / 8;
    const at = (file: number, rank: number) => ({
      x: box.x + (file + 0.5) * sq,
      y: box.y + (7 - rank + 0.5) * sq,
    });
    for (const p of [at(4, 1), at(4, 3)]) {
      if (touch) await page.touchscreen.tap(p.x, p.y);
      else await page.mouse.click(p.x, p.y);
    }
    await expect(moves(page)).toHaveAttribute("data-count", "2", { timeout: 15_000 });
    await expect(moves(page)).toContainText("1. e4");
  });

  test("as Black: the engine moves first and the board is turned", async ({ page }) => {
    await start(page, "3", "Black");
    await expect(moves(page)).toHaveAttribute("data-count", "1", { timeout: 15_000 });
    await expect(status(page)).toHaveText("Your move.");
    await expect(
      page.locator("#practice-board .cg-wrap, #practice-board.cg-wrap").first(),
    ).toHaveClass(/orientation-black/);
    await expect(page.locator("#practice-takeback")).toBeDisabled();
  });

  test("take back undoes your move and the reply; resign ends the game", async ({ page }) => {
    await start(page, "2", "White");
    await tapMove(page, "practice-board", "d2", "d4", touch);
    await expect(moves(page)).toHaveAttribute("data-count", "2", { timeout: 15_000 });
    await page.locator("#practice-takeback").click();
    await expect(moves(page)).toHaveText("(no moves yet)");
    await expect(status(page)).toHaveText("Your move.");

    await page.locator("#practice-resign").click();
    await expect(status(page)).toHaveText("You resigned. The engine wins.");
    await expect(page.locator("#practice-resign")).toBeDisabled();
    await page.locator("#practice-new").click();
    await expect(page.getByRole("button", { name: "Start game" })).toBeVisible();
  });

  test("a game in progress resumes after a reload", async ({ page }) => {
    await start(page, "4", "White");
    await tapMove(page, "practice-board", "e2", "e4", touch);
    await expect(moves(page)).toHaveAttribute("data-count", "2", { timeout: 15_000 });
    const before = await moves(page).textContent();
    // Wait until the engine's reply is in the saved document, not just shown.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage["fake-db"] ?? "{}")["data/users/u_ale/practice-game"]?.moves
              ?.length,
        ),
      )
      .toBe(2);
    await page.reload();
    await expect(page.locator("#practice-save")).toHaveText("Resumed your saved game.");
    await expect(moves(page)).toHaveText(before ?? "");
    await expect(page.locator("#practice-info")).toContainText("Level 4");
  });

  test("New game abandons the current game, so a reload doesn't bring it back", async ({
    page,
  }) => {
    await start(page, "1", "White");
    await tapMove(page, "practice-board", "e2", "e4", touch);
    await expect(moves(page)).toHaveAttribute("data-count", "2", { timeout: 15_000 });
    await page.locator("#practice-new").click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage["fake-db"] ?? "{}")["data/users/u_ale/practice-game"]?.resigned,
        ),
      )
      .toBe(true);
    await page.reload();
    // Someone who has played before lands in a fresh game, not the abandoned one.
    await expect(moves(page)).toHaveAttribute("data-count", "0");
    await expect(page.getByRole("button", { name: "Start game" })).toBeHidden();
  });
});

test("an engine failure is shown, with a way to try again", async ({ page }) => {
  // Workers can't start (like a blocked engine) until the test clears the flag.
  await page.addInitScript(() => {
    const RealWorker = window.Worker;
    const w = window as unknown as { Worker: unknown; failWorkers: boolean };
    w.failWorkers = true;
    w.Worker = function (url: string | URL) {
      return w.failWorkers ? new FailingWorker() : new RealWorker(url);
    };
    class FailingWorker {
      onerror: ((e: { message: string; preventDefault(): void }) => void) | null = null;
      onmessage = null;
      constructor() {
        setTimeout(() => this.onerror?.({ message: "blocked", preventDefault() {} }), 0);
      }
      postMessage() {}
      terminate() {}
    }
  });
  await page.goto("/");
  await page.locator("#practice-setup").getByLabel("Black").check();
  await page.getByRole("button", { name: "Start game" }).click();
  await expect(page.locator("#practice-status")).toHaveText("The engine stopped: blocked", {
    timeout: 15_000,
  });
  await expect(page.locator("#practice-retry")).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { failWorkers: boolean }).failWorkers = false;
  });
  await page.locator("#practice-retry").click();
  await expect(page.locator("#practice-moves")).toHaveAttribute("data-count", "1", {
    timeout: 15_000,
  });
  await expect(page.locator("#practice-status")).toHaveText("Your move.");
  await expect(page.locator("#practice-retry")).toBeHidden();
});
