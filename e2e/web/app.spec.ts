import { expect, test } from "@playwright/test";
import { signUp, watchCsp } from "./helpers";
import { tapMove } from "../helpers";

test.describe("web app", () => {
  test.slow();

  test("the engine runs from its file under the page policy, and a game survives a reload", async ({
    page,
  }) => {
    const violations = await watchCsp(page);
    await signUp(page);
    await page.locator("#practice-level").selectOption("1");
    await page.getByRole("button", { name: "Start game" }).click();
    await expect(page.locator("#practice-status")).toHaveText("Your move.");

    await tapMove(page, "practice-board", "e2", "e4", false);
    const moves = page.locator("#practice-moves");
    await expect(moves).toHaveAttribute("data-count", "2", { timeout: 20_000 });
    const before = await moves.textContent();

    // Saved through /api/db for this account: a reload brings the game back.
    await page.reload();
    await expect(page.locator("#practice-moves")).toHaveText(before ?? "", { timeout: 20_000 });
    expect(violations).toEqual([]);
  });

  test("a hint calls the coach through the server", async ({ page, request }) => {
    const violations = await watchCsp(page);
    await signUp(page);
    await page.locator("#practice-level").selectOption("1");
    await page.getByRole("button", { name: "Start game" }).click();
    await expect(page.locator("#practice-status")).toHaveText("Your move.");
    await page.locator("#hint-next").click();
    await expect(page.locator("#hint-log li").first()).toBeVisible({ timeout: 30_000 });

    const usage = await page.request.get("/api/coach/usage");
    const body = (await usage.json()) as { usedTokens: number };
    expect(body.usedTokens).toBeGreaterThan(0);
    expect(violations).toEqual([]);
    void request;
  });
});
