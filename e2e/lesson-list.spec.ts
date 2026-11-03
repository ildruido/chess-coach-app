import { expect, test, type Page } from "@playwright/test";
import { LESSON_GROUPS, LESSONS, PATH } from "../src/lessons/catalog";
import { installFakeStore } from "./helpers";

// The lesson list (CC-029): every lesson in the plan's order with done, in
// progress or not started, a done count, and Continue for the last lesson used.

const [first, second, third] = LESSONS as [
  (typeof LESSONS)[0],
  (typeof LESSONS)[0],
  (typeof LESSONS)[0],
];

function progress(
  lesson: (typeof LESSONS)[0],
  over: Record<string, unknown>,
): [string, Record<string, unknown>] {
  return [
    `data/users/u_ale/lessons/progress/${lesson.id}`,
    {
      v: 1,
      lessonId: lesson.id,
      lessonVersion: lesson.version,
      step: 0,
      exerciseIds: [],
      exercise: 0,
      results: [],
      hintMode: "tell",
      runs: 0,
      updatedAt: "2026-10-09T10:00:00.000Z",
      ...over,
    },
  ];
}

/** Saved progress the fake db starts with (once: later saves survive reloads). */
async function seed(page: Page, docs: [string, Record<string, unknown>][]) {
  await page.addInitScript((all) => {
    if (!localStorage.getItem("fake-db")) {
      localStorage.setItem("fake-db", JSON.stringify(Object.fromEntries(all)));
    }
  }, docs);
}

const card = (page: Page, title: string) =>
  page
    .locator(".lesson-card")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) });

