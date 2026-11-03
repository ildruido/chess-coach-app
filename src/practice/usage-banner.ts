// The page-wide note shown while the coach is paused by a usage limit (CC-016).
// "Try the coach again" only lifts the pause: the next click that needs the coach
// is the try, so no call is spent on checking.
import { usageGuard } from "../coach/usage";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function mountUsageBanner() {
  const banner = $<HTMLDivElement>("coach-paused");
  const resume = $<HTMLButtonElement>("coach-resume");
  // Always in the page, so screen readers announce the pause when its text arrives.
  const live = $<HTMLParagraphElement>("coach-paused-live");
  const sync = (paused: boolean) => {
    banner.hidden = !paused;
    live.textContent = paused ? "Usage limit reached: the coach is paused." : "";
  };
  resume.addEventListener("click", () => {
    usageGuard.resume();
    // The button just hid itself: keep keyboard focus near the coach.
    const hint = $<HTMLButtonElement>("hint-next");
    if (hint.offsetParent && !hint.disabled) hint.focus();
    else $<HTMLElement>("page-title").focus();
  });
  usageGuard.subscribe(sync);
  sync(usageGuard.paused);
}
