import { CALL_POLICY, renderCall } from "../coach/call";
import { browserSpeechOut } from "./browser-voice";
import type { Platform } from "./types";

/**
 * The e2e test build's platform: whatever fake `window.claude` a spec installs, read lazily so
 * a spec can set it late. Only the `--mode e2e` build and unit tests use it; no release build does.
 */
export const fakeRuntimePlatform: Platform = {
  hasRuntime: () => Boolean(window.claude),
  // The specs' fake coach takes prompt text, so it is given the very prompt the server would build.
  sample: async () => {
    const fake = window.claude ? await window.claude.use("sample") : null;
    if (!fake) return null;
    return ((call, options) =>
      (fake as unknown as (prompt: string, o?: SampleOptions) => Promise<SampleResult>)(
        renderCall(call),
        // What the server would pick for this call, so specs can still check the tier.
        {
          ...options,
          modelTier: CALL_POLICY[call.purpose].tier,
          maxTokens: CALL_POLICY[call.purpose].maxTokens,
        } as SampleOptions,
      )) as SampleFn;
  },
  db: async () => (window.claude ? window.claude.use("db") : null),
  user: async () => (window.claude ? window.claude.use("user") : null),
  downloads: async () => (window.claude ? window.claude.use("downloads") : null),
  // The specs drive typed voice; the real microphone is tested against the web build.
  voice: () => ({ speechOut: browserSpeechOut, dictation: () => null }),
};
