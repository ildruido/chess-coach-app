import { expect, test, type Page } from "@playwright/test";
import { installFakeStore } from "./helpers";

// Past games (CC-015): real engine, fake db that survives reloads, and a
// fake coach that answers review prompts and counts its calls.
async function installFakes(page: Page) {
  await installFakeStore(page, "u_ale");
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown> & {
      claude: { use: (n: string) => Promise<unknown> };
    };
    const sample = async (input: string) => {
      if (!input.includes("reviewing a beginner's finished practice game")) {
        return { text: "Take space.", truncated: false, modelTierApplied: "quick" };
      }
      localStorage.setItem(
        "review-calls",
        String(Number(localStorage.getItem("review-calls")) + 1),
      );
      if (localStorage.getItem("limited")) throw { code: "rate_limited", message: "usage limit" };
      const plies = [...input.matchAll(/\{"ply":(\d+),"why":"\.\.\."\}/g)].map((m) => Number(m[1]));
      const text = JSON.stringify({
        points: plies.map((ply) => ({ ply, why: "Coach: it keeps your pieces safe." })),
        lesson: "Coach lesson: look at every capture before you move.",
      });
      return { text, truncated: false, modelTierApplied: "default" };
    };
    const real = w.claude.use;
    w.claude = { use: async (name: string) => (name === "sample" ? sample : real(name)) };
  });
}

const reviewCalls = (page: Page) =>
  page.evaluate(() => Number(localStorage.getItem("review-calls")));
const rows = (page: Page) => page.locator("#history-list .history-row");

/**
 * Seeds a game in progress where the player (White, level 1) has just
 * played 3. Qxf7+?? and lets the engine reply: a game with a sure turning point.
 */
async function resumeBlunder(page: Page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    const at = new Date().toISOString();
    localStorage.setItem(
      "fake-db",
      JSON.stringify({
        "data/users/u_ale/practice-game": {
          version: 1,
          id: "g-test-blunder",
          moves: ["e2e4", "e7e5", "d1h5", "b8c6", "h5f7"],
          createdAt: at,
          updatedAt: at,
          level: 1,
          color: "white",
          resigned: false,
          hints: [{ ply: 4, step: "plan", mode: "tell" }],
          hintMode: "tell",
        },
      }),
    );
  });
  await page.goto("/");
  await expect(page.locator("#practice-moves")).toHaveAttribute("data-count", "6", {
    timeout: 15_000,
  });
  await expect(page.locator("#practice-status")).toHaveText(/^Your move/);
}

