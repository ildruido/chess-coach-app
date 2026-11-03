import { describe, expect, it } from "vitest";
import { parseLessonCommand } from "../../src/lessons/voice-command";

const START = { fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" };

describe("parseLessonCommand: lesson requests", () => {
  it.each(["next", "Next step", "continue", "go on", "next move please", "Next exercise"])(
    "%s goes on",
    (t) => expect(parseLessonCommand(t, null).kind).toBe("next"),
  );
  it.each(["repeat", "repeat that", "read it again", "say that again", "what does it say"])(
    "%s reads the step again",
    (t) => expect(parseLessonCommand(t, null).kind).toBe("repeat"),
  );
  it.each(["try again", "retry", "Let me try again"])("%s tries the exercise again", (t) =>
    expect(parseLessonCommand(t, START).kind).toBe("retry"),
  );
  it.each(["hint", "give me a hint", "what should I play?"])("%s is a hint", (t) =>
    expect(parseLessonCommand(t, START).kind).toBe("hint"),
  );
  it.each(["leave lesson", "leave", "exit the lesson", "quit lesson", "back to lessons"])(
    "%s leaves the lesson",
    (t) => expect(parseLessonCommand(t, null).kind).toBe("leave"),
  );
  it.each(["back", "go back", "previous step"])("%s goes back", (t) =>
    expect(parseLessonCommand(t, null).kind).toBe("back"),
  );
  it.each(["skip", "skip this exercise"])("%s skips", (t) =>
    expect(parseLessonCommand(t, START).kind).toBe("skip"),
  );
  it("nothing said is empty", () => expect(parseLessonCommand("  ", null).kind).toBe("empty"));
});

describe("parseLessonCommand: moves", () => {
  it("reads a move where one can be made", () => {
    expect(parseLessonCommand("play knight f3", START)).toMatchObject({
      kind: "move",
      san: "Nf3",
      from: "g1",
      to: "f3",
    });
  });
  it("asks which when several moves fit", () => {
    expect(parseLessonCommand("knight to d2", START).kind).not.toBe("which");
    const g = { fen: "4k3/8/8/8/8/8/8/N1N1K3 w - - 0 1" };
    expect(parseLessonCommand("knight to b3", g).kind).toBe("which");
  });
  it.each(["play e4", "e2 to e4", "castle kingside"])(
    "%s is 'no move here' when no move can be made",
    (t) => expect(parseLessonCommand(t, null).kind).toBe("no-move"),
  );
  it("a question about a move is still a question without a position", () => {
    expect(parseLessonCommand("what if Nf3?", null)).toEqual({
      kind: "question",
      text: "what if Nf3?",
    });
  });
  it("a review request is a question for the coach, not a Practice command", () => {
    expect(parseLessonCommand("how did I do?", null).kind).toBe("question");
  });
  it("any other sentence is a question", () => {
    expect(parseLessonCommand("why is the knight free", START)).toEqual({
      kind: "question",
      text: "why is the knight free",
    });
  });
});
