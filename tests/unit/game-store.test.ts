import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DbGameStore,
  currentGamePath,
  isTerminalStoreError,
  loadErrorText,
  openGameStore,
  saveErrorText,
} from "../../src/storage/game-store";
import { setPlatform, unavailablePlatform } from "../../src/platform";
import { fakeRuntimePlatform } from "../../src/platform/e2e";
import { newSavedGame, withMoves } from "../../src/storage/saved-game";
import { fakeDb } from "./fixtures/fake-db";

const game = withMoves(
  newSavedGame(new Date("2026-10-04T19:00:00Z")),
  ["e2e4", "e7e5"],
  new Date("2026-10-04T19:05:00Z"),
);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Runs a store call with fake timers so the retry delay doesn't slow the tests. */
async function fast<T>(call: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  const p = call();
  p.catch(() => undefined);
  await vi.runAllTimersAsync();
  return p;
}

describe("DbGameStore", () => {
  it("saves into the viewer's private area and loads it back", async () => {
    const { db, docs } = fakeDb();
    const store = new DbGameStore(db, "u_123");
    await store.save(game);
    expect([...docs.keys()]).toEqual(["data/users/u_123/current-game"]);
    expect(await store.load()).toEqual({ status: "ok", game });
  });

  it("tells 'nothing saved' apart from 'saved but unreadable'", async () => {
    const { db, docs } = fakeDb();
    const store = new DbGameStore(db, "u_123");
    expect(await store.load()).toEqual({ status: "none" });
    docs.set(currentGamePath("u_123"), { version: 2, moves: [] });
    expect(await store.load()).toEqual({ status: "unreadable" });
  });

  it("retries once on a transient or unknown error", async () => {
    const { db, failNext } = fakeDb();
    const store = new DbGameStore(db, "u_123");
    failNext.push("unavailable");
    await expect(fast(() => store.save(game))).resolves.toBeUndefined();
    failNext.push("something_new");
    await expect(fast(() => store.save(game))).resolves.toBeUndefined();
    failNext.push("unavailable", "unavailable");
    await expect(fast(() => store.save(game))).rejects.toMatchObject({ code: "unavailable" });
  });

  it("never retries a known permanent error", async () => {
    const { db, failNext } = fakeDb();
    const store = new DbGameStore(db, "u_123");
    failNext.push("quota_exceeded");
    await expect(store.save(game)).rejects.toMatchObject({ code: "quota_exceeded" });
    expect(failNext).toEqual([]);
  });
});

describe("openGameStore", () => {
  beforeEach(() => setPlatform(fakeRuntimePlatform));
  afterEach(() => setPlatform(unavailablePlatform));

  it("is off without a runtime", async () => {
    vi.stubGlobal("window", {});
    expect(await openGameStore()).toEqual({ ok: false, reason: "no-runtime" });
  });

  it("is off without storage or without an identity", async () => {
    vi.stubGlobal("window", { claude: { use: async () => null } });
    expect(await openGameStore()).toEqual({ ok: false, reason: "no-db" });
    const { db } = fakeDb();
    vi.stubGlobal("window", {
      claude: { use: async (n: string) => (n === "db" ? db : { id: async () => null }) },
    });
    expect(await openGameStore()).toEqual({ ok: false, reason: "no-identity" });
  });

  it("opens the viewer's store when both are available", async () => {
    const { db } = fakeDb();
    vi.stubGlobal("window", {
      claude: { use: async (n: string) => (n === "db" ? db : { id: async () => "u_9" }) },
    });
    expect((await openGameStore()).ok).toBe(true);
  });
});

describe("error handling", () => {
  it("switches saving off only for permanent errors", () => {
    expect(isTerminalStoreError({ code: "revoked" })).toBe(true);
    expect(isTerminalStoreError({ code: "quota_exceeded" })).toBe(true);
    expect(isTerminalStoreError({ code: "unavailable" })).toBe(false);
    expect(isTerminalStoreError({ code: "resource_exhausted" })).toBe(false);
  });

  it("explains each failure honestly", () => {
    expect(saveErrorText({ code: "not_granted" })).toMatch(/declined storage/);
    expect(saveErrorText({ code: "quota_exceeded" })).toBe(
      "Saving is off: this page's storage is full.",
    );
    expect(saveErrorText({ code: "weird" })).toMatch(/will try again/);
    expect(loadErrorText({ code: "unavailable" })).toMatch(
      /Saving is paused so it isn't overwritten/,
    );
  });
});
