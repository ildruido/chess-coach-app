import { expect, test, type Page } from "@playwright/test";
import { installFakeStore, tapMove } from "./helpers";

// Past games (CC-015), QA additions: a game won by checkmate, the history the
// next day, a list that can't load or holds unreadable games, a save that is
// refused for good, keyboard use of the viewer, and a 375px wide phone.

const HISTORY = "data/users/u_ale/history/games/";
const rows = (page: Page) => page.locator("#history-list .history-row");

/** A finished game as the history stores it. */
function record(id: string, moves: string[], finishedAt: string, extra: object = {}) {
  return {
    version: 1,
    id,
    moves,
    level: 1,
    color: "white",
    hintMode: "tell",
    hints: [],
    resigned: false,
    createdAt: finishedAt,
    finishedAt,
    outcome: "draw",
    result: "Draw by agreement.",
    ...extra,
  };
}

/** Seeds the fake db (and any extra localStorage flags) once, before the first load. */
async function seed(page: Page, db: Record<string, unknown>, flags: Record<string, string> = {}) {
  await page.addInitScript(
    ([db, flags]) => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("fake-db", JSON.stringify(db));
      for (const [k, v] of Object.entries(flags)) localStorage.setItem(k, v);
    },
    [db, flags] as const,
  );
  await installFakeStore(page, "u_ale");
}

/** Starts a level 1 game as White and plays 1. e4, waiting for the engine's reply. */
async function playOneMove(page: Page) {
  await page.locator("#practice-start").click();
  await tapMove(page, "practice-board", "e2", "e4", false);
  await expect(page.locator("#practice-moves")).toHaveAttribute("data-count", "2", {
    timeout: 15_000,
  });
}

