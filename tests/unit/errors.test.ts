import { describe, expect, it } from "vitest";
import { describeError } from "../../src/coach/errors";

describe("describeError", () => {
  it("says the player is offline without turning the coach off", () => {
    const advice = describeError("offline");
    expect(advice.message).toMatch(/offline/i);
    expect(advice.disable).toBe(false);
  });

  it("turns the coach off when consent is declined", () => {
    expect(describeError("not_granted").disable).toBe(true);
  });

  it("keeps the coach on for a usage limit", () => {
    const advice = describeError("rate_limited");
    expect(advice.disable).toBe(false);
    expect(advice.message).toMatch(/usage limit/);
  });

  it("falls back to a retry message for unknown codes", () => {
    expect(describeError("something_new")).toEqual(describeError(undefined));
    expect(describeError(undefined).disable).toBe(false);
  });
});
