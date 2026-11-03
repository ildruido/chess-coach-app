import { expect, test } from "@playwright/test";

// CC-051: the coach diagnostics are off by default, switch on from the page, and stay on.
test.describe("coach diagnostics", () => {
  test("off by default, on from the switch, and remembered", async ({ page }) => {
    await page.goto("/");
    const toggle = page.locator("#diagnostics-toggle");
    const line = page.locator("#hint-diag-count");
    await expect(toggle).not.toBeChecked();
    await expect(line).toHaveAttribute("hidden", "");

    await toggle.check();
    await expect(line).not.toHaveAttribute("hidden", "");
    await expect(line).toContainText("Hints: 0 reused, 0 asked the coach.");

    await page.reload();
    await expect(page.locator("#diagnostics-toggle")).toBeChecked();
    await expect(page.locator("#hint-diag-count")).not.toHaveAttribute("hidden", "");

    await page.locator("#diagnostics-toggle").uncheck();
    await expect(page.locator("#hint-diag-count")).toHaveAttribute("hidden", "");
  });
});
