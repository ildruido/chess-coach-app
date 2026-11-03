import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { normalise, parseCommand } from "../../src/voice/command";
import { pickChoice } from "../../src/voice/phrasing";

const after = (...sans: string[]) => {
  const g = new Chess();
  for (const s of sans) g.move(s);
  return g;
};
const san = (t: string, g: Chess) => {
  const c = parseCommand(t, g);
  return c.kind === "move" ? c.san : c;
};

describe("everyday move wording", () => {
  const g = after("e4", "d5", "Nf3", "Nf6", "Bc4", "e6");
  it("picks a piece by side", () => {
    expect(san("the left bishop to b5", g)).toBe("Bb5+");
    expect(san("play the right knight to g5", g)).toBe("Ng5");
    expect(san("my right bishop to e2", g)).toBe("Be2");
  });
  it("reads captures by piece type", () => {
    expect(san("pawn takes the pawn", g)).toBe("exd5");
    expect(san("take the pawn with my pawn", g)).toBe("exd5");
    expect(san("bishop takes the pawn", after("e4", "d5", "Bc4", "e6"))).toBe("Bxd5");
  });
  it("reads pawn steps and wing names", () => {
    expect(san("queen's pawn two squares", g)).toBe("d4");
    expect(san("king's knight to f3", after("e4", "e5"))).toBe("Nf3");
    expect(san("the left pawn one square", new Chess())).toBe("a3");
    expect(san("the right pawn two squares", new Chess())).toBe("h4");
  });
  it("flips left and right for Black", () => {
    const b = after("e4");
    expect(san("the left pawn two squares", b)).toBe("h5");
    expect(san("the right pawn two squares", b)).toBe("a5");
  });
  it("leaves questions alone", () => {
    for (const t of [
      "why did the knight take the pawn",
      "what if the bishop takes e5",
      "should I take the pawn?",
    ]) {
      expect(parseCommand(t, g).kind).toBe("question");
    }
  });
});

describe("sentences that are not moves", () => {
  it.each(["the knight on f3 is strong", "the pawn on e4 is good", "bishop takes is a bad idea"])(
    "%s goes to the coach",
    (t) => expect(parseCommand(t, new Chess()).kind).toBe("question"),
  );
  it("reads a from-square", () => {
    expect(san("the bishop on f1 to c4", after("e4", "e5"))).toBe("Bc4");
  });
});

describe("asking which one", () => {
  const g = after("Nf3", "Nf6", "d3", "d6");
  it("asks when two pieces fit, left to right", () => {
    const c = parseCommand("knight d2", g);
    expect(c).toMatchObject({
      kind: "which",
      question: "Which knight: the one on b1 or the one on f3?",
    });
  });
  it("asks for the piece when the sentence is vague", () => {
    const c = parseCommand("a knight to d2", g);
    expect(c.kind).toBe("which");
  });
  it("resolves the answer", () => {
    const c = parseCommand("knight d2", g);
    if (c.kind !== "which") throw new Error("expected which");
    expect(pickChoice("the left one", c.choices)?.from).toBe("b1");
    expect(pickChoice("right", c.choices)?.from).toBe("f3");
    expect(pickChoice("the one on f3", c.choices)?.san).toBe("Nfd2");
    expect(pickChoice("second", c.choices)?.from).toBe("f3");
    expect(pickChoice("b", c.choices)?.from).toBe("b1");
    expect(pickChoice("what is a fork", c.choices)).toBeNull();
    expect(pickChoice(normalise("The left one."), c.choices)?.from).toBe("b1");
    expect(pickChoice(normalise("the one on f3"), c.choices)?.from).toBe("f3");
    expect(pickChoice("is that right", c.choices)).toBeNull();
    expect(pickChoice("why not the knight on g1", c.choices)).toBeNull();
    expect(pickChoice("what was the first move", c.choices)).toBeNull();
  });
});
