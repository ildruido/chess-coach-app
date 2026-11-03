import { expect, test, type Page } from "@playwright/test";
import { installFakeStore, squarePoint, tapMove } from "./helpers";
import puzzleFile from "../src/data/puzzles.json" with { type: "json" };

// The Free pieces exercises come from the bundled lichess puzzles: the
// hangingPiece theme up to rating 800, five per run, rotated by the run number.
type Tuple = [string, string, string, number];
const POOL = (puzzleFile.t.hangingPiece as Tuple[]).filter((t) => t[3] <= 800);
function picks(run: number) {
  return [0, 1, 2, 3, 4]
    .map((i) => POOL[(run * 5 + i) % POOL.length]!)
    .sort((a, b) => a[3] - b[3])
    .map(([id, fen, moves]) => ({
      id,
      // The FEN is before the opponent's setup move, so the player is the other side.
      side: (fen.split(" ")[1] === "w" ? "black" : "white") as "white" | "black",
      setup: moves.split(" ")[0]!,
      solution: moves.split(" ").slice(1),
    }));
}

/** Plays the player's moves of a puzzle, waiting for each forced reply. */
async function solve(page: Page, p: ReturnType<typeof picks>[number], touch: boolean) {
  for (let i = 0; i < p.solution.length; i += 2) {
    const m = p.solution[i]!;
    await expect(page.locator("#lesson-text")).toContainText(/to move( again)?\./);
    await tapMove(page, "lesson-board", m.slice(0, 2), m.slice(2, 4), touch, p.side);
    // Let the opponent's forced reply (450 ms) land before the next move.
    if (i + 2 < p.solution.length) await page.waitForTimeout(800);
  }
}

// Lessons (CC-025): the Free pieces lesson on the real engine, a fake db that
// survives reloads, and a fake coach for "Why?" that counts its calls.
async function installFakes(page: Page) {
  await installFakeStore(page, "u_ale");
  await page.addInitScript(() => {
    const w = window as unknown as { claude: { use: (n: string) => Promise<unknown> } };
    const sample = async (input: string) => {
      localStorage.setItem("why-calls", String(Number(localStorage.getItem("why-calls")) + 1));
      const ok = input.includes("explaining to a beginner why a move");
      return {
        text: ok ? "Coach: after Rd5, the black queen takes it with check and it is mate." : "",
        truncated: false,
      };
    };
    const real = w.claude.use;
    w.claude = { use: async (name: string) => (name === "sample" ? sample : real(name)) };
  });
}

const text = (page: Page) => page.locator("#lesson-text");
const next = (page: Page) => page.locator("#lesson-next");

async function clickSquare(page: Page, square: string) {
  const p = await squarePoint(page, "lesson-board", square);
  await page.mouse.click(p.x, p.y);
}

