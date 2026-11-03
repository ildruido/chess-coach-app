import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script, no types
import { build } from "../../scripts/sync-shared.mjs";

describe("server/src/shared", () => {
  it("is the current copy of the page's pure coach code (run `npm run sync:shared`)", () => {
    const files = build() as Map<string, string>;
    expect(files.size).toBeGreaterThan(5);
    for (const [rel, text] of files) {
      const have = readFileSync(resolve(__dirname, "../../server/src/shared", rel), "utf8");
      expect(have, `${rel} is stale`).toBe(text);
    }
  });
});
