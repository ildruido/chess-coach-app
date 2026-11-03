import { expect, test, type Page } from "@playwright/test";
import { installFakeStore, squarePoint, tapMove } from "./helpers";

// Board behaviours on the Practice board (moved here from the removed Lab's board check): dragging,
// the promotion question, castling, en passant and checkmate. A saved game puts the board in
// the position, so each test starts where the rule happens.

const moves = (page: Page) => page.locator("#practice-moves");
const status = (page: Page) => page.locator("#practice-status");

/** Opens the page with a saved White game that already has these moves played. */
async function open(page: Page, seed: string[], level = 1) {
  await installFakeStore(page, "u_ale");
  await page.addInitScript(
    ([played, lvl]: [string[], number]) => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      const at = new Date().toISOString();
      const all = JSON.parse(localStorage.getItem("fake-db") ?? "{}");
      all["data/users/u_ale/practice-game"] = {
        version: 1,
        moves: played,
        createdAt: at,
        updatedAt: at,
        level: lvl,
        color: "white",
        resigned: false,
        hints: [],
        hintMode: "tell",
      };
      localStorage.setItem("fake-db", JSON.stringify(all));
    },
    [seed, level] as [string[], number],
  );
  await page.goto("/");
  await expect(status(page)).toHaveText(/^Your move/, { timeout: 15_000 });
}

const PROMOTION = ["a2a4", "b7b5", "a4b5", "a7a6", "b5a6", "g8f6", "a6a7", "f6g8"];

test.describe("practice board", () => {
  test.slow();
  let touch = false;
  test.beforeEach(({ hasTouch }) => {
    touch = hasTouch;
  });

  test("moves by dragging", async ({ page, isMobile }) => {
    test.skip(isMobile, "dragging is a mouse gesture; tapping covers phones");
    await open(page, []);
    const a = await squarePoint(page, "practice-board", "g1");
    const b = await squarePoint(page, "practice-board", "f3");
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.mouse.up();
    await expect(moves(page)).toContainText("1. Nf3");
  });

  test("asks which piece on promotion", async ({ page }) => {
    await open(page, PROMOTION);
    await tapMove(page, "practice-board", "a7", "b8", touch);
    const dialog = page.getByRole("dialog", { name: "Promotion" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Knight" }).click();
    await expect(dialog).toBeHidden();
    await expect(moves(page)).toContainText("axb8=N");
  });

  test("Cancel or Escape on promotion puts the pawn back", async ({ page }) => {
    await open(page, PROMOTION);
    const dialog = page.getByRole("dialog", { name: "Promotion" });
    await tapMove(page, "practice-board", "a7", "b8", touch);
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(moves(page)).toHaveAttribute("data-count", "8");
    await tapMove(page, "practice-board", "a7", "b8", touch);
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(moves(page)).toHaveAttribute("data-count", "8");
    // The pawn is back on a7: it can still promote.
    await tapMove(page, "practice-board", "a7", "b8", touch);
    await expect(dialog).toBeVisible();
  });

  test("New game closes an open promotion question", async ({ page }) => {
    await open(page, PROMOTION);
    await tapMove(page, "practice-board", "a7", "b8", touch);
    const dialog = page.getByRole("dialog", { name: "Promotion" });
    await expect(dialog).toBeVisible();
    await page.locator("#practice-new").click();
    await expect(dialog).toBeHidden();
  });

  test("castling is played", async ({ page }) => {
    await open(page, ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6"]);
    await tapMove(page, "practice-board", "e1", "g1", touch);
    await expect(moves(page)).toContainText("4. O-O");
  });

  test("en passant is played", async ({ page }) => {
    await open(page, ["e2e4", "a7a6", "e4e5", "d7d5"]);
    await tapMove(page, "practice-board", "e5", "d6", touch);
    await expect(moves(page)).toContainText("3. exd6");
  });

  test("checkmate ends the game; take back resumes it", async ({ page }) => {
    await open(page, ["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6"]);
    await tapMove(page, "practice-board", "h5", "f7", touch);
    await expect(status(page)).toHaveText("Checkmate. You win!");
    await page.locator("#practice-takeback").click();
    await expect(status(page)).toHaveText(/^Your move/);
  });

  test("a saved game that fails to load is reported and never overwritten", async ({ page }) => {
    await open(page, ["e2e4", "e7e5"]);
    await expect(moves(page)).toHaveAttribute("data-count", "2");
    const saved = await page.evaluate(() => localStorage["fake-db"]);

    await page.evaluate(() => localStorage.setItem("fake-db-fail-get", "1"));
    await page.reload();
    await expect(page.locator("#practice-save")).toHaveText(
      "Couldn't load your saved game. Saving is paused so it isn't overwritten. Reload to try again.",
      { timeout: 15_000 },
    );
    expect(await page.evaluate(() => localStorage["fake-db"])).toBe(saved);
  });
});
