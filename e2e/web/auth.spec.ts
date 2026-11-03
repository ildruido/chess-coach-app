import { expect, test } from "@playwright/test";
import { newAccount, newInvite, signUp } from "./helpers";

test.describe("web app sign-in", () => {
  test("an invite makes an account; the session survives a reload; sign out and back in", async ({
    page,
  }) => {
    const account = await signUp(page);
    // The invite is gone from the address and the app is up.
    expect(page.url()).not.toContain("invite");
    await expect(page.locator("#practice-heading")).toBeVisible();

    await page.reload();
    await expect(page.locator("#session-bar")).toContainText(account.email);

    await page.locator("#sign-out").click();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password").fill("wrong password!!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toContainText("isn't right");

    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator("#session-bar")).toContainText(account.email);
  });

  test("change password: needs the current one, signs out other devices, new one signs in", async ({
    page,
    browser,
  }) => {
    const account = await signUp(page);
    const other = await browser.newPage();
    await other.goto("/");
    await other.getByLabel("Email").fill(account.email);
    await other.getByLabel("Password").fill(account.password);
    await other.getByRole("button", { name: "Sign in" }).click();
    await expect(other.locator("#session-bar")).toContainText(account.email);

    await page.locator("#change-password").click();
    const form = page.locator("#password-form");
    await form.getByLabel("Current password").fill("not my password");
    await form.getByLabel("New password").fill("another long password");
    await form.getByRole("button", { name: "Save new password" }).click();
    await expect(form.getByRole("alert")).toContainText("current password isn't right");

    await form.getByLabel("Current password").fill(account.password);
    await form.getByRole("button", { name: "Save new password" }).click();
    await expect(page.locator("#session-bar")).toContainText("Password changed");
    await expect(form).toBeHidden();

    // The other device is signed out: its next save or coach call sends it to the sign-in
    // screen on its own (no reload by hand); this one is not.
    await other.getByRole("button", { name: "Start game" }).click();
    await expect(other.getByRole("button", { name: "Sign in" })).toBeVisible();
    await other.close();
    await page.reload();
    await expect(page.locator("#session-bar")).toContainText(account.email);

    await page.locator("#sign-out").click();
    await page.getByLabel("Email").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toContainText("isn't right");
    await page.getByLabel("Password").fill("another long password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator("#session-bar")).toContainText(account.email);
  });

  test("an invite works once; a made-up one is refused", async ({ page, browser }) => {
    const link = await newInvite();
    const first = newAccount();
    await page.goto(link);
    await page.getByLabel("Email").fill(first.email);
    await page.getByLabel("Password").fill(first.password);
    await page.getByRole("button", { name: "Create my account" }).click();
    await expect(page.locator("#session-bar")).toBeVisible();

    const other = await browser.newPage();
    await other.goto(link);
    const second = newAccount();
    await other.getByLabel("Email").fill(second.email);
    await other.getByLabel("Password").fill(second.password);
    await other.getByRole("button", { name: "Create my account" }).click();
    await expect(other.getByRole("alert")).toContainText("invite may be used or expired");
    await other.close();

    const fake = await browser.newPage();
    await fake.goto("/#/invite/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    await fake.getByLabel("Email").fill(newAccount().email);
    await fake.getByLabel("Password").fill("correct horse battery");
    await fake.getByRole("button", { name: "Create my account" }).click();
    await expect(fake.getByRole("alert")).toContainText("invite may be used or expired");
    await fake.close();
  });

  test("the API refuses anyone who is not signed in", async ({ request }) => {
    for (const path of [
      "/api/auth/me",
      "/api/db/doc?path=data/users/x/current-game",
      "/api/coach/usage",
    ]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(401);
    }
  });
});
