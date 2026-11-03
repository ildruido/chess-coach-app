import { expect, test, type Page } from "@playwright/test";
import { LESSONS } from "../src/lessons/catalog";
import { point, record } from "../tests/unit/fixtures/advice";
import { installFakeStore } from "./helpers";

// Adaptive learning path (CC-022): the "Coach suggests" card and the "Your
// common mistakes" list on the Lessons screen, built from reviewed games.

const HISTORY = "data/users/u_ale/history/games/";
const hang = point();
const mate = point({ kind: "missed", leftHanging: false, bestMates: true, bestGain: 9 });
const safe = LESSONS.find((l) => l.id === "safe-moves")!;

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
}

const games = (...rs: ReturnType<typeof record>[]) =>
  Object.fromEntries(rs.map((r) => [HISTORY + r.id, r]));

async function openLessons(page: Page) {
  await page.goto("/");
  await page.locator("#screen-lessons").click();
}

test.describe("adaptive learning path", () => {
  test("suggests lessons and lists common mistakes from reviewed games", async ({ page }) => {
    await installFakeStore(page, "u_ale");
    await seed(
      page,
      games(
        record("a", "2026-10-03T10:00:00.000Z", [hang]),
        record("b", "2026-10-02T10:00:00.000Z", [hang, mate]),
        record("c", "2026-10-01T10:00:00.000Z", null),
      ),
    );
    await openLessons(page);
    const items = page.locator("#advice-suggest .advice-item");
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText(safe.title);
    await expect(items.first()).toContainText(
      "You left a piece to be taken in 2 of your last 2 reviewed games.",
    );
    await expect(page.locator("#advice-mistakes li")).toHaveCount(2);
    await expect(page.locator('#advice-mistakes [data-kind="hanging"]')).toContainText(
      "2 of 2 reviewed games",
    );
    // The path keeps its order and its mark.
    await expect(page.locator('li[data-next="true"]')).toContainText("Next on your path");
    await expect(page.locator(".lesson-card h4").first()).toHaveText("Free pieces");
    // A suggestion opens its lesson.
    await items.first().getByRole("button", { name: "Start" }).click();
    await expect(page.locator("#lesson-title")).toHaveText(safe.title);
  });

  test("with no reviewed game, says so and points to the path", async ({ page }) => {
    await installFakeStore(page, "u_ale");
    await seed(page, games(record("a", "2026-10-03T10:00:00.000Z", null)));
    await openLessons(page);
    await expect(page.locator("#advice-empty")).toContainText("review");
    await expect(page.locator("#advice-path")).toContainText("next on your path");
    await expect(page.locator("#advice-mistakes")).toHaveCount(0);
  });

  test("suggests a finished lesson again only after a later game", async ({ page }) => {
    await installFakeStore(page, "u_ale");
    await seed(page, {
      ...games(record("a", "2026-10-03T10:00:00.000Z", [hang])),
      [`data/users/u_ale/lessons/progress/${safe.id}`]: {
        v: 1,
        lessonId: safe.id,
        lessonVersion: safe.version,
        step: safe.steps.length,
        exerciseIds: [],
        exercise: 0,
        results: [],
        hintMode: "tell",
        runs: 1,
        updatedAt: "2026-10-02T10:00:00.000Z",
      },
    });
    await openLessons(page);
    await expect(page.locator("#advice-suggest")).toContainText(safe.title);
    await expect(page.locator("#advice-suggest").getByRole("button")).toHaveText("Practise again");
  });

  test("says when Ale is ready for a harder opponent", async ({ page }) => {
    await installFakeStore(page, "u_ale");
    const win = (id: string, day: number) =>
      record(id, `2026-10-0${day}T10:00:00.000Z`, null, { level: 2, outcome: "win" });
    await seed(page, games(win("a", 1), win("b", 2), win("c", 3)));
    await openLessons(page);
    await expect(page.locator("#advice-harder")).toContainText("Improving beginner");
  });

  test("the lessons still work when the history can't load or the page has no runtime", async ({
    page,
  }) => {
    await installFakeStore(page, "u_ale");
    await seed(page, games(record("a", "2026-10-03T10:00:00.000Z", [hang])), {
      "fake-db-fail-list": "1",
    });
    await openLessons(page);
    await expect(page.locator("#advice-unavailable")).toBeVisible();
    await expect(page.locator("#lesson-path-intro")).toBeVisible();

    const bare = await page.context().newPage();
    await bare.addInitScript(() => {
      delete (window as unknown as { claude?: unknown }).claude;
    });
    await bare.goto("/");
    await bare.locator("#screen-lessons").click();
    await expect(bare.locator("#advice-empty")).toBeVisible();
    await expect(bare.locator(".lesson-card").first()).toBeVisible();
  });
});
