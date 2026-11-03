// The one place the page asks "where am I running?". The web app sets its platform at startup
// (main.ts); until then, and in unit tests, nothing is available and the page copes.
import type { Platform } from "./types";

export type { Platform } from "./types";

/** No capabilities at all: every getter resolves null. */
export const unavailablePlatform: Platform = {
  hasRuntime: () => false,
  sample: async () => null,
  db: async () => null,
  user: async () => null,
  downloads: async () => null,
  voice: () => ({ speechOut: () => null, dictation: () => null }),
};

let current: Platform = unavailablePlatform;

export function getPlatform(): Platform {
  return current;
}

/** Swap the platform (web startup, tests). */
export function setPlatform(platform: Platform): void {
  current = platform;
}