test.describe("past games (QA)", () => {
  test.slow();

  test("a game won by checkmate is saved and is still listed the next day", async ({ page }) => {
    const day1 = new Date("2026-10-07T18:00:00");
    await page.clock.setFixedTime(day1);
    const at = day1.toISOString();
    await seed(page, {
      // White to play Qxf7#.
      "data/users/u_ale/practice-game": {
        version: 1,
        id: "g-test-mate",
        moves: ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6"],
        createdAt: at,
        updatedAt: at,
        level: 1,
        color: "white",
        resigned: false,
        hints: [{ ply: 4, step: "move", mode: "tell" }],
        hintMode: "tell",
      },
    });
    await page.goto("/");
    await expect(page.locator("#practice-status")).toHaveText(/^Your move/, { timeout: 15_000 });
    await tapMove(page, "practice-board", "h5", "f7", false);
    await expect(page.locator("#practice-status")).toContainText("Checkmate");
    await page.locator("#practice-new").click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toHaveAttribute("data-outcome", "win");
    await expect(rows(page).first()).toContainText("Won");
    await expect(rows(page).first()).toContainText("1 hint");

    await page.clock.setFixedTime(new Date("2026-10-08T09:00:00"));
    await page.reload();
    await expect(rows(page)).toHaveCount(1, { timeout: 15_000 });
    const when = await page.evaluate(
      (iso) =>
        new Date(iso).toLocaleString(undefined, {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      at,
    );
    await expect(rows(page).first().locator(".history-when")).toHaveText(when);
    await rows(page).first().click();
    await expect(page.locator("#history-info")).toContainText("Checkmate");
    await expect(page.locator("#history-moves")).toContainText("4. Qxf7#");
  });

  test("a history that can't be loaded says so", async ({ page }) => {
    await seed(
      page,
      { [`${HISTORY}g-a`]: record("g-a", ["e2e4"], new Date().toISOString()) },
      {
        "fake-db-fail-list": "1",
      },
    );
    await page.goto("/");
    await expect(page.locator("#history-status")).toHaveText(
      "Couldn't load your past games. Reload to try again.",
      { timeout: 15_000 },
    );
    await expect(page.locator("#history")).toBeVisible();
    await expect(rows(page)).toHaveCount(0);
  });

  test("unreadable saved games are skipped and counted; the rest still open", async ({ page }) => {
    const now = new Date().toISOString();
    await seed(page, {
      [`${HISTORY}g-good`]: record("g-good", ["e2e4", "e7e5"], now),
      [`${HISTORY}g-illegal`]: record("g-illegal", ["e2e5"], now),
      [`${HISTORY}g-junk`]: "not a game",
    });
    await page.goto("/");
    await expect(page.locator("#history-status")).toHaveText(
      "1 game. Open one to replay it. 2 saved games couldn't be read.",
      { timeout: 15_000 },
    );
    await expect(rows(page)).toHaveCount(1);
    await rows(page).first().click();
    await expect(page.locator("#history-ply")).toHaveText("After 1... e5 (the last move)");
  });

  test("after saving is refused for good, a listed game still opens", async ({ page }) => {
    await seed(
      page,
      {},
      { "fake-db-fail-set": "not_granted", "fake-db-fail-set-path": "/history/" },
    );
    await page.goto("/");
    await playOneMove(page);
    await page.locator("#practice-new").click();
    await expect(page.locator("#history-status")).toContainText("declined storage");
    await expect(rows(page)).toHaveCount(1);
    await rows(page).first().click();
    await expect(page.locator("#history-view")).toBeVisible();
    await expect(page.locator("#history-ply")).toHaveText(/\(the last move\)$/);
  });

  test("the viewer works from the keyboard, also after a step button reaches an end", async ({
    page,
  }) => {
    await seed(page, {
      [`${HISTORY}g-k`]: record("g-k", ["e2e4", "e7e5", "g1f3"], new Date().toISOString()),
    });
    await page.goto("/");
    await expect(rows(page)).toHaveCount(1, { timeout: 15_000 });
    // Tab reaches the row from the setup controls.
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      if (
        await rows(page)
          .first()
          .evaluate((el) => el === document.activeElement)
      )
        break;
    }
    await expect(rows(page).first()).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#history-view")).toBeFocused();
    const ply = page.locator("#history-ply");
    await expect(ply).toHaveText("After 2. Nf3 (the last move)");
    await page.keyboard.press("ArrowLeft");
    await expect(ply).toHaveText("After 1... e5");
    await page.keyboard.press("Home");
    await expect(ply).toHaveText("Start position");
    await page.keyboard.press("End");
    await expect(ply).toHaveText("After 2. Nf3 (the last move)");

    // The "start position" button disables itself when pressed: focus must
    // stay in the viewer so the arrow keys and Tab carry on from there.
    await page.locator("#history-first").focus();
    await page.keyboard.press("Enter");
    await expect(ply).toHaveText("Start position");
    await page.keyboard.press("ArrowRight");
    await expect(ply).toHaveText("After 1. e4");
    expect(await page.evaluate(() => !!document.activeElement?.closest("#history-view"))).toBe(
      true,
    );

    await page.locator("#history-back").focus();
    await page.keyboard.press("Enter");
    await expect(rows(page).first()).toBeFocused();
  });

  test("on a 375px wide phone the list and the viewer don't scroll sideways", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    const moves = ["g1f3", "g8f6", "f3g1", "f6g8"];
    const long = Array.from({ length: 24 }, () => moves).flat(); // 96 plies, all legal
    await seed(page, {
      [`${HISTORY}g-long`]: record("g-long", long, new Date().toISOString(), {
        result: "Draw by threefold repetition, after a long and patient game of knight moves.",
      }),
    });
    await page.goto("/");
    await expect(rows(page)).toHaveCount(1, { timeout: 15_000 });
    const sideways = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    expect(await sideways()).toBeLessThanOrEqual(0);
    await rows(page).first().click();
    await expect(page.locator("#history-board cg-board piece").first()).toBeVisible();
    expect(await sideways()).toBeLessThanOrEqual(0);
  });
});
