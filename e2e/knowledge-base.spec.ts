import { expect, test, type Page } from "@playwright/test";
import { showDiagnostics, installFakeStore, tapMove } from "./helpers";

// The coach knowledge base (CC-031): practice hints and move comments are saved
// and shown again with no coach call, marked "Reused from an earlier answer",
// with "Ask the coach anyway" and 👎. Real engine, fake Claude that counts calls.
async function installFakeCoach(page: Page) {
  await installFakeStore(page, "u_ale");
  await page.addInitScript(() => {
    const w = window as unknown as { claude: { use: (n: string) => Promise<unknown> } };
    const sample = async (input: string) => {
      const n = Number(localStorage.getItem("kb-calls") ?? "0") + 1;
      localStorage.setItem("kb-calls", String(n));
      if (input.includes("reviewing a beginner's finished practice game")) {
        const plies = [...input.matchAll(/\{"ply":(\d+),"why":"\.\.\."\}/g)].map((m) =>
          Number(m[1]),
        );
        const text = JSON.stringify({
          points: plies.map((ply) => ({ ply, why: "Coach: it keeps your pieces safe." })),
          lesson: "Coach lesson: look at every capture before you move.",
        });
        return { text, truncated: false, modelTierApplied: "default" };
      }
      const text = input.includes("commenting on a beginner's last move")
        ? `Coach: it weakens your king (${n}).`
        : `Take space in the middle (${n}).`;
      return { text, truncated: false, modelTierApplied: "quick" };
    };
    const real = w.claude.use;
    w.claude = { use: async (name: string) => (name === "sample" ? sample : real(name)) };
  });
}

const calls = (page: Page) => page.evaluate(() => Number(localStorage.getItem("kb-calls") ?? "0"));
const log = (page: Page) => page.locator("#hint-log li");
const reuseNote = (page: Page) => page.locator(".reuse-note");

async function startAsWhite(page: Page) {
  await page.locator("#practice-level").selectOption("1");
  await page.locator("#practice-setup").getByLabel("White").check();
  await page.getByRole("button", { name: "Start game" }).click();
  await expect(page.locator("#practice-status")).toHaveText("Your move.");
}

