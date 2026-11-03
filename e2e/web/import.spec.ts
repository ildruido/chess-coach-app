import { expect, test } from "@playwright/test";
import { signUp, watchCsp } from "./helpers";

// Import (CC-043g): the file saved by "Export my data" goes into the signed-in account.
const at = "2026-10-07T09:30:00.000Z";
const game = (id: string) => ({
  version: 1,
  id,
  moves: ["e2e4", "e7e5"],
  level: 1,
  color: "white",
  hintMode: "tell",
  hints: [],
  resigned: true,
  createdAt: at,
  finishedAt: at,
  outcome: "loss",
  result: "You resigned. The engine wins.",
});
const exportFile = (extra: unknown[] = []) =>
  JSON.stringify({
    format: "chess-coach-export",
    formatVersion: 1,
    appVersion: "0.18.0",
    exportedAt: at,
    counts: { games: 0, history: 1, lessons: 0, coachAnswers: 0, skipped: 0 },
    savedGames: { currentGame: null, practiceGame: null },
    history: [game("imp1"), ...extra],
    lessonProgress: [],
    coachAnswers: [],
    unreadable: [],
  });
const upload = (data: string, name = "chess-coach-export-2026-10-11.json") => ({
  name,
  mimeType: "application/json",
  buffer: Buffer.from(data),
});

test.describe("web app import", () => {
  test.slow();

  test("an export file is checked, imported, and shows up after a reload", async ({ page }) => {
    const violations = await watchCsp(page);
    await signUp(page);
    const file = page.locator("#data-import-file");
    const status = page.locator("#data-import-status");

    // Something that isn't an export is refused with a plain sentence.
    await file.setInputFiles(upload("not json at all"));
    await expect(status).toContainText("can't be read");
    await expect(page.locator("#data-import-go")).toBeHidden();

    // A real one is summarised first; the unusable record is left out and counted.
    await file.setInputFiles(upload(exportFile([{ nonsense: true }])));
    await expect(status).toContainText("The file has 1 past game.");
    await expect(status).toContainText("1 item in the file can't be used");
    await page.locator("#data-import-go").click();
    await expect(status).toContainText("Added 1 past game.");

    await page.locator("#data-import-reload").click();
    await expect(page.locator("#history-list .history-row")).toHaveCount(1, { timeout: 20_000 });

    // Importing it again changes nothing.
    await page.locator("#data-import-file").setInputFiles(upload(exportFile()));
    await page.locator("#data-import-go").click();
    await expect(page.locator("#data-import-status")).toContainText("1 already here");
    expect(violations).toEqual([]);
  });

  test("another account cannot see what was imported", async ({ page, browser }) => {
    await signUp(page);
    await page.locator("#data-import-file").setInputFiles(upload(exportFile()));
    await page.locator("#data-import-go").click();
    await expect(page.locator("#data-import-status")).toContainText("Added 1 past game.");

    const other = await browser.newPage();
    await signUp(other);
    await other.reload();
    await expect(other.locator("#history-list .history-row")).toHaveCount(0);
    await other.close();
  });
});
