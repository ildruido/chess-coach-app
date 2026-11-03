import { beforeEach, describe, expect, it, vi } from "vitest";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => void (data[k] = v),
  });
  return data;
}

describe("coach diagnostics switch", () => {
  beforeEach(() => vi.resetModules());

  it("is off by default and when storage is unavailable", async () => {
    fakeStorage();
    expect((await import("../../src/diagnostics")).diagnosticsOn()).toBe(false);
    vi.resetModules();
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect((await import("../../src/diagnostics")).diagnosticsOn()).toBe(false);
  });

  it("starts on when it was left on, and tells listeners when it changes", async () => {
    const data = fakeStorage({ "chess-coach.diagnostics": "1" });
    const d = await import("../../src/diagnostics");
    expect(d.diagnosticsOn()).toBe(true);
    const heard = vi.fn();
    d.onDiagnostics(heard);
    d.setDiagnostics(false);
    expect(d.diagnosticsOn()).toBe(false);
    expect(data["chess-coach.diagnostics"]).toBe("0");
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
