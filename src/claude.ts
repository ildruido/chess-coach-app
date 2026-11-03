import { getPlatform } from "./platform";

// One shared handle on the platform's `sample` capability (asking Claude).
// Resolves null where the capability is unavailable.

let samplePromise: Promise<SampleFn | null> | null = null;

export function getSample(): Promise<SampleFn | null> {
  samplePromise ??= getPlatform().sample();
  return samplePromise;
}
