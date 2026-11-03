import { describe, expect, it } from "vitest";
import { sourceUrl } from "../../src/about/source-link";

describe("sourceUrl", () => {
  it("points at the public repo at the version's tag", () => {
    expect(sourceUrl("0.25.2")).toBe("https://github.com/ildruido/chess-coach-app/tree/v0.25.2");
  });
});
