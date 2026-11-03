import { expect, test } from "@playwright/test";

// The page must never scroll sideways, on desktop or phone.
test("no horizontal scrolling", async ({ page }) => {
  await page.goto("/");
  const { scroll, width } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: document.documentElement.clientWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(width);
});

// The small checkerboard logo in the header keeps its size (styles for other boards must not reach it).
test("the header logo keeps its size", async ({ page }) => {
  await page.goto("/");
  const box = await page.locator(".masthead .mini-board").boundingBox();
  expect(box?.width).toBe(72);
  expect(box?.height).toBe(72);
});
