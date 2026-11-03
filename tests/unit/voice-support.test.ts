import { describe, expect, it } from "vitest";
import { isSafariLike, supportNote } from "../../src/voice/support";

describe("voice support note", () => {
  it("says what works in each case", () => {
    expect(supportNote({ listen: true, read: true }, false)).toContain("speak to the coach");
    expect(supportNote({ listen: true, read: true }, true)).toContain("less reliable");
    expect(supportNote({ listen: false, read: true }, false)).toContain("can't listen");
    expect(supportNote({ listen: true, read: false }, false)).toContain("no voice to read");
    expect(supportNote({ listen: false, read: false }, false)).toContain("isn't available");
  });

  it("spots Safari and iPhone but not Chrome", () => {
    const iphone =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit Version/17.0 Mobile Safari/604.1";
    const iphoneChrome = "Mozilla/5.0 (iPhone) AppleWebKit CriOS/120 Mobile Safari/604.1";
    const mac = "Mozilla/5.0 (Macintosh) AppleWebKit Version/17.0 Safari/605.1.15";
    const chrome = "Mozilla/5.0 (X11; Linux) AppleWebKit Chrome/120 Safari/537.36";
    const android = "Mozilla/5.0 (Linux; Android 14) AppleWebKit Chrome/120 Mobile Safari/537.36";
    expect([iphone, iphoneChrome, mac].map(isSafariLike)).toEqual([true, true, true]);
    expect([chrome, android].map(isSafariLike)).toEqual([false, false]);
  });
});
