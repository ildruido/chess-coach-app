import { expect, test, type Page } from "@playwright/test";
import { installFakeStore, tapMove } from "./helpers";

// Real engine, fake Claude. The fake coach answers comment prompts with a
// fixed line and records each call. With `window.hang` set, it waits until
// the page aborts the call.
async function installFakeCoach(page: Page) {
  await installFakeStore(page, "u_ale");
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown> & {
      claude: { use: (n: string) => Promise<unknown> };
    };
    const calls: { tier?: string }[] = [];
    w.commentCalls = calls;
    const sample = async (input: string, opts: { signal?: AbortSignal; modelTier?: string }) => {
      if (!input.includes("commenting on a beginner's last move")) {
        return { text: "Take space.", truncated: false, modelTierApplied: "quick" };
      }
      calls.push({ tier: opts.modelTier });
      if (w.hang) {
        await new Promise((_, reject) =>
          opts.signal?.addEventListener("abort", () =>
            reject({ code: "cancelled", message: "aborted" }),
          ),
        );
      }
      // With `window.badLine` set, the coach names a move nobody played.
      const text = w.badLine ? "Coach: Bb5 was the move." : "Coach: it weakens your king.";
      return { text, truncated: false, modelTierApplied: "quick" };
    };
    const real = w.claude.use;
    w.claude = { use: async (name: string) => (name === "sample" ? sample : real(name)) };
  });
}

const comments = (page: Page) => page.locator("#commentary-log li");
const calls = (page: Page) =>
  page.evaluate(() => (Reflect.get(window, "commentCalls") as { tier?: string }[]).length);

async function startAsWhite(page: Page) {
  await page.locator("#practice-level").selectOption("1");
  await page.locator("#practice-setup").getByLabel("White").check();
  await page.getByRole("button", { name: "Start game" }).click();
  await expect(page.locator("#practice-status")).toHaveText("Your move.");
}

/** Plays a move and waits for the engine's reply. */
async function play(page: Page, from: string, to: string, hasTouch: boolean) {
  const count = Number(await page.locator("#practice-moves").getAttribute("data-count"));
  await tapMove(page, "practice-board", from, to, hasTouch);
  await expect(page.locator("#practice-moves")).toHaveAttribute("data-count", String(count + 2), {
    timeout: 15_000,
  });
}

test.describe("running commentary", () => {
  test.slow();

  test("is off by default: no comments and no coach calls", async ({ page, hasTouch }) => {
    await installFakeCoach(page);
    await page.goto("/");
    await startAsWhite(page);
    await expect(page.locator("#commentary-toggle")).not.toBeChecked();
    await play(page, "g2", "g4", hasTouch);
    await play(page, "f2", "f3", hasTouch);
    await page.waitForTimeout(1500);
    await expect(comments(page)).toHaveCount(0);
    expect(await calls(page)).toBe(0);
  });

  test("when on: one comment per move, the engine's verdict, the coach's reason", async ({
    page,
    hasTouch,
  }) => {
    await installFakeCoach(page);
    await page.goto("/");
    await startAsWhite(page);
    await page.locator("#commentary-toggle").check();
    await play(page, "g2", "g4", hasTouch);
    await expect(comments(page)).toHaveCount(1, { timeout: 15_000 });
    await expect(comments(page).nth(0).locator("h4")).toHaveText(
      /^1\. g4: (Good move|Inaccuracy|Mistake|Missed chance)$/,
    );
    await tapMove(page, "practice-board", "f2", "f3", hasTouch);
    await expect(comments(page)).toHaveCount(2, { timeout: 15_000 });
    // Newest first.
    await expect(comments(page).nth(0).locator("h4")).toHaveText(/^2\. f3: /);

    // Weak moves get the coach's reason in one quick call; good ones need no call.
    const notGood = page.locator('#commentary-log li:not([data-verdict="good"])');
    expect(await notGood.count()).toBeGreaterThan(0);
    await expect(notGood.first().locator("p")).toHaveText("Coach: it weakens your king.");
    expect(await calls(page)).toBe(await notGood.count());
    const tiers = await page.evaluate(() =>
      (Reflect.get(window, "commentCalls") as { tier?: string }[]).map((c) => c.tier),
    );
    expect(new Set(tiers)).toEqual(new Set(["quick"]));

    // The switch is remembered.
    await page.reload();
    await expect(page.locator("#commentary-toggle")).toBeChecked();
  });

  test("a coach line that fails the check gives way to the engine's own", async ({
    page,
    hasTouch,
  }) => {
    await installFakeCoach(page);
    await page.goto("/");
    await startAsWhite(page);
    await page.evaluate(() => Reflect.set(window, "badLine", true));
    await page.locator("#commentary-toggle").check();
    await play(page, "g2", "g4", hasTouch);
    await expect(comments(page)).toHaveCount(1, { timeout: 15_000 });
    await tapMove(page, "practice-board", "f2", "f3", hasTouch);
    await expect(comments(page)).toHaveCount(2, { timeout: 15_000 });
    const notGood = page.locator('#commentary-log li:not([data-verdict="good"]) p');
    expect(await notGood.count()).toBeGreaterThan(0);
    for (const text of await notGood.allTextContents()) {
      expect(text).not.toContain("Bb5");
      expect(text).toMatch(/better|missed|chance/i);
    }
    expect(await calls(page)).toBe(await notGood.count());
  });

  test("take back removes the comment on the undone move", async ({ page, hasTouch }) => {
    await installFakeCoach(page);
    await page.goto("/");
    await startAsWhite(page);
    await page.locator("#commentary-toggle").check();
    await play(page, "g2", "g4", hasTouch);
    await expect(comments(page)).toHaveCount(1, { timeout: 15_000 });
    await play(page, "f2", "f3", hasTouch);
    await expect(comments(page)).toHaveCount(2, { timeout: 15_000 });
    await page.locator("#practice-takeback").click();
    await expect(comments(page)).toHaveCount(1);
    await expect(comments(page).nth(0).locator("h4")).toHaveText(/^1\. g4: /);
  });

  test("turning it off stops a comment at once, and play never waits for one", async ({
    page,
    hasTouch,
  }) => {
    await installFakeCoach(page);
    await page.goto("/");
    await startAsWhite(page);
    await page.locator("#commentary-toggle").check();
    await page.evaluate(() => Reflect.set(window, "hang", true));
    // g4 then f3: at least one of them isn't good, so the coach is asked (and hangs).
    await play(page, "g2", "g4", hasTouch);
    const status = page.locator("#commentary-status");
    // Either g4 got its comment (it was judged good), or the coach is being asked.
    await expect
      .poll(async () => `${await comments(page).count()}${await status.textContent()}`, {
        timeout: 15_000,
      })
      .toMatch(/^(1|0The coach is commenting…)$/);
    if ((await comments(page).count()) === 1) {
      // g4 was judged good: f3 will be the weak one. The engine still replies.
      await play(page, "f2", "f3", hasTouch);
    }
    await expect(page.locator("#commentary-status")).toHaveText("The coach is commenting…", {
      timeout: 15_000,
    });
    const shown = await comments(page).count();
    await page.locator("#commentary-toggle").uncheck();
    await expect(page.locator("#commentary-status")).toHaveText("");
    await expect(page.locator("#commentary-log")).toBeHidden();
    await page.waitForTimeout(500);
    expect(await comments(page).count()).toBe(shown);
  });
});
