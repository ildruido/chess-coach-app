import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("needs a database", () => {
    expect(() => loadConfig({}, "1")).toThrow(/DATABASE_URL/);
  });
  it("defaults the port", () => {
    expect(loadConfig({ DATABASE_URL: "postgres://x" }, "1").port).toBe(8080);
  });
  it("refuses the test user in production unless overridden", () => {
    const env = { DATABASE_URL: "postgres://x", AUTH_TEST_USER_ID: "u", NODE_ENV: "production" };
    expect(() => loadConfig(env, "1")).toThrow(/production/);
    expect(loadConfig({ ...env, ALLOW_TEST_USER: "1" }, "1").testUserId).toBe("u");
  });
  it("keeps cookies secure unless explicitly relaxed outside production", () => {
    const base = { DATABASE_URL: "postgres://x" };
    expect(loadConfig(base, "1").secureCookie).toBe(true);
    expect(loadConfig({ ...base, COOKIE_SECURE: "0" }, "1").secureCookie).toBe(false);
    expect(
      loadConfig({ ...base, COOKIE_SECURE: "0", NODE_ENV: "production" }, "1").secureCookie,
    ).toBe(true);
  });
  it("falls back to the address the Render host reports", () => {
    const env = { DATABASE_URL: "x", RENDER_EXTERNAL_URL: "https://cc.onrender.com" };
    expect(loadConfig(env, "1").publicUrl).toBe("https://cc.onrender.com");
    expect(loadConfig({ ...env, PUBLIC_URL: "https://mine.test" }, "1").publicUrl).toBe(
      "https://mine.test",
    );
  });
  it("builds the public address without a trailing slash", () => {
    expect(loadConfig({ DATABASE_URL: "x", PUBLIC_URL: "https://a.b/" }, "1").publicUrl).toBe(
      "https://a.b",
    );
  });
});

describe("coach settings", () => {
  const base = { DATABASE_URL: "postgres://x" };
  it("has defaults and reads overrides", () => {
    const c = loadConfig(base, "1");
    expect(c.anthropicApiKey).toBeNull();
    expect(c.defaultMonthlyAllowance).toBe(200000);
    const d = loadConfig({ ...base, ANTHROPIC_API_KEY: "k", COACH_DEFAULT_ALLOWANCE: "50" }, "1");
    expect(d.anthropicApiKey).toBe("k");
    expect(d.defaultMonthlyAllowance).toBe(50);
  });
  it("rejects a bad allowance without echoing the key", () => {
    expect(() =>
      loadConfig({ ...base, ANTHROPIC_API_KEY: "sekrit", COACH_DEFAULT_ALLOWANCE: "-1" }, "1"),
    ).toThrow(/COACH_DEFAULT_ALLOWANCE/);
  });
  it("turns the test account on only when asked, with a dummy address by default", () => {
    const base = { DATABASE_URL: "postgres://x" };
    expect(loadConfig(base, "1").testAccount).toBeNull();
    expect(loadConfig({ ...base, TEST_ACCOUNT_PASSWORD: "test123456" }, "1").testAccount).toEqual({
      email: "test@chess-coach.org",
      password: "test123456",
    });
    expect(
      loadConfig(
        { ...base, TEST_ACCOUNT_PASSWORD: "test123456", TEST_ACCOUNT_EMAIL: " Qa@Chess-Coach.org" },
        "1",
      ).testAccount?.email,
    ).toBe("qa@chess-coach.org");
    expect(() => loadConfig({ ...base, TEST_ACCOUNT_PASSWORD: "short" }, "1")).toThrow(/10 to 200/);
    expect(() =>
      loadConfig({ ...base, TEST_ACCOUNT_PASSWORD: "test123456", TEST_ACCOUNT_EMAIL: "nope" }, "1"),
    ).toThrow(/TEST_ACCOUNT_EMAIL/);
  });
});
