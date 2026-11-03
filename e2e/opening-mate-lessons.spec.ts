import { expect, test, type Page } from "@playwright/test";
import { installFakeStore, squarePoint, tapMove } from "./helpers";

// Lessons 10 to 12 (CC-030): the opening drill names each position, says when
// the player leaves the book and takes the move back; "play it out" exercises
// run against the engine with the safety net.

const text = (page: Page) => page.locator("#lesson-text");
const next = (page: Page) => page.locator("#lesson-next");
const banner = (page: Page) => page.locator("#lesson-banner");

async function open(page: Page, title: string) {
  await installFakeStore(page, "u_ale");
  await page.goto("/");
  await page.locator("#screen-lessons").click();
  await page
    .locator(".lesson-card")
    .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
    .getByRole("button", { name: "Start" })
    .click();
  await expect(page.locator("#lesson-title")).toHaveText(title);
}

async function clickSquare(page: Page, square: string) {
  const p = await squarePoint(page, "lesson-board", square);
  await page.mouse.click(p.x, p.y);
}

/** Clicks through an explain step or a whole show step. */
async function nextUntil(page: Page, where: string) {
  while (!(await page.locator("#lesson-where").textContent())?.startsWith(where)) {
    await next(page).click();
  }
}

test.describe("opening and checkmate lessons", () => {
  test.slow();

  test("Opening principles: the steps, then develop against the engine", async ({
    page,
    hasTouch,
  }) => {
    await open(page, "Opening principles");
    await expect(text(page)).toContainText("The four squares in the middle");
    await nextUntil(page, "Step 3 of 4");
    await clickSquare(page, "c1");
    await expect(text(page)).toContainText("Right. The knight on b1 and the bishop on c1");
    await next(page).click();

    await expect(page.locator("#lesson-where")).toHaveText("Step 4 of 4 · Exercise 1 of 1");
    await expect(text(page)).toContainText(
      "White to move. Bring out both knights and both bishops, and castle, within 10 moves.",
    );
    await expect(text(page)).toContainText(
      "0 of 4 knights and bishops out, not castled yet. 10 moves left.",
    );
    await tapMove(page, "lesson-board", "g1", "f3", hasTouch);
    // The engine checks the move, then answers as Black.
    await expect(text(page)).toContainText(
      "1 of 4 knights and bishops out, not castled yet. 9 moves left.",
      { timeout: 10_000 },
    );
    await expect(page.locator("#lesson-board square.last-move")).toHaveCount(2);
    await page.locator("#lesson-skip").click();
    await expect(page.locator("#lesson-takeaway")).toContainText("take the centre");
  });

  test("The Italian Game: the drill names positions, catches a move out of the book, and ends", async ({
    page,
    hasTouch,
  }) => {
    await open(page, "The Italian Game");
    await nextUntil(page, "Step 4 of 6");
    await clickSquare(page, "f3");
    await expect(text(page)).toContainText("Right: Ng5 attacks f7");
    await next(page).click();

    await expect(page.locator("#lesson-where")).toHaveText("Step 5 of 6 · Exercise 1 of 1");
    await expect(text(page)).toContainText("White to move. Play the Italian Game as White.");
    await expect(page.locator("#lesson-hint-mode")).toBeHidden();
    await tapMove(page, "lesson-board", "e2", "e4", hasTouch);
    await expect(text(page)).toHaveText("King's Pawn Game. White to move.");
    await tapMove(page, "lesson-board", "g1", "f3", hasTouch);
    await expect(text(page)).toHaveText("King's Knight Opening: Normal Variation. White to move.");

    // Out of the book: the move stays on the board until it is taken back.
    await tapMove(page, "lesson-board", "f1", "b5", hasTouch);
    await expect(banner(page)).toBeVisible();
    await expect(page.locator("#lesson-banner-text")).toHaveText(
      "That leaves the book. The Italian Game plays Bc4 here. Bb5 has a name too: the Ruy Lopez. Take your move back and try Bc4.",
    );
    await expect(page.locator("#lesson-try")).toHaveText("Take it back");
    await expect(page.locator("#lesson-why")).toBeHidden();
    await page.locator("#lesson-try").click();
    await expect(banner(page)).toBeHidden();
    await expect(text(page)).toHaveText("King's Knight Opening: Normal Variation. White to move.");

    // Hints come from the book: the piece, then the move.
    await expect(page.locator("#lesson-hint")).toHaveText("Hint: the piece");
    await page.locator("#lesson-hint").click();
    await expect(page.locator("#lesson-hint-log li")).toHaveText([
      "The Italian Game moves a bishop here.",
    ]);
    await expect(page.locator("#lesson-hint")).toHaveText("Hint: the move");

    for (const [from, to, name] of [
      ["f1", "c4", "Italian Game: Giuoco Piano"],
      ["c2", "c3", "Italian Game: Classical Variation"],
      ["d2", "d3", "Italian Game: Classical Variation, Giuoco Pianissimo"],
    ] as const) {
      await tapMove(page, "lesson-board", from, to, hasTouch);
      await expect(text(page)).toHaveText(`${name}. White to move.`);
    }
    await tapMove(page, "lesson-board", "e1", "g1", hasTouch);
    await expect(text(page)).toHaveText("Solved, with help.");
    await next(page).click();

    // Two of Black's mistakes to punish, from the lesson's own positions.
    await expect(page.locator("#lesson-where")).toHaveText("Step 6 of 6 · Exercise 1 of 2");
    await expect(text(page)).toContainText("White to move. Black just made a mistake");
    for (let i = 0; i < 2; i++) await page.locator("#lesson-skip").click();
    await expect(page.locator("#lesson-score")).toHaveText(
      "0 solved first try, 1 with help, 2 skipped, out of 3.",
    );
  });

  test("Mate with king and queen: the stalemate quiz, and the safety net in a play-out", async ({
    page,
    hasTouch,
  }) => {
    await open(page, "Mate with king and queen");
    await nextUntil(page, "Step 4 of 5");
    await clickSquare(page, "b6");
    await expect(text(page)).toContainText("Right: Qb6 takes the king's last squares");
    await next(page).click();

    await expect(page.locator("#lesson-where")).toHaveText("Step 5 of 5 · Exercise 1 of 2");
    await expect(text(page)).toContainText("White to move. Checkmate with king and queen.");
    // Qd5+ next to the king on c6, with nothing defending it: held back.
    await tapMove(page, "lesson-board", "d1", "d5", hasTouch);
    await expect(banner(page)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#lesson-banner-text")).toHaveText(
      "Careful: after this move, your queen on d5 can be taken.",
    );
    await page.locator("#lesson-try").click();
    await expect(banner(page)).toBeHidden();

    // A quiet move is played, and the engine answers.
    await tapMove(page, "lesson-board", "d1", "d4", hasTouch);
    await expect(page.locator("#lesson-board square.last-move")).toHaveCount(2);
    await expect(text(page)).toHaveText(
      "White to move. Checkmate with king and queen. The engine defends at full strength.",
      {
        timeout: 10_000,
      },
    );
    await expect(page.locator("#lesson-board .last-move")).not.toHaveCount(0);
    for (let i = 0; i < 2; i++) await page.locator("#lesson-skip").click();
    await expect(page.locator("#lesson-takeaway")).toContainText("Shrink the box");
  });
});
