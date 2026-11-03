import { describe, expect, it } from "vitest";
import { chunks, sentences, speakable } from "../../src/voice/speakable";

describe("speakable", () => {
  it.each([
    ["Nf3", "knight f3"],
    ["Bxe5+", "bishop takes e5, check"],
    ["Nbd7", "knight b d7"],
    ["R1xe7#", "rook 1 takes e7, checkmate"],
    ["O-O", "castles kingside"],
    ["O-O-O+", "castles queenside, check"],
    ["0-0", "castles kingside"],
    ["e4", "e4"],
    ["exd5", "e takes d5"],
    ["e8=Q", "e8 promotes to queen"],
    ["bxa1=N+", "b takes a1 promotes to knight, check"],
  ])("reads %s as %s", (san, words) => {
    expect(speakable(san)).toBe(words);
  });

  it("reads moves inside sentences, with move numbers", () => {
    expect(speakable("After 12. Nf3 Black plays 12... Qd8, and Bxf7+ wins.")).toBe(
      "After move 12, knight f3 Black plays move 12 for Black, queen d8, and bishop takes f7, check, wins.",
    );
  });

  it("leaves ordinary words alone", () => {
    expect(speakable("Bring a knight to the centre. A plan is key.")).toBe(
      "Bring a knight to the centre. A plan is key.",
    );
    expect(speakable("Next-door B4 isn't a move: NB.")).toBe("Next-door B4 isn't a move: NB.");
  });

  it.each([
    "It loses 2. But you can still fight.",
    "You are up 3. Now trade.",
    "Step 1. Bring the knight out.",
    "Count to 3. a pawn hangs.",
    "Wait 3... and see.",
  ])("leaves a number ending a sentence alone: %s", (text) => {
    expect(speakable(text)).toBe(text);
  });

  it("doesn't say move twice", () => {
    expect(speakable("Move 20... Nf6 was best.")).toBe("Move 20 for Black, knight f6 was best.");
  });

  it("drops emoji and reads arrows as words", () => {
    expect(speakable("Good move 👍 e2→e4")).toBe("Good move e2 to e4");
  });
});

describe("sentences", () => {
  it("splits on sentence ends and keeps the last fragment", () => {
    expect(sentences("One. Two! Three? Four")).toEqual(["One.", "Two!", "Three?", "Four"]);
  });
  it("keeps abbreviations and decimals inside one sentence", () => {
    expect(sentences("e.g. Nf3 develops. It is worth 1.5 pawns.")).toEqual([
      "e.g. Nf3 develops.",
      "It is worth 1.5 pawns.",
    ]);
  });
  it("returns nothing for blank text", () => {
    expect(sentences("  ")).toEqual([]);
  });
});

describe("chunks", () => {
  it("keeps short sentences whole", () => {
    expect(chunks("One. Two!")).toEqual(["One.", "Two!"]);
  });
  it("cuts a long sentence at commas, each piece within the limit", () => {
    const long =
      "Develop your knight, castle early, keep the centre under control, and watch the diagonal.";
    const out = chunks(long, 40);
    expect(out.length).toBeGreaterThan(1);
    expect(out.every((c) => c.length <= 40)).toBe(true);
    expect(out.join(" ")).toBe(long);
  });
  it("cuts at word breaks when there are no commas, and never drops words", () => {
    const long = "word ".repeat(60).trim() + ".";
    const out = chunks(long, 50);
    expect(out.every((c) => c.length <= 50)).toBe(true);
    expect(out.join(" ")).toBe(long);
  });
});
