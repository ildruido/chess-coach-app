import { expect, test, type Page } from "@playwright/test";
import { showDiagnostics, installFakeStore, tapMove } from "./helpers";

// Real engine, fake Claude. The fake answers each hint step the way a good
// coach would, from the facts in the prompt, and records every prompt.
// With `leak` set, it gives the move away in the plan step: the plan prompt
// keeps the best move secret, so it names every usual first move instead. With
// `window.hang` set, it waits until the page aborts the call.
async function installFakeCoach(page: Page, leak = false) {
  await installFakeStore(page, "u_ale");
  await page.addInitScript((leakMove: boolean) => {
    const w = window as unknown as Record<string, unknown> & {
      claude: { use: (n: string) => Promise<unknown> };
    };
    const prompts: string[] = [];
    w.prompts = prompts;
    const sample = async (input: string, opts: { signal?: AbortSignal }) => {
      prompts.push(input);
      if (w.hang) {
        await new Promise((_, reject) =>
          opts.signal?.addEventListener("abort", () =>
            reject({ code: "cancelled", message: "aborted" }),
          ),
        );
      }
      const best = /Engine best move: (\S+)/.exec(input)?.[1] ?? "?";
      let text = "Take space in the middle of the board.";
      if (input.includes("Ask ONE short guiding question")) {
        text = input.includes("This is a second question")
          ? "Which part of the board is still empty?"
          : "What does your opponent want to do next?";
      } else if (input.includes("Say which piece")) {
        text = "Look at the pieces that haven't moved yet.";
      } else if (input.includes("Name the engine's best move")) {
        text = `${best} is the move: it takes a share of the middle.`;
      } else if (leakMove && !(w.leakOnce && input.includes("was held back"))) {
        // With `leakOnce` set, a second try (told what slipped) comes back clean.
        text = "Push a pawn to e4, d4 or c4, or develop your knight.";
      }
      return { text, truncated: false, modelTierApplied: "quick" };
    };
    const real = w.claude.use;
    w.claude = { use: async (name: string) => (name === "sample" ? sample : real(name)) };
  }, leak);
}

const nextBtn = (page: Page) => page.locator("#hint-next");
const log = (page: Page) => page.locator("#hint-log li");
const savedHints = (page: Page) =>
  page.evaluate(
    () =>
      JSON.parse(localStorage["fake-db"] ?? "{}")["data/users/u_ale/practice-game"]?.hints ?? [],
  );

async function startAsWhite(page: Page) {
  await page.locator("#practice-level").selectOption("1");
  await page.locator("#practice-setup").getByLabel("White").check();
  await page.getByRole("button", { name: "Start game" }).click();
  await expect(page.locator("#practice-status")).toHaveText("Your move.");
}

