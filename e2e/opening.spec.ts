import { expect, test } from "@playwright/test";
import { installFakeStore, tapMove } from "./helpers";

// Opening names (CC-024): the practice game names the opening being played,
// from the bundled lichess openings list.
test.describe("opening name", () => {
  test.slow();

  test("a new game shows no name; the Italian Game is named once it is reached", async ({
    page,
    hasTouch,
  }) => {
    await installFakeStore(page, "u_ale");
    await page.addInitScript(() => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      const at = new Date().toISOString();
      localStorage.setItem(
        "fake-db",
        JSON.stringify({
          "data/users/u_ale/practice-game": {
            version: 1,
            id: "g-test-italian",
            moves: ["e2e4", "e7e5", "g1f3", "b8c6"],
            createdAt: at,
            updatedAt: at,
            level: 1,
            color: "white",
            resigned: false,
            hints: [],
            hintMode: "tell",
          },
        }),
      );
    });
    await page.goto("/");
    const opening = page.locator("#practice-opening");
    await expect(page.locator("#practice-moves")).toHaveAttribute("data-count", "4", {
      timeout: 15_000,
    });
    await expect(opening).toBeVisible();
    await expect(opening).not.toContainText("Italian");

    await tapMove(page, "practice-board", "f1", "c4", hasTouch);
    await expect(opening).toContainText("Opening: Italian Game");

    await page.locator("#practice-resign").click();
    await page.locator("#practice-new").click();
    await page.locator("#practice-setup").getByLabel("White").check();
    await page.getByRole("button", { name: "Start game" }).click();
    await expect(page.locator("#practice-status")).toHaveText("Your move.");
    await expect(opening).toBeHidden();
  });
});
