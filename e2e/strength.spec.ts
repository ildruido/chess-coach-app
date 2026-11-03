import { expect, test } from "@playwright/test";
import { installFakeStore, tapMove } from "./helpers";

// Real engine in the browser: every playing level must choose a legal reply within 3 seconds
// in a busy middlegame (White is in check after 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.c3 Nf6 5.d4 exd4
// 6.cxd4 Bb4+ and plays 7.Nc3).
const BUSY = "e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d4 e5d4 c3d4 c5b4".split(" ");

for (const level of [1, 2, 3, 4, 5, 6]) {
  test(`level ${level} moves within 3 seconds`, async ({ page, hasTouch }) => {
    test.slow();
    await installFakeStore(page, "u_ale");
    await page.addInitScript(
      ([played, lvl]: [string[], number]) => {
        const at = new Date().toISOString();
        localStorage.setItem(
          "fake-db",
          JSON.stringify({
            "data/users/u_ale/practice-game": {
              version: 1,
              moves: played,
              createdAt: at,
              updatedAt: at,
              level: lvl,
              color: "white",
              resigned: false,
              hints: [],
              hintMode: "tell",
            },
          }),
        );
      },
      [BUSY, level] as [string[], number],
    );
    await page.goto("/");
    await expect(page.locator("#practice-status")).toHaveText(/^Your move/, { timeout: 15_000 });
    const t0 = Date.now();
    await tapMove(page, "practice-board", "b1", "c3", hasTouch);
    await expect(page.locator("#practice-moves")).toHaveAttribute("data-count", "14", {
      timeout: 15_000,
    });
    expect(Date.now() - t0).toBeLessThan(3000 + 1500); // reply plus test overhead
  });
}