test.describe("hints", () => {
  test.beforeEach(async ({ page }) => showDiagnostics(page));
  test.slow();

  test("tell mode: plan, then piece, then move; ask mode: questions first; mode fixed per game", async ({
    page,
    hasTouch,
  }) => {
    await installFakeCoach(page);
    await page.goto("/");
    await startAsWhite(page);

    // Tell: three steps, each on request.
    await expect(nextBtn(page)).toHaveText("Hint: the plan");
    await nextBtn(page).click();
    await expect(log(page)).toHaveCount(1, { timeout: 15_000 });
    await expect(log(page).nth(0)).toContainText("The plan");
    await expect(nextBtn(page)).toHaveText("Hint: which piece");
    await nextBtn(page).click();
    await expect(log(page)).toHaveCount(2);
    await expect(nextBtn(page)).toHaveText("Hint: the move");
    await nextBtn(page).click();
    await expect(log(page)).toHaveCount(3);
    await expect(log(page).nth(2)).toContainText(/The move.*is the move/s);
    await expect(nextBtn(page)).toHaveText("No more hints this move");
    await expect(nextBtn(page)).toBeDisabled();

    // Every step got the engine's facts, with the best move kept secret until
    // the move step (the piece step knows only the piece); the piece step knew
    // the plan already given.
    const prompts = (await page.evaluate(() => Reflect.get(window, "prompts"))) as string[];
    expect(prompts).toHaveLength(3);
    expect(prompts[0]).toContain("The best move moves one of White's pieces");
    expect(prompts[1]).toMatch(/The piece that makes the best move: White's \w+ on [a-h][1-8]\./);
    for (const p of prompts.slice(0, 2)) expect(p).not.toContain("Engine best move");
    expect(prompts[2]).toMatch(/Engine best move: \S+/);
    expect(prompts[1]).toContain("- plan: Take space in the middle of the board.");
    await expect.poll(() => savedHints(page)).toHaveLength(3);

    // A new position starts afresh.
    await tapMove(page, "practice-board", "e2", "e4", hasTouch);
    await expect(page.locator("#practice-moves")).toHaveAttribute("data-count", "2", {
      timeout: 15_000,
    });
    await expect(log(page)).toHaveCount(0);

    // The mode was chosen at the start and can't be changed during the game.
    const card = page.locator("#hint-mode");
    await expect(card.getByLabel("Ask me")).toBeDisabled();
    await expect(card.getByLabel("Tell me")).toBeChecked();
    await expect(page.locator("#hint-mode-note")).toHaveText("Chosen for this game.");

    // Ask, chosen in the setup of the next game: one question, a second only
    // on request, then the tell steps.
    await page.locator("#practice-new").click();
    const setup = page.locator("#practice-setup");
    await expect(setup.getByLabel("Tell me")).toBeChecked();
    await setup.getByLabel("Ask me").check();
    await startAsWhite(page);
    await expect(card.getByLabel("Ask me")).toBeChecked();
    await expect(card.getByLabel("Ask me")).toBeDisabled();
    await expect(nextBtn(page)).toHaveText("Hint: ask me a question");
    await expect(page.locator("#hint-another")).toBeHidden();
    await nextBtn(page).click();
    await expect(log(page)).toHaveCount(1, { timeout: 15_000 });
    await expect(log(page).nth(0)).toContainText("What does your opponent want");
    await expect(nextBtn(page)).toHaveText("Hint: the plan");
    await page.locator("#hint-another").click();
    await expect(log(page)).toHaveCount(2);
    await expect(log(page).nth(1)).toContainText("Another question");
    await expect(page.locator("#hint-another")).toBeHidden();

    await expect
      .poll(() => savedHints(page))
      .toEqual([
        { ply: 0, step: "question", mode: "ask" },
        { ply: 0, step: "question", mode: "ask" },
      ]);

    // The resumed game keeps its mode, and the hints stay with it.
    await page.reload();
    await expect(page.locator("#practice-save")).toHaveText("Resumed your saved game.");
    await expect(card.getByLabel("Ask me")).toBeChecked();
    await expect(card.getByLabel("Ask me")).toBeDisabled();
    // The steps carry on where they were: two questions given, the plan is next.
    await expect(log(page)).toHaveCount(2);
    await expect(log(page).nth(1)).toContainText("Given before the page was reloaded.");
    await expect(nextBtn(page)).toHaveText("Hint: the plan");
    await expect(page.locator("#hint-another")).toBeHidden();
    await expect.poll(() => savedHints(page)).toHaveLength(2);

    // The next game's setup starts from the last choice, also after a reload.
    await page.locator("#practice-new").click();
    await expect(setup.getByLabel("Ask me")).toBeChecked();
    await page.reload();
    await expect(page.locator("#practice-save")).toHaveText(
      "Games are saved to your account as you play.",
    );
    await expect(setup.getByLabel("Ask me")).toBeChecked();
  });

  test("a hint that gives the move away too early is not shown", async ({ page, hasTouch }) => {
    await installFakeCoach(page, true);
    await page.goto("/");
    await startAsWhite(page);
    await nextBtn(page).click();
    await expect(page.locator("#hint-status")).toHaveText(
      "That hint gave away too much too early, so it isn't shown. Ask again.",
      { timeout: 15_000 },
    );
    await expect(log(page)).toHaveCount(0);
    await expect(nextBtn(page)).toHaveText("Hint: the plan");
    expect(await savedHints(page)).toEqual([]);
    // Diagnostics show what was held back and which rule caught it.
    await expect(page.locator("#hint-diag-note")).toContainText(
      /Held back \(plan\): Failed: gives away what the plan step must keep hidden \((move|destination|piece): "(e4|d4|c4|knight)"\)/,
    );
    await expect(page.locator("#hint-diag-note")).toContainText("develop your knight");

    // Asking again tells the coach what slipped (CC-023)…
    await nextBtn(page).click();
    await expect(log(page)).toHaveCount(1, { timeout: 15_000 });
    const prompts = await page.evaluate(() => Reflect.get(window, "prompts") as string[]);
    expect(prompts.at(-1)).toContain("Your last answer for this step was held back because");
    // …and when it slips again, a plainer hint from the engine is shown, so play can go on.
    await expect(page.locator("#hint-status")).toHaveText(
      "The coach's wording was held back again, so this hint comes from the engine.",
    );
    await expect(log(page).nth(0)).toContainText("The plan");
    await expect(log(page).nth(0).locator("p")).not.toContainText(/e4|d4|c4|knight/);
    await expect(nextBtn(page)).toHaveText("Hint: which piece");
    expect(await savedHints(page)).toEqual([{ ply: 0, step: "plan", mode: "tell" }]);
    // A new position clears it: its first try is the coach's again, never the engine's
    // fallback (the engine's level-1 reply decides whether the fake's text slips there).
    await tapMove(page, "practice-board", "e2", "e4", hasTouch);
    await expect(page.locator("#hint-diag-note")).toHaveCount(0);
    await expect(page.locator("#practice-moves")).toHaveAttribute("data-count", "2", {
      timeout: 15_000,
    });
    const asked = await page.evaluate(() => (Reflect.get(window, "prompts") as string[]).length);
    await nextBtn(page).click();
    await expect
      .poll(() => page.evaluate(() => (Reflect.get(window, "prompts") as string[]).length), {
        timeout: 15_000,
      })
      .toBe(asked + 1);
    await expect(page.locator("#hint-status")).not.toHaveText(/looking|writing/);
    await expect(page.locator("#hint-status")).not.toContainText("comes from the engine");
    for (const text of await log(page).locator("p").allTextContents()) {
      expect(text).toContain("Push a pawn");
    }
  });

  test("asking again after a slip shows the coach's new hint when it passes (CC-023)", async ({
    page,
  }) => {
    await installFakeCoach(page, true);
    await page.addInitScript(() => Reflect.set(window, "leakOnce", true));
    await page.goto("/");
    await startAsWhite(page);
    await nextBtn(page).click();
    await expect(page.locator("#hint-status")).toHaveText(/gave away too much/, {
      timeout: 15_000,
    });
    await nextBtn(page).click();
    await expect(log(page)).toHaveCount(1, { timeout: 15_000 });
    await expect(log(page).nth(0).locator("p")).toHaveText(
      "Take space in the middle of the board.",
    );
    await expect(page.locator("#hint-status")).toHaveText("");
  });
});

test.describe("a hint in progress", () => {
  test.slow();

  test("Stop cancels it: nothing shown or saved, and Hint works again", async ({ page }) => {
    await installFakeCoach(page);
    await page.goto("/");
    await startAsWhite(page);
    await page.evaluate(() => Reflect.set(window, "hang", true));
    await nextBtn(page).click();
    await expect(page.locator("#hint-status")).toHaveText("The coach is writing…", {
      timeout: 15_000,
    });
    await page.locator("#hint-stop").click();
    await expect(page.locator("#hint-status")).toHaveText("Stopped.");
    await expect(page.locator("#hint-stop")).toBeHidden();
    await expect(nextBtn(page)).toBeEnabled();
    await expect(nextBtn(page)).toHaveText("Hint: the plan");
    await expect(log(page)).toHaveCount(0);
    expect(await savedHints(page)).toEqual([]);

    // The next try works and counts.
    await page.evaluate(() => Reflect.set(window, "hang", false));
    await nextBtn(page).click();
    await expect(log(page)).toHaveCount(1, { timeout: 15_000 });
    await expect.poll(() => savedHints(page)).toHaveLength(1);
  });

  test("playing a move drops it: no stale hint in the next position", async ({
    page,
    hasTouch,
  }) => {
    await installFakeCoach(page);
    await page.goto("/");
    await startAsWhite(page);
    await page.evaluate(() => Reflect.set(window, "hang", true));
    await nextBtn(page).click();
    await expect(page.locator("#hint-status")).toHaveText("The coach is writing…", {
      timeout: 15_000,
    });
    await tapMove(page, "practice-board", "e2", "e4", hasTouch);
    await expect(page.locator("#practice-moves")).toHaveAttribute("data-count", "2", {
      timeout: 15_000,
    });
    await expect(page.locator("#practice-status")).toHaveText("Your move.");
    await expect(log(page)).toHaveCount(0);
    await expect(nextBtn(page)).toHaveText("Hint: the plan");
    await expect(nextBtn(page)).toBeEnabled();
    await expect(page.locator("#hint-stop")).toBeHidden();
    expect(await savedHints(page)).toEqual([]);
  });
});

test("keyboard: focus stays on the hint controls", async ({ page }) => {
  test.slow();
  await installFakeCoach(page);
  await page.goto("/");
  await startAsWhite(page);
  await nextBtn(page).focus();
  await page.keyboard.press("Enter");
  await expect(log(page)).toHaveCount(1, { timeout: 15_000 });
  await expect(nextBtn(page)).toBeEnabled();
  await expect(nextBtn(page)).toBeFocused();
});

test("if Claude can't be reached at all, hints say so", async ({ page }) => {
  await installFakeStore(page, "u_ale");
  await page.addInitScript(() => {
    const w = window as unknown as { claude: { use: (n: string) => Promise<unknown> } };
    const real = w.claude.use;
    w.claude = {
      use: (name: string) =>
        name === "sample" ? Promise.reject({ code: "not_declared", message: "no" }) : real(name),
    };
  });
  await page.goto("/");
  await startAsWhite(page);
  await expect(page.locator("#hint-status")).toHaveText(
    "Hints from your coach aren't available right now. Reload the page to try again.",
  );
  await expect(nextBtn(page)).toBeDisabled();
});

test("with no coach, hints explain why they are off", async ({ page }) => {
  await page.goto("/");
  await startAsWhite(page);
  await expect(page.locator("#hint-status")).toHaveText(
    "Hints from your coach aren't available right now. Reload the page to try again.",
  );
  await expect(nextBtn(page)).toBeDisabled();
});
