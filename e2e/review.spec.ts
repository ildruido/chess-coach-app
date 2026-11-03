import { expect, test, type Page } from "@playwright/test";
import { installFakeStore } from "./helpers";

// Real engine, fake Claude. The fake coach answers review prompts with JSON
// for the plies it was asked about, and records each call. Flags on window:
// `hang` waits until the page aborts the call; `badMove` names a move nobody
// played; `failWith` rejects with that error code.
async function installFakeCoach(page: Page, withClaude = true) {
  await installFakeStore(page, "u_ale");
  if (!withClaude) return;
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown> & {
      claude: { use: (n: string) => Promise<unknown> };
    };
    const calls: { tier?: string; aborted?: boolean }[] = [];
    w.reviewCalls = calls;
    const sample = async (input: string, opts: { signal?: AbortSignal; modelTier?: string }) => {
      if (!input.includes("reviewing a beginner's finished practice game")) {
        return { text: "Take space.", truncated: false, modelTierApplied: "quick" };
      }
      const call: { tier?: string; aborted?: boolean } = { tier: opts.modelTier };
      calls.push(call);
      opts.signal?.addEventListener("abort", () => (call.aborted = true));
      if (w.failWith) throw { code: w.failWith, message: "fake failure" };
      if (w.hang) {
        await new Promise((_, reject) =>
          opts.signal?.addEventListener("abort", () =>
            reject({ code: "cancelled", message: "aborted" }),
          ),
        );
      }
      const plies = [...input.matchAll(/\{"ply":(\d+),"why":"\.\.\."\}/g)].map((m) => Number(m[1]));
      const why = w.badMove ? "Coach: Qxa8 wins the rook." : "Coach: it keeps your pieces safe.";
      const text = JSON.stringify({
        points: plies.map((ply) => ({ ply, why })),
        lesson: "Coach lesson: look at every capture before you move.",
      });
      return { text, truncated: false, modelTierApplied: "default" };
    };
    const real = w.claude.use;
    w.claude = { use: async (name: string) => (name === "sample" ? sample : real(name)) };
  });
}

const calls = (page: Page) =>
  page.evaluate(() => Reflect.get(window, "reviewCalls") as { tier?: string; aborted?: boolean }[]);
const points = (page: Page) => page.locator("#review-points li");

/**
 * Resumes a saved game in which the player (White, level 1) has just thrown
 * the queen away (1. e4 e5 2. Qh5 Nc6 3. Qxf7+??), lets the engine reply,
 * then resigns: a game with at least one certain turning point.
 */
async function blunderAndResign(page: Page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    const at = new Date().toISOString();
    localStorage.setItem(
      "fake-db",
      JSON.stringify({
        "data/users/u_ale/practice-game": {
          version: 1,
          moves: ["e2e4", "e7e5", "d1h5", "b8c6", "h5f7"],
          createdAt: at,
          updatedAt: at,
          level: 1,
          color: "white",
          resigned: false,
          hints: [],
          hintMode: "tell",
        },
      }),
    );
  });
  await page.goto("/");
  // The saved game resumes and the engine replies to 3. Qxf7+.
  await expect(page.locator("#practice-moves")).toHaveAttribute("data-count", "6", {
    timeout: 15_000,
  });
  await expect(page.locator("#review")).toBeHidden();
  await expect(page.locator("#practice-status")).toHaveText(/^Your move/);
  await page.locator("#practice-resign").click();
  await expect(page.locator("#review")).toBeVisible();
}

/** A fake speech voice with Read aloud on; it records each sentence in `window.spoken`. */
async function installFakeVoice(page: Page) {
  await page.addInitScript(() => {
    const spoken: string[] = [];
    Reflect.set(window, "spoken", spoken);
    localStorage.setItem("chess-coach.read-aloud", "on");
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      value: class {
        constructor(public text: string) {}
      },
    });
    Object.defineProperty(window, "speechSynthesis", {
      value: {
        speak: (u: { text: string }) => void (u.text.trim() && spoken.push(u.text)),
        cancel: () => {},
        resume: () => {},
        getVoices: () => [{ lang: "en-GB", default: true }],
        addEventListener: () => {},
      },
    });
  });
}

