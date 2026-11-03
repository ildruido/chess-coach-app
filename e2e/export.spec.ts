import { expect, test, type Page } from "@playwright/test";
import { installFakeStore } from "./helpers";

// Export my data (CC-043f): the page collects everything kept in the db and hands one
// JSON file to the `downloads` capability. The fake saves the file into localStorage.
async function installDownloads(page: Page, mode: "save" | "decline" = "save") {
  await page.addInitScript((m) => {
    const w = window as unknown as { claude: { use: (n: string) => Promise<unknown> } };
    const real = w.claude.use;
    const downloads = {
      save: async (req: { filename: string; data: string }) => {
        if (m === "decline") throw { code: "declined", message: "no" };
        localStorage.setItem("saved-file", JSON.stringify(req));
        return { status: "saved" };
      },
    };
    w.claude = { use: async (n: string) => (n === "downloads" ? downloads : real(n)) };
  }, mode);
}

async function seed(page: Page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    const at = "2026-10-07T09:30:00.000Z";
    localStorage.setItem(
      "fake-db",
      JSON.stringify({
        "data/users/u_ale/history/games/g1": {
          version: 1,
          id: "g1",
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
        },
      }),
    );
  });
}

test("Export my data saves one file with what was kept", async ({ page }) => {
  await installFakeStore(page, "u_ale");
  await installDownloads(page);
  await seed(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Export my data" }).click();
  await expect(page.locator("#data-export-status")).toContainText("1 past game");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("saved-file")!));
  expect(saved.filename).toMatch(/^chess-coach-export-\d{4}-\d{2}-\d{2}\.json$/);
  const file = JSON.parse(saved.data);
  expect(file).toMatchObject({ format: "chess-coach-export", formatVersion: 1 });
  expect(file.history.map((r: { id: string }) => r.id)).toEqual(["g1"]);
  expect(file.counts).toMatchObject({ history: 1, games: 0, lessons: 0, coachAnswers: 0 });
});

test("declining the save says nothing was saved", async ({ page }) => {
  await installFakeStore(page, "u_ale");
  await installDownloads(page, "decline");
  await page.goto("/");
  await page.getByRole("button", { name: "Export my data" }).click();
  await expect(page.locator("#data-export-status")).toContainText("Nothing was saved");
});

test("a failed read makes no file", async ({ page }) => {
  await installFakeStore(page, "u_ale");
  await installDownloads(page);
  await page.addInitScript(() => localStorage.setItem("fake-db-fail-list", "1"));
  await page.goto("/");
  await page.getByRole("button", { name: "Export my data" }).click();
  await expect(page.locator("#data-export-status")).toContainText("no file was made");
  expect(await page.evaluate(() => localStorage.getItem("saved-file"))).toBeNull();
});

test("without storage the button explains itself", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Export my data" }).click();
  await expect(page.locator("#data-export-status")).toContainText("isn't available here");
});
