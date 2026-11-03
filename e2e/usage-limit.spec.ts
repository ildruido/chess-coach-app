import { expect, test, type Page } from "@playwright/test";
import { installFakeStore, tapMove } from "./helpers";

// Real engine, fake Claude (CC-016). The fake coach counts every call and, while
// `window.limited` is set, rejects it the way the runtime does at a usage limit.
async function installFakeCoach(page: Page) {
  await installFakeStore(page, "u_ale");
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown> & {
      claude: { use: (n: string) => Promise<unknown> };
    };
    w.limited = true;
    const calls: { tier?: string }[] = [];
    w.coachCalls = calls;
    const sample = async (_input: string, opts: { modelTier?: string }) => {
      calls.push({ tier: opts.modelTier });
      if (w.limited) throw { code: "rate_limited", message: "usage limit" };
      return { text: "Look at the pieces that haven't moved yet.", truncated: false };
    };
    const real = w.claude.use;
    w.claude = { use: async (name: string) => (name === "sample" ? sample : real(name)) };
  });
}

const calls = (page: Page) =>
  page.evaluate(() => (Reflect.get(window, "coachCalls") as { tier?: string }[]).length);
const banner = (page: Page) => page.locator("#coach-paused");
const nextBtn = (page: Page) => page.locator("#hint-next");
const log = (page: Page) => page.locator("#hint-log li");

test.describe("usage limit", () => {
  test.slow();

  test("pauses the coach, keeps the game going on the engine, and resumes on request", async ({
    page,
    hasTouch,
  }) => {
    await installFakeCoach(page);
    await page.goto("/");
    await expect(banner(page)).toBeHidden();
    await page.locator("#practice-level").selectOption("1");
    await page.locator("#practice-setup").getByLabel("White").check();
    await page.getByRole("button", { name: "Start game" }).click();
    await expect(page.locator("#practice-status")).toHaveText("Your move.");

    // The first hint meets the limit: the page says so, once, for every part of the coach.
    await nextBtn(page).click();
    await expect(banner(page)).toBeVisible({ timeout: 15_000 });
    await expect(banner(page)).toContainText("usage limit");
    expect(await calls(page)).toBe(1);

    // Hints go on, from the engine, with no further call.
    await expect(nextBtn(page)).toBeEnabled();
    await nextBtn(page).click();
    const fromEngine = "Usage limit reached, so this hint comes from the engine.";
    await expect(page.locator("#hint-status")).toHaveText(fromEngine, { timeout: 15_000 });
    await expect(log(page)).toHaveCount(1);
    await expect(log(page).nth(0)).toHaveAttribute("data-step", "plan");
    await expect(nextBtn(page)).toHaveText("Hint: which piece");
    await nextBtn(page).click();
    await expect(log(page)).toHaveCount(2);
    await expect(log(page).nth(1)).toContainText("The piece to move: your");
    for (const li of await log(page).all()) await expect(li).not.toContainText("engine's move");
    await nextBtn(page).click();
    await expect(log(page)).toHaveCount(3);
    await expect(log(page).nth(2)).toContainText("The engine's move:");
    expect(await calls(page)).toBe(1);

    // Play continues, commentary included, without calling the coach.
    await page.locator("#commentary-toggle").check();
    await tapMove(page, "practice-board", "g2", "g4", hasTouch);
    await expect(page.locator("#practice-moves")).toHaveAttribute("data-count", "2", {
      timeout: 15_000,
    });
    await expect(page.locator("#commentary-log li")).toHaveCount(1, { timeout: 15_000 });
    expect(await calls(page)).toBe(1);

    // Trying again lifts the pause; the next hint asks the coach, by hand only.
    await page.evaluate(() => Reflect.set(window, "limited", false));
    await page.getByRole("button", { name: "Try the coach again" }).click();
    await expect(banner(page)).toBeHidden();
    expect(await calls(page)).toBe(1);
    await nextBtn(page).click();
    await expect(log(page)).toHaveCount(1, { timeout: 15_000 });
    expect(await calls(page)).toBe(2);
    expect(
      await page.evaluate(
        () => (Reflect.get(window, "coachCalls") as { tier?: string }[])[1]!.tier,
      ),
    ).toBe("quick");
  });
});
