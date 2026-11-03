import { existsSync } from "node:fs";

/** The server folder: one level above src/ when run from source, two above dist/src/ when built. */
export function serverRoot(): URL {
  const fromSource = new URL("../", import.meta.url);
  return existsSync(new URL("package.json", fromSource)) &&
    existsSync(new URL("migrations/", fromSource))
    ? fromSource
    : new URL("../../", import.meta.url);
}