test.describe("lesson list", () => {
  test("shows every lesson in order with its state, and opens or resumes any of them", async ({
    page,
  }) => {
    await installFakeStore(page, "u_ale");
    await seed(page, [
      progress(first, {
        step: first.steps.length,
        runs: 1,
        results: ["first", "help", "skipped"],
        lastResults: ["first", "help", "skipped"],
      }),
      progress(second, { step: 1, updatedAt: "2026-10-09T09:00:00.000Z" }),
      progress(third, { step: 2, updatedAt: "2026-10-09T11:00:00.000Z" }),
    ]);
    await page.goto("/");
    await page.locator("#screen-lessons").click();
    await page.locator("#lesson-view-topic").click();

    // Every lesson, numbered in the plan's order, under its group.
    await expect(page.locator(".lesson-card h4")).toHaveText(LESSONS.map((l) => l.title));
    await expect(page.locator(".lesson-num")).toHaveText(LESSONS.map((_, i) => `Lesson ${i + 1}`));
    await expect(page.locator(".lesson-group-title")).toHaveText(LESSON_GROUPS.map((g) => g.title));
    await expect(card(page, first.title)).toContainText(first.summary);

    // Done, in progress, not started.
    await expect(page.locator("#lesson-count")).toHaveText(`1 of ${LESSONS.length} lessons done.`);
    await expect(card(page, first.title)).toContainText(
      "Done. Last time: 1 solved first try, 1 with help, 1 skipped, out of 3.",
    );
    await expect(card(page, first.title).getByRole("button")).toHaveText("Do it again");
    await expect(card(page, second.title)).toContainText(
      `In progress: step 2 of ${second.steps.length}.`,
    );
    await expect(card(page, second.title).getByRole("button")).toHaveText("Resume");
    await expect(card(page, LESSONS[3]!.title)).toContainText("Not started.");
    await expect(card(page, LESSONS[3]!.title).getByRole("button")).toHaveText("Start");

    // Continue opens the lesson in progress used last, at its step.
    await expect(page.locator("#lesson-continue")).toHaveText(`Continue: ${third.title}`);
    await page.locator("#lesson-continue").click();
    await expect(page.locator("#lesson-title")).toHaveText(third.title);
    await expect(page.locator("#lesson-where")).toHaveText(`Step 3 of ${third.steps.length}`);
    await page.locator("#lesson-leave").click();

    // Resume opens the other one at its step; Start opens a new one at step 1.
    await card(page, second.title).getByRole("button", { name: "Resume" }).click();
    await expect(page.locator("#lesson-where")).toHaveText(`Step 2 of ${second.steps.length}`);
    await page.locator("#lesson-leave").click();
    await card(page, LESSONS[3]!.title).getByRole("button", { name: "Start" }).click();
    await expect(page.locator("#lesson-where")).toHaveText(`Step 1 of ${LESSONS[3]!.steps.length}`);
    await page.locator("#lesson-leave").click();

    // A done lesson started again: still done until Ale moves on, then in progress.
    await card(page, first.title).getByRole("button", { name: "Do it again" }).click();
    await expect(page.locator("#lesson-where")).toHaveText(`Step 1 of ${first.steps.length}`);
    await page.locator("#lesson-next").click();
    await page.locator("#lesson-leave").click();
    await expect(card(page, first.title)).toContainText(
      `In progress: step 2 of ${first.steps.length}. Done before.`,
    );
    await expect(page.locator("#lesson-count")).toHaveText(`1 of ${LESSONS.length} lessons done.`);
    await expect(page.locator("#lesson-continue")).toHaveText(`Continue: ${first.title}`);
  });

  test("without saving, every lesson can still be started", async ({ page }) => {
    await installFakeStore(page, null);
    await page.goto("/");
    await page.locator("#screen-lessons").click();
    await expect(page.locator("#lesson-save")).toContainText("Saving is off");
    await expect(page.locator(".lesson-card")).toHaveCount(LESSONS.length);
    await expect(page.locator("#lesson-count")).toHaveText(`0 of ${LESSONS.length} lessons done.`);
    await expect(page.locator("#lesson-continue")).toHaveCount(0);
    await card(page, LESSONS.at(-1)!.title).getByRole("button", { name: "Start" }).click();
    await expect(page.locator("#lesson-title")).toHaveText(LESSONS.at(-1)!.title);
  });

  test("the recommended path is the default view and points at the next lesson", async ({
    page,
  }) => {
    await installFakeStore(page, "u_ale");
    const [p0, p1, p2] = PATH as [(typeof PATH)[0], (typeof PATH)[0], (typeof PATH)[0]];
    await seed(page, [
      progress(p0, { step: p0.steps.length, runs: 1, results: [], lastResults: [] }),
      progress(p1, { step: 1 }),
    ]);
    await page.goto("/");
    await page.locator("#screen-lessons").click();

    // The whole path, in order, with the first unfinished lesson marked.
    await expect(page.locator(".lesson-card h4")).toHaveText(PATH.map((l) => l.title));
    await expect(page.locator(".lesson-num").first()).toHaveText(`Path step 1 of ${PATH.length}`);
    await expect(page.locator(".lesson-card[data-next]")).toHaveCount(1);
    await expect(card(page, p1.title)).toContainText("Next on your path");
    await expect(card(page, p2.title)).not.toContainText("Next on your path");

    // Any lesson can still be opened.
    await card(page, p2.title).getByRole("button").click();
    await expect(page.locator("#lesson-title")).toHaveText(p2.title);
    await page.locator("#lesson-leave").click();

    // The view choice is remembered.
    await page.locator("#lesson-view-topic").click();
    await expect(page.locator(".lesson-group-title")).toHaveText(LESSON_GROUPS.map((g) => g.title));
    await page.reload();
    await page.locator("#screen-lessons").click();
    await expect(page.locator("#lesson-view-topic")).toHaveAttribute("aria-pressed", "true");
  });

  test("says so when the whole path is finished", async ({ page }) => {
    await installFakeStore(page, "u_ale");
    await seed(
      page,
      PATH.map((l) => progress(l, { step: l.steps.length, runs: 1, results: [], lastResults: [] })),
    );
    await page.goto("/");
    await page.locator("#screen-lessons").click();
    await expect(page.locator("#lesson-path-intro")).toContainText("finished the whole path");
    await expect(page.locator(".lesson-card[data-next]")).toHaveCount(0);
  });
});
