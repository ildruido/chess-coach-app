// Keeps the coach inside the player's monthly allowance (CC-016). No DOM, so it is unit tested.
// Routine coaching uses the quick tier; only the post-game review uses the default one.
// When the server says the allowance is used up (rate_limited), the coach pauses for the whole page:
// no more calls until the player asks to try again (never on a timer).

export const COACH_TIER = {
  hint: "quick",
  comment: "quick",
  lesson: "quick",
  review: "default",
} as const satisfies Record<string, "quick" | "default" | "complex">;

/** True for the sample error that means the allowance is used up or too many calls at once. */
export function isUsageLimit(code: string | undefined): boolean {
  return code === "rate_limited";
}

export interface UsageGuard {
  /** True after a usage limit, until the player tries the coach again. */
  readonly paused: boolean;
  pause(): void;
  resume(): void;
  /** Calls `fn` on every change; returns a function that stops it. */
  subscribe(fn: (paused: boolean) => void): () => void;
}

export function createUsageGuard(): UsageGuard {
  let paused = false;
  const fns = new Set<(paused: boolean) => void>();
  const set = (next: boolean) => {
    if (next === paused) return;
    paused = next;
    for (const fn of [...fns]) fn(paused);
  };
  return {
    get paused() {
      return paused;
    },
    pause: () => set(true),
    resume: () => set(false),
    subscribe(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
  };
}

/** The page's one guard; in memory only, so a reload lets the coach try again. */
export const usageGuard = createUsageGuard();