test.describe("past games", () => {
  test.slow();

  test("a finished game is listed, survives a reload, and replays move by move", async ({
    page,
  }) => {
    await installFakes(page);
    await resumeBlunder(page);
    await expect(page.locator("#history")).toBeHidden(); // only between games
    await page.locator("#practice-resign").click();
    await page.locator("#practice-new").click();
    await expect(page.locator("#history")).toBeVisible();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText("Resigned");
    await expect(rows(page).first()).toContainText(
      "Level 1, First games · you played white · 3 moves · 1 hint · not reviewed yet",
    );

    await page.reload();
    await expect(rows(page)).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator("#history-status")).toHaveText("1 game. Open one to replay it.");
    await rows(page).first().click();
    await expect(page.locator("#history-view")).toBeVisible();
    await expect(page.locator("#history-title")).toContainText("Resigned");
    await expect(page.locator("#history-info")).toContainText("You resigned. The engine wins.");
    await expect(page.locator("#history-moves")).toContainText("3. Qxf7+");
    await expect(page.locator("#history-hints")).toHaveText("Hints (Tell me): 1 used, 1 plan.");
    await expect(page.locator("#history-board cg-board piece").first()).toBeVisible();
    await expect(page.locator("#history-ply")).toHaveText(/^After 3\.\.\. \S+ \(the last move\)$/);
    await expect(page.locator("#history-next")).toBeDisabled();
    await page.locator("#history-prev").click();
    await expect(page.locator("#history-ply")).toHaveText("After 3. Qxf7+");
    await page.locator("#history-first").click();
    await expect(page.locator("#history-ply")).toHaveText("Start position");
    await expect(page.locator("#history-prev")).toBeDisabled();
    await page.locator("#history-next").click();
    await expect(page.locator("#history-ply")).toHaveText("After 1. e4");

    // Not reviewed yet: the review can be asked for from here.
    await expect(page.locator("#history-review .review-start")).toHaveText("Review this game");
    await page.locator("#history-back").click();
    await expect(page.locator("#history-view")).toBeHidden();
    await expect(rows(page)).toHaveCount(1);
  });

  test("a review made after the game is saved with it and shown again without a new call", async ({
    page,
  }) => {
    await installFakes(page);
    await resumeBlunder(page);
    await page.locator("#practice-resign").click();
    await page.getByRole("button", { name: "Review this game" }).click();
    await expect(page.locator("#review-lesson-text")).toHaveText(/^Coach lesson/, {
      timeout: 30_000,
    });
    const live = await page.locator("#review-points h4").allTextContents();
    expect(await reviewCalls(page)).toBe(1);

    await page.reload();
    await expect(page.locator("#practice-setup")).toBeVisible();
    await expect(rows(page).first()).toContainText("reviewed", { timeout: 15_000 });
    await expect(rows(page).first()).not.toContainText("not reviewed");
    await rows(page).first().click();
    const card = page.locator("#history-review");
    await expect(card.locator(".review-lesson-text")).toHaveText(
      "Coach lesson: look at every capture before you move.",
    );
    expect(await card.locator(".review-points h4").allTextContents()).toEqual(live);
    await expect(
      card.locator(".review-points li .review-board cg-board piece").first(),
    ).toBeVisible();
    await expect(card.locator(".review-why").first()).toHaveText(
      "Why: Coach: it keeps your pieces safe.",
    );
    await expect(card.locator(".review-start")).toBeHidden();
    expect(await reviewCalls(page)).toBe(1);
  });

  test("an unreviewed saved game can be reviewed from the list, and keeps its review", async ({
    page,
  }) => {
    await installFakes(page);
    await resumeBlunder(page);
    await page.locator("#practice-resign").click();
    await page.locator("#practice-new").click();
    await rows(page).first().click();
    const card = page.locator("#history-review");
    await card.locator(".review-start").click();
    await expect(card.locator(".review-lesson-text")).toHaveText(/^Coach lesson/, {
      timeout: 30_000,
    });
    expect(await reviewCalls(page)).toBe(1);
    await page.locator("#history-back").click();
    await expect(rows(page).first()).not.toContainText("not reviewed");

    await page.reload();
    await rows(page).first().click({ timeout: 15_000 });
    await expect(card.locator(".review-lesson-text")).toHaveText(/^Coach lesson/);
    expect(await reviewCalls(page)).toBe(1);
  });

  test("a usage limit in Past games pauses the coach there until it is tried again", async ({
    page,
  }) => {
    await installFakes(page);
    await resumeBlunder(page);
    await page.evaluate(() => localStorage.setItem("limited", "1"));
    await page.locator("#practice-resign").click();
    await page.locator("#practice-new").click();
    await rows(page).first().click();
    const card = page.locator("#history-review");
    const note = "The engine's review is shown. The coach is paused by your usage limit.";
    await card.locator(".review-start").click();
    await expect(card.locator(".review-status")).toHaveText(note, { timeout: 30_000 });
    await expect(card.locator(".review-lesson")).toBeVisible();
    await expect(page.locator("#coach-paused")).toBeVisible();
    await expect(card.locator(".review-start")).toBeDisabled();
    expect(await reviewCalls(page)).toBe(1);

    // Opened again during the pause: the saved engine review, the same note, no call.
    await page.locator("#history-back").click();
    await rows(page).first().click();
    await expect(card.locator(".review-status")).toHaveText(note);
    await expect(card.locator(".review-start")).toBeDisabled();
    expect(await reviewCalls(page)).toBe(1);

    await page.evaluate(() => localStorage.removeItem("limited"));
    await page.getByRole("button", { name: "Try the coach again" }).click();
    await expect(page.locator("#coach-paused")).toBeHidden();
    await expect(card.locator(".review-status")).toHaveText("");
    expect(await reviewCalls(page)).toBe(1);
    await card.locator(".review-start").click();
    await expect(card.locator(".review-lesson-text")).toHaveText(/^Coach lesson/, {
      timeout: 30_000,
    });
    expect(await reviewCalls(page)).toBe(2);
  });

  test("leaving a game for a new one lists it as resigned, newest first", async ({ page }) => {
    await installFakes(page);
    await resumeBlunder(page);
    await page.locator("#practice-new").click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText("Resigned");
    // A second game, left after one move.
    await page.locator("#practice-start").click();
    await page.locator("#practice-board").waitFor();
    const box = (await page.locator("#practice-board").boundingBox())!;
    const sq = box.width / 8;
    await page.mouse.click(box.x + 4.5 * sq, box.y + 6.5 * sq); // e2
    await page.mouse.click(box.x + 4.5 * sq, box.y + 4.5 * sq); // e4
    await expect(page.locator("#practice-moves")).toHaveAttribute("data-count", "2", {
      timeout: 15_000,
    });
    await page.locator("#practice-new").click();
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).first()).toContainText("1 move");
    await expect(rows(page).nth(1)).toContainText("3 moves");
  });

  test("starting a new game stops a review running in Past games", async ({ page }) => {
    await installFakes(page);
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown> & {
        claude: { use: (n: string) => Promise<unknown> };
      };
      const real = w.claude.use;
      // The coach never answers until the page aborts the call.
      const sample = (_: string, opts: { signal?: AbortSignal }) =>
        new Promise((_r, reject) => {
          localStorage.setItem(
            "hung-calls",
            String(Number(localStorage.getItem("hung-calls")) + 1),
          );
          opts.signal?.addEventListener("abort", () => {
            localStorage.setItem("aborted-calls", "1");
            reject({ code: "cancelled", message: "aborted" });
          });
        });
      w.claude = { use: async (name: string) => (name === "sample" ? sample : real(name)) };
    });
    await resumeBlunder(page);
    await page.locator("#practice-new").click();
    await rows(page).first().click();
    const card = page.locator("#history-review");
    await card.locator(".review-start").click();
    await expect(card.locator(".review-status")).toHaveText("The coach is writing the review…", {
      timeout: 30_000,
    });
    await page.locator('input[name="practice-color"][value="black"]').check();
    await page.locator("#practice-start").click();
    // The engine opens at once (it isn't stuck behind the review) and the call was aborted.
    await expect(page.locator("#practice-moves")).toHaveAttribute("data-count", "1", {
      timeout: 15_000,
    });
    expect(await page.evaluate(() => localStorage.getItem("aborted-calls"))).toBe("1");
    await expect(page.locator("#history")).toBeHidden();
  });

  test("without storage there is no history", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#practice-setup")).toBeVisible();
    await expect(page.locator("#history")).toBeHidden();
  });
});
