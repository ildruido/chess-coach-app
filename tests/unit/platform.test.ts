import { afterEach, describe, expect, it } from "vitest";
import { fakeRuntimePlatform as fake } from "../../src/platform/e2e";
import { getPlatform, setPlatform, unavailablePlatform } from "../../src/platform";

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  setPlatform(fake);
});

function fakeWindow(claude?: unknown) {
  (globalThis as { window?: unknown }).window = { claude };
}

describe("fake runtime platform (e2e build)", () => {
  it("reports nothing available without the Claude runtime", async () => {
    fakeWindow();
    expect(fake.hasRuntime()).toBe(false);
    expect(await fake.sample()).toBeNull();
    expect(await fake.db()).toBeNull();
    expect(await fake.user()).toBeNull();
    expect(await fake.downloads()).toBeNull();
  });

  it("offers browser speech out but no microphone", () => {
    fakeWindow();
    expect(fake.voice().dictation()).toBeNull();
    expect(fake.voice().speechOut()).toBeNull();
  });

  it("passes each capability through from window.claude", async () => {
    const caps: Record<string, unknown> = {
      sample: async (prompt: string) => ({
        text: prompt,
        truncated: false,
        modelTierApplied: "quick",
      }),
      db: { doc: () => 2 },
      user: { id: async () => "u1" },
      downloads: { save: async () => ({ status: "saved" }) },
    };
    fakeWindow({ use: async (name: string) => caps[name] ?? null });
    expect(fake.hasRuntime()).toBe(true);
    // The fake coach is handed the prompt text the server would build from the call.
    const sample = (await fake.sample())!;
    const call = {
      purpose: "hint" as const,
      position: { moves: [] },
      analysis: { bestMove: "e2e4", depth: 10, pv: ["e2e4"], ms: 1 },
      stage: "plan" as const,
    };
    expect((await sample(call)).text).toContain("Engine facts");
    expect(await fake.db()).toBe(caps.db);
    expect(await fake.user()).toBe(caps.user);
    expect(await fake.downloads()).toBe(caps.downloads);
  });

  it("can be swapped", () => {
    const other = { ...fake, hasRuntime: () => true };
    setPlatform(other);
    expect(getPlatform()).toBe(other);
  });
});

describe("unavailable platform", () => {
  it("is the default and offers nothing", async () => {
    setPlatform(unavailablePlatform);
    const p = getPlatform();
    expect(p.hasRuntime()).toBe(false);
    expect(await p.sample()).toBeNull();
    expect(await p.db()).toBeNull();
    expect(await p.user()).toBeNull();
    expect(await p.downloads()).toBeNull();
    expect(p.voice().dictation()).toBeNull();
  });
});
