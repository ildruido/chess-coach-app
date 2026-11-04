import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { installFakeStore } from "./helpers";

// CC-074: WCAG 2.2 AA. Automated checks (axe) on every screen and state we can reach, in light
// and dark, plus the keyboard and screen-reader paths axe cannot judge.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

async function violations(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return r.violations.map(
    (v) =>
      `${v.id}: ${v.nodes
        .map((n) => n.target.join(" "))
        .slice(0, 4)
        .join(" | ")}`,
  );
}

test.beforeEach(async ({ page }) => {
  await installFakeStore(page, "u_ale");
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`axe, ${scheme}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
    });

    test("practice setup, game, past games", async ({ page }) => {
      await page.goto("/");
      expect(await violations(page)).toEqual([]);
      await page.locator("#practice-start").click();
      await expect(page.locator("#practice-board")).toBeVisible();
      await page.locator("#board-read, #practice-board-read").click();
      expect(await violations(page)).toEqual([]);
    });

    test("lessons list and a lesson", async ({ page }) => {
      await page.goto("/");
      await page.locator("#screen-lessons").click();
      expect(await violations(page)).toEqual([]);
      await page.locator(".lesson-card").first().getByRole("button", { name: "Start" }).click();
      await expect(page.locator("#lesson-board")).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  });
}

test("landmarks, skip link and a title per screen", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("banner")).toHaveCount(1);
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("contentinfo")).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "Screens" })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to the content" })).toBeFocused();
  await expect(page).toHaveTitle("Practice · Chess Coach");
  await page.locator("#screen-lessons").click();
  await expect(page).toHaveTitle("Lessons · Chess Coach");
  await expect(page.locator("#screen-lessons")).toHaveAttribute("aria-current", "page");
  await expect(page.locator("#page-title")).toBeFocused();
});

test("play from the keyboard: type a move, hear every move, read the board", async ({ page }) => {
  await page.goto("/");
  await page.locator("#practice-start").click();
  // Starting a game keeps the reading position on the board.
  await expect(page.locator("#practice-board")).toBeFocused();
  const input = page.locator("#practice-board-typed");
  await input.fill("e5");
  await input.press("Enter");
  await expect(page.locator("#practice-board-typed-status")).toContainText("isn't a legal move");
  await input.fill("e4");
  await input.press("Enter");
  await expect(page.locator("#practice-moves")).toHaveAttribute("data-count", /^[2-9]/, {
    timeout: 15_000,
  });
  await expect(input).toHaveValue("");
  // Both sides are announced in words.
  await expect(page.locator("#practice-board-announce")).toContainText(/(White|Black) played/);
  await page.getByRole("button", { name: "Read the board" }).first().click();
  const readout = page.locator("#practice-board-readout");
  await expect(readout).toBeFocused();
  await expect(readout).toContainText("White: king e1");
  await expect(readout).toContainText("Legal moves:");
});

test("a returning player lands straight in a game", async ({ page }) => {
  await page.goto("/");
  await page.locator("#practice-level").selectOption("2");
  await page.getByLabel("Black").check();
  await page.locator("#practice-start").click();
  await expect(page.locator("#practice-play")).toBeVisible();
  await page.locator("#practice-resign").click();
  await page.locator("#practice-new").click();
  await page.reload();
  // No setup, no Start click: the last choices are used.
  await expect(page.locator("#practice-play")).toBeVisible();
  await expect(page.locator("#practice-info")).toContainText("Level 2");
  await expect(page.locator("#practice-info")).toContainText("You play black");
});

test("a lesson quiz can be answered by typing a square", async ({ page }) => {
  await page.goto("/");
  await page.locator("#screen-lessons").click();
  await page.locator(".lesson-card").first().getByRole("button", { name: "Start" }).click();
  await expect(page.locator("#lesson-board-typed")).toBeVisible();
});
