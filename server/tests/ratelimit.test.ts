import { describe, expect, it } from "vitest";
import { FailureLimiter } from "../src/ratelimit.js";

describe("FailureLimiter", () => {
  it("blocks after max failures and frees the key when the window ends", () => {
    let t = 0;
    const l = new FailureLimiter(2, 1000, () => t);
    l.fail("a");
    expect(l.blocked("a")).toBe(false);
    l.fail("a");
    expect(l.blocked("a")).toBe(true);
    expect(l.blocked("b")).toBe(false);
    t = 1000;
    expect(l.blocked("a")).toBe(false);
  });
  it("clear forgets the failures", () => {
    const l = new FailureLimiter(1, 1000);
    l.fail("a");
    l.clear("a");
    expect(l.blocked("a")).toBe(false);
  });
});
