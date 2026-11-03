import { describe, expect, it, vi } from "vitest";
import { COACH_TIER, createUsageGuard, isUsageLimit } from "../../src/coach/usage";

describe("coach tiers", () => {
  it("keeps hints, comments and lesson answers on the quick tier and reviews on the default one", () => {
    expect(COACH_TIER).toEqual({
      hint: "quick",
      comment: "quick",
      lesson: "quick",
      review: "default",
    });
  });
});

describe("isUsageLimit", () => {
  it("is true only for a rate limit", () => {
    expect(isUsageLimit("rate_limited")).toBe(true);
    for (const code of ["refused", "cancelled", "session_expired", "not_granted", undefined]) {
      expect(isUsageLimit(code)).toBe(false);
    }
  });
});

describe("usage guard", () => {
  it("starts unpaused and tells subscribers about each change once", () => {
    const g = createUsageGuard();
    const fn = vi.fn();
    g.subscribe(fn);
    expect(g.paused).toBe(false);
    g.pause();
    g.pause();
    expect(g.paused).toBe(true);
    g.resume();
    expect(g.paused).toBe(false);
    expect(fn.mock.calls).toEqual([[true], [false]]);
  });

  it("stops telling a subscriber that unsubscribed", () => {
    const g = createUsageGuard();
    const fn = vi.fn();
    const stop = g.subscribe(fn);
    stop();
    g.pause();
    expect(fn).not.toHaveBeenCalled();
  });
});
