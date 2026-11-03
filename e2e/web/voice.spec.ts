import { expect, test } from "@playwright/test";
import { signUp, watchCsp } from "./helpers";

// A fake SpeechRecognition stands in for the browser's (CC-043h). It never listens until the
// Speak button is pressed, and says "play e4" when asked.
test("Speak puts the words in the box, and the microphone is allowed by the page policy", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.started = 0;
    class Rec {
      onresult: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        (w.started as number)++;
        setTimeout(() => {
          this.onresult?.({
            results: [Object.assign([{ transcript: "play e4" }], { isFinal: true })],
          });
          this.onend?.();
        }, 50);
      }
      stop() {
        this.onend?.();
      }
    }
    Object.defineProperty(window, "SpeechRecognition", { value: Rec });
  });
  const violations = await watchCsp(page);
  const res = await page.request.get("/");
  expect(res.headers()["permissions-policy"]).toContain("microphone=(self)");
  await signUp(page);

  await page.locator("#practice-level").selectOption("1");
  await page.getByRole("button", { name: "Start game" }).click();
  await expect(page.locator("#practice-status")).toHaveText("Your move.");
  await expect(page.locator("#voice-mic")).toBeVisible();
  await expect(page.locator("#voice-keyboard-note")).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { started: number }).started)).toBe(0);

  await page.locator("#voice-mic").click();
  await expect(page.locator("#voice-input")).toHaveValue("play e4");
  await expect(page.locator("#voice-status")).toContainText("press Send");
  expect(await page.evaluate(() => (window as unknown as { started: number }).started)).toBe(1);
  expect(violations).toEqual([]);
});

test("without speech recognition the Speak button stays hidden", async ({ page }) => {
  await page.addInitScript(() => {
    for (const n of ["SpeechRecognition", "webkitSpeechRecognition"])
      Object.defineProperty(window, n, { value: undefined });
  });
  await signUp(page);
  await page.locator("#practice-level").selectOption("1");
  await page.getByRole("button", { name: "Start game" }).click();
  await expect(page.locator("#practice-status")).toHaveText("Your move.");
  await expect(page.locator("#voice-mic")).toBeHidden();
  await expect(page.locator("#voice-keyboard-note")).toBeVisible();
});
