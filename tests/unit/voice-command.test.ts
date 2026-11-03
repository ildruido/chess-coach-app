import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { confirmation, normalise, parseCommand } from "../../src/voice/command";

const start = () => new Chess();
const after = (...sans: string[]) => {
  const g = new Chess();
  for (const s of sans) g.move(s);
  return g;
};

describe("normalise", () => {
  it("turns spoken numbers and spaced squares into squares", () => {
    expect(normalise("Play E four!")).toBe("play e4");
    expect(normalise("knight to f 3")).toBe("knight to f3");
  });
});

describe("parseCommand: requests", () => {
  it.each(["hint", "Give me a hint", "can I have a hint please?", "help", "what should I play?"])(
    "%s is a hint",
    (t) => expect(parseCommand(t, start()).kind).toBe("hint"),
  );
  it.each(["review", "Review the game", "how did I do?"])("%s is a review", (t) =>
    expect(parseCommand(t, start()).kind).toBe("review"),
  );
  it("treats long sentences that mention hints or reviews as questions", () => {
    expect(
      parseCommand("any tips on how to handle my opening against this player?", start()).kind,
    ).toBe("question");
    expect(parseCommand("how did I play the opening and why was it risky?", start()).kind).toBe(
      "question",
    );
  });
  it("ignores blank input", () => {
    expect(parseCommand("  ", start())).toEqual({ kind: "empty" });
  });
  it.each(["why is my king unsafe?", "what if Nf3?", "what is a fork"])(
    "%s is a question for the coach",
    (t) => expect(parseCommand(t, start()).kind).toBe("question"),
  );
  it("keeps the question text as said", () => {
    expect(parseCommand("Why   did he take?", start())).toEqual({
      kind: "question",
      text: "Why did he take?",
    });
  });
});

describe("parseCommand: moves", () => {
  const san = (t: string, g = start()) => {
    const c = parseCommand(t, g);
    return c.kind === "move" ? c.san : c;
  };
  it.each([
    ["play e4", "e4"],
    ["e4", "e4"],
    ["Play E four", "e4"],
    ["pawn e4", "e4"],
    ["play knight f3", "Nf3"],
    ["knight to f3", "Nf3"],
    ["horse f3", "Nf3"],
    ["e2 to e4", "e4"],
    ["e2e4", "e4"],
    ["move g1 to f3", "Nf3"],
  ])("%s plays %s", (t, expected) => expect(san(t)).toBe(expected));

  it("reads captures", () => {
    const g = after("e4", "d5");
    expect(san("e takes d5", g)).toBe("exd5");
    expect(san("play pawn takes d5", g)).toBe("exd5");
    expect(san("e4 takes d5", g)).toBe("exd5");
  });

  it("reads castling", () => {
    const g = after("e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5");
    expect(san("castle", g)).toBe("O-O");
    expect(san("play castle kingside", g)).toBe("O-O");
    expect(parseCommand("castle queenside", g).kind).toBe("bad-move");
  });

  it("asks which piece when two can go there", () => {
    const g = after("Nf3", "Nf6", "d3", "d6");
    const c = parseCommand("knight d2", g);
    expect(c.kind).toBe("which");
  });

  it("uses a named file to tell two pieces apart", () => {
    const g = after("Nf3", "Nf6", "d3", "d6");
    expect(san("knight b d2", g)).toBe("Nbd2");
  });

  it("promotes to a queen unless told otherwise", () => {
    const g = new Chess("8/P6k/8/8/8/8/8/K7 w - - 0 1");
    expect(parseCommand("a8", g)).toMatchObject({ kind: "move", promotion: "q" });
    expect(parseCommand("play a8 promote to knight", g)).toMatchObject({
      kind: "move",
      promotion: "n",
    });
  });

  it("explains a move that can't be played", () => {
    expect(parseCommand("play e5", start()).kind).toBe("bad-move");
    expect(parseCommand("play something nice", start()).kind).toBe("bad-move");
  });
});

describe("confirmation", () => {
  it.each(["yes", "Yeah", "ok", "play it", "go ahead", "Confirm."])("%s is yes", (t) =>
    expect(confirmation(t)).toBe("yes"),
  );
  it.each(["no", "Cancel", "never mind", "no, don't"])("%s is no", (t) => {
    expect(confirmation(t)).toBe("no");
  });
  it("is null for anything else", () => {
    expect(confirmation("play e4")).toBeNull();
    expect(confirmation("why?")).toBeNull();
  });
});

describe("spoken promotion", () => {
  const g = new Chess("1n5k/P7/8/8/8/8/8/K7 w - - 0 1");
  it.each([
    "a7 to b8 promote to a knight",
    "axb8 promote to knight",
    "a7 to b8 and promote to the knight",
    "b8 equals knight",
  ])("%s promotes to a knight", (t) => {
    expect(parseCommand(t, g)).toMatchObject({ kind: "move", promotion: "n" });
  });
});
