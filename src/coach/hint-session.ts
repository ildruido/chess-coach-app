// Which hint comes next on the player's turn, in tell or ask mode.
// Tell: plan, then piece, then move, each on request. Ask: one guiding
// question, a second only if the player asks for another, then the tell steps.
// Pure functions, unit tested.
import type { HintStage } from "./hint";

export type HintMode = "tell" | "ask";

const TELL_STEPS: readonly HintStage[] = ["plan", "piece", "move"];

export interface HintOptions {
  /** The step the Hint button gives next; null when the move has been given. */
  primary: HintStage | null;
  /** True when "Another question" is on offer: ask mode, after one question, before the plan. */
  another: boolean;
}

export function hintOptions(given: readonly HintStage[], mode: HintMode): HintOptions {
  const tellNext = TELL_STEPS.find((s) => !given.includes(s)) ?? null;
  const questions = given.filter((s) => s === "question").length;
  if (mode === "ask" && questions === 0 && tellNext === "plan") {
    return { primary: "question", another: false };
  }
  return { primary: tellNext, another: mode === "ask" && questions === 1 && tellNext === "plan" };
}

/** Text on the Hint button for the step it gives. */
export function buttonLabel(step: HintStage | null): string {
  switch (step) {
    case "question":
      return "Hint: ask me a question";
    case "plan":
      return "Hint: the plan";
    case "piece":
      return "Hint: which piece";
    case "move":
      return "Hint: the move";
    case null:
      return "No more hints this move";
  }
}

/** Heading of a hint in the list shown to the player. */
export function stepTitle(step: HintStage, given: readonly HintStage[]): string {
  if (step === "question") {
    return given.filter((s) => s === "question").length > 1 ? "Another question" : "Question";
  }
  return { plan: "The plan", piece: "The piece", move: "The move" }[step];
}
