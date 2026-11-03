import { describe, expect, it } from "vitest";
import { gameAt } from "../../src/chess/notation";
import {
  describeMaterial,
  lineOutcome,
  materialBalance,
  moveFacts,
  positionFacts,
} from "../../src/coach/move-facts";

const italian = gameAt({ moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"] });
const trap = gameAt({
  moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "c6d4", "f3e5", "d8g5"],
});

describe("moveFacts", () => {
  it("says Nf6 attacks e4, and does not claim it defends e5", () => {
    const facts = moveFacts(italian, "Nf6");
    expect(facts[0]).toBe("Nf6 moves Black's knight from g8 to f6.");
    expect(facts.join(" ")).toContain("attacks White's pawn on e4");
    expect(facts.join(" ")).not.toMatch(/defends[^.]*e5/);
  });

  it("reports a capture with check, and the material it changes", () => {
    const facts = moveFacts(trap, "Bxf7+").join(" ");
    expect(facts).toContain("It captures a pawn.");
    expect(facts).toContain("It gives check.");
    expect(facts).toContain("Material before: White is ahead by 1 point of material.");
    expect(facts).toContain("Material after: White is ahead by 2 points of material.");
  });

  it("names castling", () => {
    const game = gameAt({ moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6"] });
    expect(moveFacts(game, "O-O")[0]).toBe("O-O castles kingside.");
  });

  it("warns when the moved piece can be captured", () => {
    expect(moveFacts(trap, "Bxf7+").join(" ")).toContain("On f7 the moved piece can be captured.");
  });
});

describe("material", () => {
  it("counts from White's view", () => {
    expect(materialBalance(gameAt({}))).toBe(0);
    expect(describeMaterial(0)).toBe("material is level");
    expect(describeMaterial(-3)).toBe("Black is ahead by 3 points of material");
  });

  it("states the outcome of the engine's line", () => {
    expect(lineOutcome(trap, ["Bxf7+", "Kd8"])).toBe(
      "After the engine's line (2 moves), White is ahead by 2 points of material.",
    );
  });
});

describe("positionFacts", () => {
  it("lists undefended pieces under attack (the trap position)", () => {
    expect(positionFacts(trap)).toEqual([
      "White's knight on e5 is attacked by Black's queen on g5 and is not defended.",
      "White's pawn on g2 is attacked by Black's queen on g5 and is not defended.",
    ]);
  });

  it("lists nothing in a quiet position", () => {
    expect(positionFacts(italian)).toEqual([]);
  });

  it("lists a check and a piece attacked by a cheaper one, but not a king hitting a defended piece", () => {
    const g = gameAt({ moves: ["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6", "h5f7"] });
    expect(positionFacts(g)).toEqual([
      "Black's king is in check.",
      "White's pawn on e4 is attacked by Black's knight on f6 and is not defended.",
    ]);
    const cheaper = gameAt({ moves: ["e2e4", "e7e5", "b1c3", "g8f6", "f1b5", "a7a6"] });
    expect(positionFacts(cheaper)).toContain(
      "White's bishop on b5 is attacked by Black's pawn on a6 (a cheaper piece).",
    );
  });
});
