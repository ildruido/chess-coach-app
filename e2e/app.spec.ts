import { expect, test } from "@playwright/test";
import { installFakeStore } from "./helpers";

// The page itself: the Practice screen first.
test.describe("page", () => {
  test.beforeEach(async ({ page }) => {
    await installFakeStore(page, "u_ale");
    await page.goto("/");
  });

  test("shows Practice, with a version and a title", async ({ page }) => {
    await expect(page).toHaveTitle(/Chess Coach/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Practice");
    await expect(page.getByRole("button", { name: "Start game" })).toBeVisible();
    await expect(page.getByText(/^v\d+\.\d+\.\d+$/)).toBeVisible();
  });

  test("the footer links to the source code at the running version", async ({ page }) => {
    await expect(page.getByRole("link", { name: "GPL-3.0 on GitHub" })).toHaveAttribute(
      "href",
      /^https:\/\/github\.com\/ildruido\/chess-coach-app\/tree\/v\d+\.\d+\.\d+$/,
    );
  });

  test("a game can be started and the engine replies", async ({ page }) => {
    await page.locator("#practice-setup").getByLabel("Black").check();
    await page.getByRole("button", { name: "Start game" }).click();
    await expect(page.locator("#practice-moves")).toHaveAttribute("data-count", "1", {
      timeout: 15_000,
    });
    await expect(page.locator("#practice-status")).toHaveText("Your move.");
  });
});
