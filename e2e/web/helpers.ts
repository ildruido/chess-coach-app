import { expect, type Page } from "@playwright/test";

// The web project runs against the real server (server/e2e/server.ts); the scripted AI replaces
// Anthropic, and the server hands out invites on a test-only route.

/** A fresh one-use invite link path (`/#/invite/<token>`). */
export async function newInvite(): Promise<string> {
  const res = await fetch("http://localhost:4175/__e2e/invite", { method: "POST" });
  const { token } = (await res.json()) as { token: string };
  return `/#/invite/${token}`;
}

let counter = 0;
/** A unique email and a valid password. */
export function newAccount() {
  counter += 1;
  return {
    email: `player${Date.now()}${counter}@example.com`,
    password: "correct horse battery",
  };
}

/** Redeem an invite in the page and land in the app, signed in. */
export async function signUp(page: Page) {
  const account = newAccount();
  await page.goto(await newInvite());
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Create my account" }).click();
  await expect(page.locator("#session-bar")).toContainText(account.email);
  return account;
}

/** Collect Content-Security-Policy violations and uncaught page errors; there must be none. */
export async function watchCsp(page: Page): Promise<string[]> {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (/content security policy/i.test(m.text())) violations.push(m.text());
  });
  // Any uncaught error in the page counts too.
  page.on("pageerror", (e) => violations.push(e.message));
  return violations;
}
