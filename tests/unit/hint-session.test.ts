import { describe, expect, it } from "vitest";
import type { HintStage } from "../../src/coach/hint";
import { buttonLabel, hintOptions, stepTitle } from "../../src/coach/hint-session";

describe("hintOptions", () => {
  it("tell mode gives plan, then piece, then move, then nothing", () => {
    const given: HintStage[] = [];
    const order: (HintStage | null)[] = [];
    for (let i = 0; i < 4; i++) {
      const { primary, another } = hintOptions(given, "tell");
      expect(another).toBe(false);
      order.push(primary);
      if (primary) given.push(primary);
    }
    expect(order).toEqual(["plan", "piece", "move", null]);
  });

  it("ask mode asks one question, offers a second, then the tell steps", () => {
    expect(hintOptions([], "ask")).toEqual({ primary: "question", another: false });
    expect(hintOptions(["question"], "ask")).toEqual({ primary: "plan", another: true });
    expect(hintOptions(["question", "question"], "ask")).toEqual({
      primary: "plan",
      another: false,
    });
    expect(hintOptions(["question", "plan", "piece"], "ask")).toEqual({
      primary: "move",
      another: false,
    });
    expect(hintOptions(["question", "plan", "piece", "move"], "ask")).toEqual({
      primary: null,
      another: false,
    });
  });

  it("switching modes mid-way carries on from what was given", () => {
    // Tell first, then switch to ask: no question once the plan is out.
    expect(hintOptions(["plan"], "ask")).toEqual({ primary: "piece", another: false });
    // Ask first, then switch to tell: no second question on offer.
    expect(hintOptions(["question"], "tell")).toEqual({ primary: "plan", another: false });
  });
});

describe("labels", () => {
  it("names each step for the player", () => {
    expect(buttonLabel("question")).toBe("Hint: ask me a question");
    expect(buttonLabel("piece")).toBe("Hint: which piece");
    expect(buttonLabel(null)).toBe("No more hints this move");
    expect(stepTitle("question", ["question"])).toBe("Question");
    expect(stepTitle("question", ["question", "question"])).toBe("Another question");
    expect(stepTitle("move", ["plan", "piece", "move"])).toBe("The move");
  });
});
