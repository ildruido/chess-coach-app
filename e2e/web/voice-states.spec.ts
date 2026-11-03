import { expect, test, type Page } from "@playwright/test";
import { signUp } from "./helpers";

// Fake recognition whose behaviour is chosen per test via window.mode (CC-043h QA).
async function fake(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.mode = "hang";
    class Rec {
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        const m = w.mode as string;
        if (m === "denied")
          setTimeout(() => {
            this.onerror?.({ error: "not-allowed" });
            this.onend?.();
          }, 30);
        if (m === "network")
          setTimeout(() => {
            this.onerror?.({ error: "network" });
            this.onend?.();
          }, 30);
        if (m === "empty") setTimeout(() => this.onend?.(), 30);
        if (m === "silent")
          setTimeout(() => {
            this.onerror?.({ error: "no-speech" });
            this.onend?.();
          }, 30);
      }
      stop() {
        this.onend?.();
      }
    }
    Object.defineProperty(window, "SpeechRecognition", { value: Rec });
  });
  await signUp(page);
  await page.locator("#practice-level").selectOption("1");
  await page.getByRole("button", { name: "Start game" }).click();
  await expect(page.locator("#practice-status")).toHaveText("Your move.");
}

test("Speak toggles to Stop and back; Stop returns to Speak", async ({ page }) => {
  await fake(page);
  const mic = page.locator("#voice-mic");
  await expect(mic).toHaveText("Speak");
  await mic.click();
  await expect(mic).toHaveText("Stop");
  await expect(mic).toHaveAttribute("aria-pressed", "true");
  await mic.click();
  await expect(mic).toHaveText("Speak");
  await expect(mic).toHaveAttribute("aria-pressed", "false");
});

test("blocked microphone explains itself", async ({ page }) => {
  await fake(page);
  await page.evaluate(() => ((window as unknown as { mode: string }).mode = "denied"));
  await page.locator("#voice-mic").click();
  await expect(page.locator("#voice-status")).toContainText("microphone is blocked");
  await expect(page.locator("#voice-mic")).toHaveText("Speak");
});

test("no speech heard says so", async ({ page }) => {
  await fake(page);
  await page.evaluate(() => ((window as unknown as { mode: string }).mode = "silent"));
  await page.locator("#voice-mic").click();
  await expect(page.locator("#voice-status")).toContainText("didn't hear anything");
  await expect(page.locator("#voice-mic")).toHaveText("Speak");
});

test("Send while listening stops listening", async ({ page }) => {
  await fake(page);
  await page.locator("#voice-input").fill("what is a fork");
  await page.locator("#voice-mic").click();
  await expect(page.locator("#voice-mic")).toHaveText("Stop");
  await page.locator("#voice-send").click();
  await expect(page.locator("#voice-mic")).toHaveText("Speak");
  await expect(page.locator("#voice-mic")).toHaveAttribute("aria-pressed", "false");
});

test("no network says so, and the page names what voice can do", async ({ page }) => {
  await fake(page);
  await expect(page.locator("#voice-support")).toContainText("speak to the coach");
  await page.evaluate(() => ((window as unknown as { mode: string }).mode = "network"));
  await page.locator("#voice-mic").click();
  await expect(page.locator("#voice-status")).toContainText("internet connection");
  await expect(page.locator("#voice-mic")).toHaveText("Speak");
});

test("listening that ends with no words and no error still says nothing was heard", async ({
  page,
}) => {
  await fake(page);
  await page.evaluate(() => ((window as unknown as { mode: string }).mode = "empty"));
  await page.locator("#voice-mic").click();
  await expect(page.locator("#voice-status")).toContainText("didn't hear anything");
});

test("offline: Speak says an internet connection is needed and does not listen", async ({
  page,
  context,
}) => {
  await fake(page);
  await context.setOffline(true);
  await page.locator("#voice-mic").click();
  await expect(page.locator("#voice-status")).toContainText("internet connection");
  await expect(page.locator("#voice-mic")).toHaveText("Speak");
  await context.setOffline(false);
});

test("Send says you're offline when the server can't be reached, even if the browser says online", async ({
  page,
}) => {
  await fake(page);
  // Only the coach request fails; navigator.onLine stays true, as with a VPN adapter up.
  await page.route("**/api/coach/ask", (route) => route.abort("internetdisconnected"));
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);
  await page.locator("#voice-input").fill("what is a fork");
  await page.locator("#voice-send").click();
  await expect(
    page.getByText("You're offline. The coach needs an internet connection"),
  ).toBeVisible();
});
