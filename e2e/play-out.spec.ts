import { expect, test, type Page } from "@playwright/test";
import { installFakeEngine, installFakeStore, scriptLine, squarePoint, tapMove } from "./helpers";

// "Play it out" exercises (CC-030) to the end, against a scripted engine so
// each game goes the same way: the goal met, the move limit, and a game the
// engine wins.

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const KQ = "8/8/2k5/8/8/8/8/3QK3 w - - 0 1";
const text = (page: Page) => page.locator("#lesson-text");

async function openExercise(page: Page, title: string, quiz: string) {
  await installFakeStore(page, "u_ale");
  await page.goto("/");
  await page.locator("#screen-lessons").click();
  await page
    .locator(".lesson-card")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
    .getByRole("button", { name: "Start" })
    .click();
  // Through the steps to the quiz, answer it, then on to the exercise.
  while (!(await page.locator("#lesson-next").isDisabled())) {
    await page.locator("#lesson-next").click();
  }
  const p = await squarePoint(page, "lesson-board", quiz);
  await page.mouse.click(p.x, p.y);
  await page.locator("#lesson-next").click();
  await expect(page.locator("#lesson-where")).toContainText("Exercise 1 of");
}

/** Plays the player's moves of a line (every other move), waiting for each scripted reply. */
async function playLine(page: Page, line: string, touch: boolean) {
  const moves = line.split(" ");
  for (let i = 0; i < moves.length; i += 2) {
    const m = moves[i]!;
    await expect(text(page)).toContainText("White to move.");
    await tapMove(page, "lesson-board", m.slice(0, 2), m.slice(2, 4), touch);
    if (i + 2 >= moves.length) break;
    // The engine looks at the move and answers (at least the 450 ms reply delay),
    // then it is White's turn again.
    await expect(text(page)).not.toContainText("White to move.");
    await expect(text(page)).toContainText("White to move.", { timeout: 10_000 });
  }
}

test.describe("play it out", () => {
  test.slow();

  test("checkmate with king and queen ends the exercise as solved", async ({ page, hasTouch }) => {
    // Stockfish's own line from this position, both sides.
    const line = "d1d8 c6c5 e1d2 c5c6 d2c3 c6b7 d8d7 b7a6 c3c4 a6b6 c4b4 b6a6 b4c5 a6a5 d7b5";
    await installFakeEngine(page, scriptLine(KQ, line));
    await openExercise(page, "Mate with king and queen", "b6");
    await playLine(page, line, hasTouch);
    await expect(text(page)).toHaveText("Solved first try!");
    await expect(page.locator("#lesson-next")).toHaveText("Next exercise");
  });

  test("develop and castle: the counter, the goal, and the move limit", async ({
    page,
    hasTouch,
  }) => {
    const develop = "g1f3 a7a6 g2g3 h7h6 f1g2 a6a5 e1g1 h6h5 b1c3 b7b6 d2d3 g7g6 c1d2";
    const limit =
      "a2a3 g8f6 a3a4 f6g8 h2h3 b8c6 h3h4 c6b8 b2b3 g8h6 b3b4 h6g8 g2g3 b8a6 g3g4 a6b8 c2c3 g8f6 c3c4";
    await installFakeEngine(page, { ...scriptLine(START, develop), ...scriptLine(START, limit) });
    await openExercise(page, "Opening principles", "b1");

    // Ten moves that bring nothing out: the exercise stops and starts over.
    await playLine(page, limit, hasTouch);
    await expect(page.locator("#lesson-banner-text")).toHaveText(
      "Your 10 moves are up: 0 of 4 knights and bishops out, not castled yet. Press Try again to start over.",
    );
    await expect(page.locator("#lesson-why")).toBeHidden();
    await expect(page.locator("#lesson-anyway")).toBeHidden();
    await page.locator("#lesson-try").click();
    await expect(text(page)).toContainText(
      "0 of 4 knights and bishops out, not castled yet. 10 moves left.",
    );

    // Developed and castled in seven moves.
    await playLine(page, develop.split(" ").slice(0, 8).join(" "), hasTouch);
    await expect(text(page)).toContainText(
      "2 of 4 knights and bishops out, castled. 6 moves left.",
    );
    await playLine(page, develop.split(" ").slice(8).join(" "), hasTouch);
    await expect(text(page)).toHaveText("Solved, with help.");
  });

  test("a game the engine wins stops, and Try again starts over", async ({ page, hasTouch }) => {
    await installFakeEngine(page, scriptLine(START, "f2f3 e7e5 g2g4 d8h4"));
    await openExercise(page, "Opening principles", "c1");
    await playLine(page, "f2f3 e7e5 g2g4", hasTouch);
    await expect(page.locator("#lesson-banner-text")).toHaveText(
      "The engine gave checkmate. Press Try again to start over.",
      { timeout: 10_000 },
    );
    await page.locator("#lesson-try").click();
    await expect(text(page)).toContainText("10 moves left.");
  });
});