test.describe("knowledge base", () => {
  test.beforeEach(async ({ page }) => showDiagnostics(page));
  test.slow();

  test("a hint for the same position is shown again with no coach call; 👎 and Ask anyway", async ({
    page,
  }) => {
    await installFakeCoach(page);
    await page.goto("/");
    await startAsWhite(page);
    await page.locator("#hint-next").click();
    await expect(log(page)).toHaveCount(1, { timeout: 15_000 });
    await expect(log(page).nth(0)).toContainText("Take space in the middle (1).");
    await expect(reuseNote(page)).toHaveCount(0);
    expect(await calls(page)).toBe(1);

    // A new game, the same first hint: the saved one, marked, and no call.
    await page.locator("#practice-new").click();
    await startAsWhite(page);
    await page.locator("#hint-next").click();
    await expect(log(page).nth(0)).toContainText("Take space in the middle (1).", {
      timeout: 15_000,
    });
    await expect(reuseNote(page)).toContainText("Reused from an earlier answer.");
    expect(await calls(page)).toBe(1);

    // Ask the coach anyway: a new answer in the same place, counted once.
    await reuseNote(page).getByRole("button", { name: "Ask the coach anyway" }).click();
    await expect(log(page).nth(0)).toContainText("(2)", { timeout: 15_000 });
    await expect(log(page)).toHaveCount(1);
    await expect(reuseNote(page)).toHaveCount(0);
    expect(await calls(page)).toBe(2);

    // The newest answer is the one reused next; 👎 stops it for good.
    await page.locator("#practice-new").click();
    await startAsWhite(page);
    await page.locator("#hint-next").click();
    await expect(log(page).nth(0)).toContainText("(2)", { timeout: 15_000 });
    await reuseNote(page)
      .getByRole("button", { name: /Bad answer/ })
      .click();
    await expect(reuseNote(page)).toContainText("won't be shown again");
    await page.locator("#practice-new").click();
    await startAsWhite(page);
    await page.locator("#hint-next").click();
    await expect(log(page).nth(0)).toContainText("(1)", { timeout: 15_000 });
    expect(await calls(page)).toBe(2);
  });

  test("a move comment is shown again when the same move is played in the same position", async ({
    page,
    hasTouch,
  }) => {
    await installFakeCoach(page);
    await page.goto("/");
    await startAsWhite(page);
    await page.locator("#commentary-toggle").check();
    await tapMove(page, "practice-board", "g2", "g4", hasTouch);
    await expect(page.locator("#practice-moves")).toHaveAttribute("data-count", "2", {
      timeout: 15_000,
    });
    const items = page.locator('#commentary-log li:not([data-verdict="good"])');
    await expect(items).toHaveCount(1, { timeout: 15_000 });
    const first = await calls(page);
    expect(first).toBeGreaterThan(0);

    await page.locator("#practice-new").click();
    await startAsWhite(page);
    await tapMove(page, "practice-board", "g2", "g4", hasTouch);
    await expect(items).toHaveCount(1, { timeout: 15_000 });
    await expect(items.first().locator(".reuse-note")).toContainText(
      "Reused from an earlier answer.",
    );
    expect(await calls(page)).toBe(first);
  });

  test("lesson answers saved before this version are still reused", async ({ page }) => {
    await installFakeCoach(page);
    await page.addInitScript(() => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem(
        "fake-db",
        JSON.stringify({
          "lesson-answers/free-pieces/answers/old1": {
            v: 1,
            id: "old1",
            lessonId: "free-pieces",
            lessonVersion: 1,
            kind: "ask",
            scope: "idea",
            place: "step:0",
            bestMove: null,
            question: "What is a pin?",
            answer: "A pin holds a piece in front of a bigger one (saved earlier).",
            createdAt: "2026-10-08T10:00:00Z",
            reuses: 0,
            vote: 0,
          },
        }),
      );
    });
    await page.goto("/");
    await page.locator("#screen-lessons").click();
    await page
      .locator(".lesson-card")
      .first()
      .getByRole("button", { name: /Start|Resume/ })
      .click();
    await page.locator("#lesson-voice-input").fill("what's a pin");
    await page.locator("#lesson-voice-send").click();
    await expect(page.locator("#lesson-answer-a")).toContainText("(saved earlier)");
    await expect(page.locator("#lesson-answer-note")).toHaveText("You asked this before.");
    expect(await calls(page)).toBe(0);
    await expect(page.locator("#lesson-answer-count")).toHaveText(
      "Lesson questions: 1 reused, 0 asked the coach.",
    );
  });

  test("a game reviewed before gets its saved review, checked again, with no coach call", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    // Resumes a game in which the player threw the queen away, then resigns and reviews it.
    async function review(): Promise<Page> {
      const page = await context.newPage();
      await installFakeCoach(page);
      await page.addInitScript(() => {
        if (sessionStorage.getItem("seeded")) return;
        sessionStorage.setItem("seeded", "1");
        const at = new Date().toISOString();
        const all = JSON.parse(localStorage.getItem("fake-db") ?? "{}");
        all["data/users/u_ale/practice-game"] = {
          version: 1,
          moves: ["e2e4", "e7e5", "d1h5", "b8c6", "h5f7"],
          createdAt: at,
          updatedAt: at,
          level: 1,
          color: "white",
          resigned: false,
          hints: [],
          hintMode: "tell",
        };
        localStorage.setItem("fake-db", JSON.stringify(all));
      });
      await page.goto("/");
      await expect(page.locator("#practice-moves")).toHaveAttribute("data-count", "6", {
        timeout: 15_000,
      });
      await expect(page.locator("#practice-status")).toHaveText(/^Your move/);
      await page.locator("#practice-resign").click();
      await page.locator("#review .review-start").click();
      await expect(page.locator("#review-points li").first()).toContainText(
        "Coach: it keeps your pieces safe.",
        { timeout: 30_000 },
      );
      return page;
    }
    const first = await review();
    await expect(first.locator("#review .reuse-note")).toHaveCount(0);
    expect(await calls(first)).toBe(1);
    await first.close();

    const second = await review();
    await expect(second.locator("#review .reuse-note")).toContainText(
      "Reused from an earlier answer.",
    );
    expect(await calls(second)).toBe(1);
  });
});