test.describe("post-game review", () => {
  test.slow();

  test("shows turning points with a board, what happened, what was better and why, then a lesson", async ({
    page,
  }) => {
    await installFakeCoach(page);
    await blunderAndResign(page);
    await page.getByRole("button", { name: "Review this game" }).click();
    await expect(page.locator("#review-lesson-text")).toHaveText(
      "Coach lesson: look at every capture before you move.",
      { timeout: 30_000 },
    );
    const n = await points(page).count();
    expect(n).toBeGreaterThanOrEqual(1);
    await expect(points(page).filter({ hasText: "Qxf7+" })).toHaveCount(1);
    expect(n).toBeLessThanOrEqual(5);
    for (const li of await points(page).all()) {
      await expect(li.locator("h4")).toHaveText(
        /^\d+\. \S+: (Inaccuracy|Mistake|Missed chance|Well spotted)$/,
      );
      await expect(li.locator(".review-board cg-board piece").first()).toBeVisible();
      await expect(li.locator(".review-happened")).toContainText("What happened:");
      await expect(li.locator(".review-better")).toContainText(/Better:|The engine's view:/);
      await expect(li.locator(".review-why")).toHaveText("Why: Coach: it keeps your pieces safe.");
    }
    await expect(page.locator("#review-summary")).toContainText("You resigned.");
    // One default-tier call, and the button is gone: no second call for this game.
    expect((await calls(page)).map((c) => c.tier)).toEqual(["default"]);
    await expect(page.locator("#review-start")).toBeHidden();
    await expect(page.locator("#review-status")).toHaveText("");
  });

  test("with Read aloud on, the final review is read once, moves in words", async ({ page }) => {
    await installFakeCoach(page);
    await installFakeVoice(page);
    await blunderAndResign(page);
    await page.getByRole("button", { name: "Review this game" }).click();
    await expect(page.locator("#review-lesson-text")).toHaveText(/^Coach lesson/, {
      timeout: 30_000,
    });
    const spoken = await page.evaluate(() => Reflect.get(window, "spoken") as string[]);
    // Only the coach's final wording is read, not the engine's draft before it.
    expect(spoken.filter((s) => s.startsWith("The lesson:"))).toEqual([
      "The lesson: Coach lesson: look at every capture before you move.",
    ]);
    expect(spoken.some((s) => s.includes("queen takes f7, check"))).toBe(true);
  });

  test("with Read aloud on, a usage limit still reads the engine's review", async ({ page }) => {
    await installFakeCoach(page);
    await installFakeVoice(page);
    await page.addInitScript(() => Reflect.set(window, "failWith", "rate_limited"));
    await blunderAndResign(page);
    await page.getByRole("button", { name: "Review this game" }).click();
    await expect(page.locator("#review-status")).toContainText("usage limit", { timeout: 30_000 });
    const lesson = await page.locator("#review-lesson-text").textContent();
    const spoken = await page.evaluate(() => Reflect.get(window, "spoken") as string[]);
    expect(spoken.filter((s) => s.startsWith("The lesson:"))).toHaveLength(1);
    expect(spoken.join(" ")).toContain(lesson!.slice(0, 20));
  });

  test("a coach text naming a move nobody played gives way to the engine's", async ({ page }) => {
    await installFakeCoach(page);
    await page.addInitScript(() => Reflect.set(window, "badMove", true));
    await blunderAndResign(page);
    await page.getByRole("button", { name: "Review this game" }).click();
    await expect(page.locator("#review-lesson-text")).toHaveText(/^Coach lesson/, {
      timeout: 30_000,
    });
    expect(await points(page).count()).toBeGreaterThan(0);
    for (const why of await page.locator(".review-why").allTextContents()) {
      expect(why).not.toContain("Qxa8");
    }
    await expect(page.locator("#review-status")).toContainText("didn't match the engine");
  });

  test("without Claude, the review comes from the engine alone", async ({ page }) => {
    await installFakeCoach(page, false);
    await blunderAndResign(page);
    await page.getByRole("button", { name: "Review this game" }).click();
    await expect(page.locator("#review-lesson")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#review-lesson-text")).not.toHaveText("");
    await expect(page.locator("#review-status")).toContainText(
      "The coach isn't available right now",
    );
    await expect(page.locator("#review-start")).toBeHidden();
  });

  test("Stop cancels the engine's check, and the coach's call", async ({ page }) => {
    await installFakeCoach(page);
    await page.addInitScript(() => Reflect.set(window, "hang", true));
    await blunderAndResign(page);

    // While the engine checks the game.
    await page.getByRole("button", { name: "Review this game" }).click();
    await page.locator("#review-stop").click();
    await expect(page.locator("#review-status")).toHaveText("Stopped.");
    await expect(page.locator("#review-stop")).toBeHidden();
    await expect(page.getByRole("button", { name: "Review this game" })).toBeEnabled();

    // While the coach writes: the engine's review stays.
    await page.getByRole("button", { name: "Review this game" }).click();
    await expect(page.locator("#review-status")).toHaveText("The coach is writing the review…", {
      timeout: 30_000,
    });
    await expect(page.locator("#review-lesson")).toBeVisible();
    await page.locator("#review-stop").click();
    await expect(page.locator("#review-status")).toHaveText(
      "Stopped. The engine's review is shown.",
    );
    expect((await calls(page)).map((c) => c.aborted)).toEqual([true]);
    await expect(page.locator("#review-lesson")).toBeVisible();
    // The player may ask the coach again, by hand.
    await expect(page.getByRole("button", { name: "Ask the coach to explain" })).toBeEnabled();
  });

  test("a usage limit is explained and never retried", async ({ page }) => {
    await installFakeCoach(page);
    await page.addInitScript(() => Reflect.set(window, "failWith", "rate_limited"));
    await blunderAndResign(page);
    await page.getByRole("button", { name: "Review this game" }).click();
    await expect(page.locator("#review-status")).toContainText("usage limit", { timeout: 30_000 });
    await expect(page.locator("#review-lesson")).toBeVisible();
    // The coach pauses for the whole page; asking again waits for "Try the coach again".
    await expect(page.locator("#coach-paused")).toBeVisible();
    await expect(page.getByRole("button", { name: "Ask the coach to explain" })).toBeDisabled();
    await page.waitForTimeout(500);
    expect(await calls(page)).toHaveLength(1);
    await page.getByRole("button", { name: "Try the coach again" }).click();
    await expect(page.getByRole("button", { name: "Ask the coach to explain" })).toBeEnabled();
  });

  test("taking back the resignation hides the review", async ({ page }) => {
    await installFakeCoach(page);
    await blunderAndResign(page);
    await page.getByRole("button", { name: "Review this game" }).click();
    await expect(page.locator("#review-lesson")).toBeVisible({ timeout: 30_000 });
    await page.locator("#practice-takeback").click();
    await expect(page.locator("#review")).toBeHidden();
    await expect(points(page)).toHaveCount(0);
  });

  test("taking back or starting a new game during the coach's call cancels it", async ({
    page,
  }) => {
    await installFakeCoach(page);
    await page.addInitScript(() => Reflect.set(window, "hang", true));
    await blunderAndResign(page);
    await page.getByRole("button", { name: "Review this game" }).click();
    await expect(page.locator("#review-status")).toHaveText("The coach is writing the review…", {
      timeout: 30_000,
    });
    await page.locator("#practice-takeback").click();
    await expect(page.locator("#review")).toBeHidden();
    expect((await calls(page)).map((c) => c.aborted)).toEqual([true]);

    // Resign again and review: then New game while the coach writes.
    await page.locator("#practice-resign").click();
    await expect(page.locator("#review-points li")).toHaveCount(0);
    await page.getByRole("button", { name: "Review this game" }).click();
    await expect(page.locator("#review-status")).toHaveText("The coach is writing the review…", {
      timeout: 30_000,
    });
    await page.locator("#practice-new").click();
    await expect(page.locator("#review")).toBeHidden();
    expect((await calls(page)).map((c) => c.aborted)).toEqual([true, true]);
  });
});