test.describe("lessons", () => {
  test.slow();

  test("Free pieces: explain, show, quiz, exercises with the safety net, and the end", async ({
    page,
    hasTouch,
  }) => {
    await installFakes(page);
    await page.goto("/");
    await page.locator("#screen-lessons").click();
    await expect(page.locator("#lessons-screen")).toBeVisible();
    await expect(page.locator("#practice-screen")).toBeHidden();
    const card = page.locator(".lesson-card").first();
    await expect(card).toContainText("Free pieces");
    await expect(card).toContainText("Not started.");
    await card.getByRole("button", { name: "Start" }).click();

    // Explain: text with bold squares, and an arrow and a marked square on the board.
    await expect(page.locator("#lesson-where")).toHaveText("Step 1 of 5");
    await expect(text(page)).toContainText("Black's knight on d5 has no defender");
    await expect(text(page).locator("strong").first()).toHaveText("d5");
    await expect(
      page.locator("#lesson-board .cg-shapes g, #lesson-board svg g").first(),
    ).toBeAttached();
    await expect(page.locator("#lesson-back")).toBeDisabled();
    await next(page).click();
    await expect(text(page)).toContainText("Now the pawn on e6 defends the knight");

    // Show: one move per click.
    await next(page).click();
    await expect(text(page)).toContainText("Back to the free knight");
    await expect(next(page)).toHaveText("Next move");
    await next(page).click();
    await expect(text(page)).toContainText("Qxd5: the queen takes the knight");
    await next(page).click();

    // Quiz: a wrong square, then the right one.
    await expect(text(page)).toContainText("One black piece is free. Click it.");
    await expect(next(page)).toBeDisabled();
    await clickSquare(page, "a5");
    await expect(text(page)).toContainText("Not that one");
    await clickSquare(page, "g4");
    await expect(text(page)).toContainText("Right: the bishop on g4");
    await next(page).click();

    // Exercise 1 (first bundled puzzle, White): a move that allows mate is held back.
    const run0 = picks(0);
    await expect(page.locator("#lesson-where")).toHaveText("Step 5 of 5 · Exercise 1 of 5");
    await expect(page.locator("#lesson-commentary")).not.toBeChecked();
    await expect(page.locator("#lesson-board")).toHaveClass(
      new RegExp(`orientation-${run0[0]!.side}`),
    );
    await expect(text(page)).toContainText("White to move.");
    // Rd5 in puzzle UqYwH: the queen takes it with check and mates.
    expect(run0[0]!.id).toBe("UqYwH");
    await tapMove(page, "lesson-board", "d1", "d5", hasTouch);
    const banner = page.locator("#lesson-banner");
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#lesson-banner-text")).toHaveText(
      "Careful: this move lets Black checkmate.",
    );
    await expect(text(page)).toHaveText("Wait: read the warning below before you go on.");
    await page.locator("#lesson-why").click();
    await expect(page.locator("#lesson-why-text")).toHaveText(
      "Coach: after Rd5, the black queen takes it with check and it is mate.",
    );
    expect(await page.evaluate(() => localStorage.getItem("why-calls"))).toBe("1");
    await page.locator("#lesson-try").click();
    await expect(banner).toBeHidden();
    await solve(page, run0[0]!, hasTouch);
    await expect(text(page)).toHaveText("Solved, with help.");
    await next(page).click();

    // Exercise 2: solved first try.
    await expect(page.locator("#lesson-where")).toHaveText("Step 5 of 5 · Exercise 2 of 5");
    await solve(page, run0[1]!, hasTouch);
    await expect(text(page)).toHaveText("Solved first try!");
    await next(page).click();

    // Exercise 3: a hint from the engine, the ask toggle, then skip the rest.
    await expect(page.locator("#lesson-hint")).toHaveText("Hint: the plan");
    await page.locator("#lesson-hint-mode").getByLabel("Ask me").check();
    await expect(page.locator("#lesson-hint")).toHaveText("Hint: ask me a question");
    await page.locator("#lesson-hint").click();
    await expect(page.locator("#lesson-hint-log li")).toHaveCount(1, { timeout: 10_000 });
    await expect(page.locator("#lesson-hint-another")).toBeVisible();
    for (let i = 0; i < 3; i++) await page.locator("#lesson-skip").click();

    // The end: takeaway and score.
    await expect(page.locator("#lesson-end")).toBeVisible();
    await expect(page.locator("#lesson-takeaway")).toHaveText(
      "Before every move, look for an enemy piece nothing defends, and take it.",
    );
    await expect(page.locator("#lesson-score")).toHaveText(
      "1 solved first try, 1 with help, 3 skipped, out of 5.",
    );
    await page.locator("#lesson-done").click();
    await expect(card).toContainText("Done.");
  });

  test("a lesson resumes at the same step after a reload", async ({ page }) => {
    await installFakes(page);
    await page.goto("/");
    await page.locator("#screen-lessons").click();
    await page.locator(".lesson-card").first().getByRole("button", { name: "Start" }).click();
    await next(page).click();
    await expect(page.locator("#lesson-where")).toHaveText("Step 2 of 5");

    await page.reload();
    // The Lessons screen opens again, since it was the last one used.
    const card = page.locator(".lesson-card").first();
    await expect(card).toContainText("In progress: step 2 of 5.", { timeout: 15_000 });
    await card.getByRole("button", { name: "Resume" }).click();
    await expect(page.locator("#lesson-where")).toHaveText("Step 2 of 5");
    await expect(text(page)).toContainText("Now the pawn on e6 defends the knight");
  });

  test("play it anyway, and a solved exercise isn't counted twice after a reload", async ({
    page,
    hasTouch,
  }) => {
    await installFakes(page);
    await page.goto("/");
    await page.locator("#screen-lessons").click();
    await page.locator(".lesson-card").first().getByRole("button", { name: "Start" }).click();
    for (let i = 0; i < 4; i++) await next(page).click();
    await clickSquare(page, "g4");
    await next(page).click();

    // Exercise 1 solved, then a reload before pressing Next.
    const run0 = picks(0);
    await solve(page, run0[0]!, hasTouch);
    await expect(text(page)).toHaveText("Solved first try!");
    await page.reload();
    await page.locator(".lesson-card").first().getByRole("button", { name: "Resume" }).click();
    await expect(page.locator("#lesson-where")).toHaveText("Step 5 of 5 · Exercise 2 of 5");

    // Play the losing move anyway (Rf1 in puzzle 40mS4 allows Qxg2 mate): the
    // engine answers, and Hint waits for Try again.
    expect(run0[1]!.id).toBe("40mS4");
    await expect(text(page)).toContainText("White to move.");
    await tapMove(page, "lesson-board", "g1", "f1", hasTouch);
    await expect(page.locator("#lesson-banner")).toBeVisible({ timeout: 10_000 });
    await page.locator("#lesson-anyway").click();
    await expect(page.locator("#lesson-banner-text")).toContainText("The engine answers Qxg2", {
      timeout: 5_000,
    });
    await expect(page.locator("#lesson-why")).toBeHidden();
    await expect(page.locator("#lesson-hint")).toBeDisabled();
    await page.locator("#lesson-try").click();
    await expect(page.locator("#lesson-banner")).toBeHidden();
    await solve(page, run0[1]!, hasTouch);
    await expect(text(page)).toHaveText("Solved, with help.");
    await next(page).click();
    for (let i = 0; i < 3; i++) await page.locator("#lesson-skip").click();
    await expect(page.locator("#lesson-score")).toHaveText(
      "1 solved first try, 1 with help, 3 skipped, out of 5.",
    );
  });

  test("a replayed lesson draws new puzzles, and the board turns to the side to move", async ({
    page,
  }) => {
    await installFakes(page);
    await page.goto("/");
    await page.locator("#screen-lessons").click();
    const card = page.locator(".lesson-card").first();
    const runs = [picks(0), picks(1)];
    expect(runs[1]!.map((p) => p.id)).not.toEqual(runs[0]!.map((p) => p.id));
    for (const run of runs) {
      await card.getByRole("button", { name: /Start|Do it again/ }).click();
      for (let i = 0; i < 4; i++) await next(page).click();
      await clickSquare(page, "g4");
      await next(page).click();
      for (const p of run) {
        const side = p.side === "white" ? "White" : "Black";
        await expect(text(page)).toContainText(`${side} to move.`);
        await expect(page.locator("#lesson-board")).toHaveClass(
          new RegExp(`orientation-${p.side}`),
        );
        // The opponent's setup move is the last move shown.
        await expect(page.locator("#lesson-board square.last-move")).toHaveCount(2);
        await page.locator("#lesson-skip").click();
      }
      await expect(page.locator("#lesson-score")).toHaveText(
        "0 solved first try, 5 skipped, out of 5.",
      );
      await page.locator("#lesson-done").click();
      await expect(card).toContainText("Done.");
    }
  });

  test("Why? at the usage limit pauses the coach and doesn't call again", async ({
    page,
    hasTouch,
  }) => {
    await installFakeStore(page, "u_ale");
    await page.addInitScript(() => {
      const w = window as unknown as { claude: { use: (n: string) => Promise<unknown> } };
      const sample = async () => {
        localStorage.setItem("why-calls", String(Number(localStorage.getItem("why-calls")) + 1));
        throw { code: "rate_limited", message: "limit" };
      };
      const real = w.claude.use;
      w.claude = { use: async (name: string) => (name === "sample" ? sample : real(name)) };
    });
    await page.goto("/");
    await page.locator("#screen-lessons").click();
    await page.locator(".lesson-card").first().getByRole("button", { name: "Start" }).click();
    for (let i = 0; i < 4; i++) await next(page).click();
    await clickSquare(page, "g4");
    await next(page).click();
    await expect(text(page)).toContainText("White to move.");
    await tapMove(page, "lesson-board", "d1", "d5", hasTouch);
    await expect(page.locator("#lesson-banner")).toBeVisible({ timeout: 10_000 });
    await page.locator("#lesson-why").click();
    await expect(page.locator("#coach-paused")).toBeVisible();
    await expect(page.locator("#lesson-why-text")).toHaveText(
      "The coach is paused at your usage limit. The warning above says what goes wrong.",
    );
    await expect(page.locator("#lesson-why")).toBeEnabled();
    await page.locator("#lesson-why").click();
    await expect(page.locator("#lesson-why-text")).toHaveText(
      "The coach is paused at your usage limit. The warning above says what goes wrong.",
    );
    expect(await page.evaluate(() => localStorage.getItem("why-calls"))).toBe("1");
  });
});
