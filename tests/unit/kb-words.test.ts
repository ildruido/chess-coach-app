import { describe, expect, it } from "vitest";
import { contentWords, hardFacts, similarity } from "../../src/kb/words";

describe("normalising questions", () => {
  it("maps chess synonyms and keeps squares, moves and pieces as hard facts", () => {
    expect(hardFacts("Why can't I take the horse?")).toEqual(["not", "knight"]);
    expect(hardFacts("why not capture the knight")).toEqual(["not", "knight"]);
    expect(hardFacts("What if nxf7+?")).toEqual(hardFacts("What if Nxf7"));
    expect(hardFacts("What if bxc4?")).not.toEqual(hardFacts("What if Bxc4?"));
    expect(hardFacts("Is the pawn on e5 weak?")).toEqual(["pawn", "e5"]);
    expect(hardFacts("Why can't I push my f pawn?")).toEqual(["not", "my", "f-pawn"]);
    expect(contentWords("Why can't I take the horse?")).toEqual(["why", "capture"]);
    expect(contentWords("The forking knight forks")).toEqual(["fork"]);
  });
});

describe("similarity", () => {
  it("finds the same question in other words", () => {
    expect(similarity("Why can't I take the horse?", "why not capture the knight")).toBe(1);
    expect(similarity("What is a pin?", "what's a pin")).toBeGreaterThan(0);
  });

  it("never matches a different square, piece or move", () => {
    expect(similarity("Why not Bxf7?", "Why not Bxe6?")).toBe(0);
    expect(similarity("What if d5?", "What if e5?")).toBe(0);
    expect(similarity("Why is the knight free?", "Why is the bishop free?")).toBe(0);
    expect(similarity("Why is the knight free?", "Why is it free?")).toBe(0);
  });

  it.each([
    ["Why can't my knight take the bishop?", "Why can't the bishop take my knight?"],
    ["Why not capture with the queen?", "Why not capture the queen?"],
    ["Why is my knight hanging?", "Why is your knight hanging?"],
    ["Why should I take the knight?", "Why shouldn't I take the knight?"],
    ["Why can't I push my f-pawn forward now?", "Why can't I push my g-pawn forward now?"],
    ["Why can't I push the f pawn?", "Why can't I push the g pawn?"],
    ["Is the white bishop strong?", "Is the black bishop strong?"],
    ["Is the light-squared bishop bad?", "Is the dark-squared bishop bad?"],
    ["Should I castle kingside?", "Should I castle queenside?"],
  ])("never matches %s with %s", (a, b) => {
    expect(similarity(a, b)).toBe(0);
  });

  it("with nothing but hard facts, only the same wording counts", () => {
    expect(similarity("Nxf7?", "nxf7")).toBe(1);
    expect(similarity("Nxf7?", "Nxf7 now?")).toBe(0);
  });
});
