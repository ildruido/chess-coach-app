import { describe, expect, it } from "vitest";
import { gameAt } from "../../src/chess/notation";
import {
  buildFacts,
  buildHintPrompt,
  engineHint,
  evaluationInWords,
  factCheck,
  factCheckText,
  hiddenFactsText,
  hintErrorMessage,
  moveKey,
} from "../../src/coach/hint";
import level1 from "./fixtures/level1-positions.json";

const game = gameAt({ moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"] });
const analysis = {
  bestMove: "g8f6",
  depth: 16,
  score: { cp: 16 },
  pv: ["g8f6", "d2d3", "f8c5", "e1g1"],
  ms: 300,
};
const facts = buildFacts(game, analysis);
const allowed = ["e4", "e5", "Nf3", "Nc6", "Bc4", ...facts.lineSans];

describe("buildFacts", () => {
  it("turns engine output into readable facts", () => {
    expect(facts.sideToMove).toBe("Black");
    expect(facts.movesSoFar).toBe("1. e4 e5 2. Nf3 Nc6 3. Bc4");
    expect(facts.bestMove).toBe("Nf6");
    expect(facts.bestMoveTo).toBe("f6");
    expect(facts.bestMoveFrom).toBe("g8");
    expect(facts.bestPiece).toBe("n");
    expect(facts.bestLine).toBe("3... Nf6 4. d3 Bc5 5. O-O");
    expect(facts.evaluation).toBe("+0.16");
    expect(facts.evaluationInWords).toBe("roughly equal");
    expect(facts.blackPieces).toContain("knights c6, g8");
  });

  it("trusts the engine's best move over a line that starts elsewhere", () => {
    const f = buildFacts(game, { ...analysis, bestMove: "f8c5" });
    expect(f.bestMove).toBe("Bc5");
    expect(f.lineSans).toEqual(["Bc5"]);
  });

  it("never invents an evaluation", () => {
    expect(buildFacts(game, { ...analysis, score: undefined }).evaluation).toBe("not reported");
  });
});

describe("evaluationInWords", () => {
  it("reads scores from White's view", () => {
    expect(evaluationInWords({ cp: 50 })).toBe("White is slightly better");
    expect(evaluationInWords({ cp: -150 })).toBe("Black is clearly better");
    expect(evaluationInWords({ cp: 400 })).toBe("White is winning");
    expect(evaluationInWords({ mate: -2 })).toBe("Black has a forced mate");
    expect(evaluationInWords({ mate: 0 })).toBe("checkmate");
  });
});

describe("buildHintPrompt", () => {
  it("puts the engine facts in the prompt and forbids own calculation", () => {
    const p = buildHintPrompt(facts, "move");
    expect(p).toContain("Engine best move: Nf6");
    expect(p).toContain("Engine best line: 3... Nf6 4. d3 Bc5 5. O-O");
    expect(p).toContain("Do not calculate variations yourself");
    expect(p).toContain("Don't mention tools");
  });

  it("keeps the best move secret from the coach before the piece step (CC-018)", () => {
    for (const stage of ["question", "plan"] as const) {
      const p = buildHintPrompt(facts, stage);
      expect(p.replace(/\s+/g, " ")).toContain("never 'your knight' or 'castle'");
      expect(p.split("Engine facts")[1]).not.toMatch(/Nf6|g8 to f6|Engine best|FEN/);
      expect(p).toContain("The best move moves one of Black's pieces");
      expect(p).toContain("After it, the moved piece attacks White's pawn on e4.");
      expect(p).toContain("Engine evaluation:");
    }
  });

  it("words what a hidden move does without its square or castling", () => {
    const g = gameAt({ moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "d2d3"] });
    const f = buildFacts(g, { ...analysis, bestMove: "f8c5", pv: ["f8c5"] });
    expect(hiddenFactsText(f)).not.toMatch(/Bc5|f8 to c5/);
    const exposed = { ...f, moveFacts: [...f.moveFacts, "On c5 the moved piece can be captured."] };
    expect(hiddenFactsText(exposed)).not.toContain("On c5");
    expect(hiddenFactsText(exposed)).toContain(
      "On its new square the moved piece can be captured.",
    );
    const castle = buildFacts(gameAt({ moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6"] }), {
      ...analysis,
      bestMove: "e1g1",
      pv: ["e1g1"],
    });
    expect(castle.bestPiece).toBe("castle");
    expect(hiddenFactsText(castle)).toContain("tucks White's king away from the centre");
    expect(hiddenFactsText(castle)).not.toMatch(/O-O|castl/i);
  });

  it("has rules for every step, and hides the piece only before the piece step", () => {
    expect(buildHintPrompt(facts, "question")).toContain("Ask ONE short guiding question");
    expect(buildHintPrompt(facts, "piece")).toContain("Say which piece");
    expect(buildHintPrompt(facts, "piece")).not.toContain("never 'your");
    // The piece step knows the piece, but not where it goes (CC-019).
    const piece = buildHintPrompt(facts, "piece").split("Engine facts")[1]!;
    expect(piece).toContain("The piece that makes the best move: Black's knight on g8.");
    expect(piece).not.toMatch(/Nf6|f6|Engine best/);
    expect(buildHintPrompt(facts, "move")).toContain("Name the engine's best move");
    expect(buildHintPrompt(facts, "move")).toContain("Never recite the engine's line");
  });

  it("passes on what the coach already said, and makes a second question sharper", () => {
    const p = buildHintPrompt(facts, "question", [{ stage: "question", text: "What is\nweak?" }]);
    expect(p).toContain("- question: What is weak?");
    expect(p).toContain("This is a second question");
    expect(buildHintPrompt(facts, "plan")).not.toContain("already told");
  });

  it("asks the coach to call the engine, and to stop if the engine fails", () => {
    const p = buildHintPrompt(null, "plan");
    expect(p).toContain("getEngineAnalysis");
    expect(p).toContain("engine is unavailable");
    expect(p).not.toContain("Engine best move");
  });
});

describe("moveKey", () => {
  it("treats capture marks, checks and disambiguation as the same move", () => {
    expect(moveKey("Bxf7+")).toBe(moveKey("Bf7"));
    expect(moveKey("Nbd2")).toBe(moveKey("Nd2"));
    expect(moveKey("exd5")).toBe("ed5");
    expect(moveKey("e8=Q#")).toBe("e8=Q");
    expect(moveKey("O-O-O")).toBe("O-O-O");
  });
});

describe("factCheck", () => {
  it("passes a hint that only uses engine moves", () => {
    const fc = factCheck(
      "Nf6 attacks e4, and after d3 Bc5 Black develops.",
      "move",
      facts,
      allowed,
    );
    expect(fc).toEqual({ hadFacts: true, unknownMoves: [], revealedMove: false });
  });

  it("flags moves the engine never gave", () => {
    const fc = factCheck("Consider Bb4 or Qxf2+ instead.", "move", facts, allowed);
    expect(fc.unknownMoves).toEqual(["Bb4", "Qxf2"]);
  });

  it("does not flag the same move written differently", () => {
    expect(
      factCheck("Black can castle with O-O later.", "move", facts, allowed).unknownMoves,
    ).toEqual([]);
  });

  it("flags a plan hint that gives the move or its square away", () => {
    expect(factCheck("Play Nf6!", "plan", facts, allowed).revealedMove).toBe(true);
    expect(factCheck("Bring the knight to f6.", "plan", facts, allowed).revealedMove).toBe(true);
    expect(
      factCheck("Develop a piece and hit the e4 pawn.", "plan", facts, allowed).revealedMove,
    ).toBe(false);
  });

  it("keeps the piece and its square hidden in a plan or a question", () => {
    for (const stage of ["plan", "question"] as const) {
      expect(factCheck("Develop a knight.", stage, facts, allowed).revealedMove).toBe(true);
      expect(factCheck("What could g8 do?", stage, facts, allowed).revealedMove).toBe(true);
    }
  });

  it("lets a plan talk about the opponent's pieces of the same kind", () => {
    // Black to move, best move Nf6: White's knight is not Black's move.
    for (const text of [
      "White's knight on f3 eyes e5.",
      "Your opponent's knight is active.",
      "Watch their knights.",
      "White’s knight on f3 eyes e5.",
      "White's well-placed knight eyes e5.",
    ]) {
      expect(factCheck(text, "plan", facts, allowed).revealedMove).toBe(false);
    }
    expect(
      factCheck("White's knight is active; bring a knight out too.", "plan", facts, allowed)
        .revealedMove,
    ).toBe(true);
  });

  it("lists pieces under attack and forbids other threats", () => {
    const p = buildHintPrompt(facts, "question");
    expect(p).toContain("Pieces under attack now (from the rules of chess):\n- none");
    expect(p).toContain("Never claim a threat, a weakness or a mate that is");
    expect(p).not.toContain("what the opponent threatens");
  });

  it("leaves out earlier hints whose text is gone (after a reload)", () => {
    const p = buildHintPrompt(facts, "piece", [{ stage: "plan", text: "" }]);
    expect(p).not.toContain("already told");
  });

  it("lets the piece step name the piece, but not where it goes", () => {
    expect(factCheck("Your knight on g8 wants to join the game.", "piece", facts, allowed)).toEqual(
      { hadFacts: true, unknownMoves: [], revealedMove: false },
    );
    expect(factCheck("Put your knight on f6.", "piece", facts, allowed).revealedMove).toBe(true);
  });

  it("keeps castling hidden until the move step", () => {
    const castle = { bestMove: "O-O", bestMoveTo: "g1", bestMoveFrom: "e1", bestPiece: "castle" };
    const f = castle as Parameters<typeof factCheck>[2];
    expect(factCheck("Your king wants safety.", "piece", f, []).revealedMove).toBe(false);
    expect(factCheck("Time to castle.", "piece", f, []).revealedMove).toBe(true);
    expect(factCheck("Castle now.", "move", f, []).revealedMove).toBe(false);
  });

  it("does not check pawn or king words, which plans use all the time", () => {
    const pawn = { bestMove: "d5", bestMoveTo: "d5", bestMoveFrom: "d7", bestPiece: "p" };
    const f = pawn as Parameters<typeof factCheck>[2];
    expect(factCheck("Fight for the centre with a pawn.", "plan", f, []).revealedMove).toBe(false);
  });

  it("catches a capture given away in words (found in manual testing, round 2)", () => {
    const capture = { bestMove: "Bxf7+", bestMoveTo: "f7" };
    const leak = "By moving your bishop to f7 with check, you force Black's king to move.";
    expect(factCheck(leak, "plan", capture, []).revealedMove).toBe(true);
    expect(factCheck("Bxf7+ wins.", "plan", capture, []).revealedMove).toBe(true);
    expect(factCheck("Black's king is short of defenders.", "plan", capture, []).revealedMove).toBe(
      false,
    );
  });

  it("does not confuse long and short castling", () => {
    const castle = { bestMove: "O-O", bestMoveTo: "g1" };
    expect(factCheck("Later, O-O-O is possible.", "plan", castle, []).revealedMove).toBe(false);
    expect(factCheck("Castle now with O-O.", "plan", castle, []).revealedMove).toBe(true);
  });

  it("catches a pawn move given away in an idea hint", () => {
    const pawn = { bestMove: "d5", bestMoveTo: "d5" };
    expect(factCheck("Strike with d5 now.", "plan", pawn, []).revealedMove).toBe(true);
  });

  // Real coach answers from CC-018's sample run, in positions from engine games.
  const at = (moves: string[], best: string) =>
    buildFacts(gameAt({ moves }), { ...analysis, bestMove: best, pv: [best] });

  it("lets an early hint name a piece that is under attack (CC-018)", () => {
    const g1p21 =
      "b2b3 d7d6 d2d4 h7h6 e2e4 c8d7 f1e2 g8f6 e4e5 f6g8 c1b2 d6d5 h2h4 d7f5 e2g4 f5g6 h4h5 g6e4 b1d2 e4g2 h1h2";
    const f = at(g1p21.split(" "), "g2e4");
    expect(f.bestPieceAttacked).toBe(true);
    for (const [text, stage] of [
      [
        "Your bishop is hanging on g2. Can you move it to a square where it defends something important?",
        "question",
      ],
      ["Move your bishop away from danger while defending your pawn.", "plan"],
    ] as const) {
      expect(factCheck(text, stage, f, []).revealedMove).toBe(false);
    }
    // Where it goes is still hidden.
    expect(factCheck("Bring your bishop back to e4.", "plan", f, []).leak).toEqual({
      rule: "destination",
      match: "e4",
    });
  });

  it("lets an early hint name the piece to capture (CC-018)", () => {
    // Black to move, best move Nf6: White's knight is the target, not Black's piece.
    for (const text of [
      "Can you attack the knight on f3?",
      "Look for a way to win the undefended knight.",
      "Capture the knight to cut White's attack.",
    ]) {
      expect(factCheck(text, "plan", facts, allowed).revealedMove).toBe(false);
    }
  });

  it("lets an early hint name a piece of the same kind only by a square it stands on (CC-018)", () => {
    // White to move, best move Ndf3 (from d2); Black's knight stands on b8, a pawn on e5.
    const g3p38 =
      "a2a3 g8f6 d2d4 b7b6 e2e3 a7a5 b2b3 f6e4 g1h3 h7h6 c1b2 d7d5 g2g3 e7e6 d1e2 f8d6 b1d2 f7f5 h3f4 c8a6 e2h5 e8e7 f4g6 e7e8 d2e4 e8d7 e4d2 d8e8 c2c4 a5a4 b3b4 e8f7 g6e5 d6e5 d4e5 d7c8 c4c5 b6c5";
    const f = at(g3p38.split(" "), "d2f3");
    expect(f.bestMoveFrom).toBe("d2");
    expect(factCheck("The knight on b8 is stuck at home.", "plan", f, []).revealedMove).toBe(false);
    // Real coach answer: there is no knight on e5, and the only one is the mover.
    expect(factCheck("Your knight on e5 needs support.", "plan", f, []).revealedMove).toBe(true);
    expect(factCheck("Your knight on d2 can help.", "plan", f, []).revealedMove).toBe(true);
  });

  it("warns the coach that a captured piece's square is the answer", () => {
    const g = gameAt({ moves: ["e2e4", "d7d5"] });
    const f = buildFacts(g, { ...analysis, bestMove: "e4d5", pv: ["e4d5"] });
    expect(hiddenFactsText(f)).toContain(
      "It captures a pawn (don't name its square: that gives the move away).",
    );
  });

  it("keeps a captured piece's square and the capturing piece out of early facts (CC-023)", () => {
    // Level-1 game: White's pawn on a4 can take the undefended pawn on b5.
    const f = at("g1f3 h7h6 b2b3 a7a5 a2a4 b7b5".split(" "), "a4b5");
    expect(f.threats).toContain(
      "Black's pawn on b5 is attacked by White's pawn on a4 and is not defended.",
    );
    const plan = hiddenFactsText(f);
    expect(plan).toContain(
      "- Black's pawn (on the square the best move goes to, so don't name it) is attacked by one of White's pieces (the one that makes the best move: keep it secret) and is not defended.",
    );
    expect(plan).not.toMatch(/on b5|on a4/);
    // The piece step names the piece that moves, but still not where it goes.
    const piece = hiddenFactsText(f, true);
    expect(piece).toContain("attacked by White's pawn on a4");
    expect(piece).not.toContain("on b5");
  });

  it("tells the coach what kind of slip it was, without the answer (CC-023)", () => {
    const p = buildHintPrompt(facts, "piece", [], {
      text: "Your knight on g8 goes to f6.",
      leak: { rule: "destination", match: "f6" },
    });
    expect(p).toContain(
      'Your last answer for this step was held back because it named the square the move goes to: "Your knight on g8 goes to ___."\nWrite a new one that leaves that kind of thing out.',
    );
    expect(p.split("\n").find((l) => l.includes("held back"))).not.toContain("f6");
    expect(buildHintPrompt(facts, "piece")).not.toContain("held back");
    // A hint held back for naming a move nobody gave.
    expect(buildHintPrompt(facts, "move", [], { text: "Play Bb5." })).toContain(
      "because it named a move the engine didn't give",
    );
  });

  it("holds back own-piece phrasings that look like captures (CC-018 review)", () => {
    // Black to move, best move Nf6, the knight is not under attack.
    for (const text of [
      "Take the knight into play to hit the centre.",
      "Remove the knight from the back rank and develop it.",
      "Bring your attacking knight into the game.",
      "Your knight on e5 should come out.",
    ]) {
      expect(factCheck(text, "plan", facts, allowed).revealedMove).toBe(true);
    }
    // Neither side has a queen: "attack the queen" is no capture target.
    const noQueen = at(
      ["e2e4", "d7d5", "e4d5", "d8d5", "b1c3", "d5e5", "d1e2", "e5e2", "f1e2"],
      "b8c6",
    );
    const q = { ...noQueen, bestPiece: "q" as const };
    expect(factCheck("Attack the queen.", "plan", q, []).revealedMove).toBe(true);
  });

  it("tells the coach which piece moves when a threat is listed (CC-018 review)", () => {
    // 1.e4 d5: the e4 pawn is attacked, but the engine's move is Nc3.
    const f = at(["e2e4", "d7d5"], "b1c3");
    expect(f.threats.join(" ")).toContain("White's pawn on e4 is attacked");
    expect(hiddenFactsText(f)).toContain(
      "The piece that moves is not one of those listed as under attack; don't suggest moving those.",
    );
    const g1p21 =
      "b2b3 d7d6 d2d4 h7h6 e2e4 c8d7 f1e2 g8f6 e4e5 f6g8 c1b2 d6d5 h2h4 d7f5 e2g4 f5g6 h4h5 g6e4 b1d2 e4g2 h1h2";
    expect(hiddenFactsText(at(g1p21.split(" "), "g2e4"))).toContain(
      "The piece that moves is the one on g2, listed as under attack.",
    );
  });

  it("still holds back a plan that names the piece to move (CC-018)", () => {
    const g2p22 =
      "c2c4 h7h6 b2b3 d7d5 g1f3 c7c5 g2g3 g7g5 b3b4 d5c4 d1a4 c8d7 a4a5 d8c8 a2a4 b7b6 b4c5 b6a5 c1a3 f7f6 f1g2 d7e6";
    const f = at(g2p22.split(" "), "f3d4");
    expect(f.bestPieceAttacked).toBe(false);
    const fc = factCheck("Jump your knight into the center to attack and defend.", "plan", f, []);
    expect(fc.leak).toEqual({ rule: "piece", match: "knight" });
    expect(factCheck("Take your knight to the centre.", "plan", f, []).revealedMove).toBe(true);
    expect(factCheck("The knight on f3 can jump.", "question", f, []).revealedMove).toBe(true);
    const castle = at(
      "a2a3 g8f6 d2d4 b7b6 e2e3 a7a5 b2b3 f6e4 g1h3 h7h6 c1b2 d7d5 g2g3 e7e6 d1e2 f8d6 b1d2 f7f5 h3f4".split(
        " ",
      ),
      "e8g8",
    );
    expect(factCheck("Castle to tuck your king to safety.", "plan", castle, []).leak?.rule).toBe(
      "castling",
    );
  });

  it("keeps where the piece goes out of the piece step (CC-019, Ale's v0.4.0 test)", () => {
    const f = at([], "e2e4");
    const p = buildHintPrompt(f, "piece").split("Engine facts")[1]!;
    expect(p).toContain("The piece that makes the best move: White's pawn on e2.");
    expect(p).not.toMatch(/\be4\b|Engine best/);
    // Ale's hint: names the piece, but "advance" gives a pawn's move away.
    const ale =
      "Your pawn on e2 should advance to the center. This classical opening move controls the heart of the board.";
    expect(factCheck(ale, "piece", f, []).leak).toEqual({ rule: "direction", match: "advance" });
    expect(
      factCheck("Your pawn on e2 can fight for the centre.", "piece", f, []).revealedMove,
    ).toBe(false);
    for (const leak of [
      "Push your pawn on e2 into the fight.",
      "Your pawn on e2 can move two squares.",
      "Move it forward to claim space.",
      "Your pawn on e2 advances with tempo.",
    ]) {
      expect(factCheck(leak, "piece", f, []).leak?.rule).toBe("direction");
    }
    for (const fine of [
      "Your pawn on e2 keeps your slight advantage going forward in the game.",
      "Your pawn on e2 pushes your advantage.",
      "Your pawn on e2 supports your advanced knight.",
    ]) {
      expect(factCheck(fine, "piece", f, []).revealedMove).toBe(false);
    }
    // Castling: the piece step shows the king, never the castling move.
    const castle = at(["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6"], "e1g1");
    const c = hiddenFactsText(castle, true);
    expect(c).toContain("The piece that makes the best move: White's king on e1.");
    expect(c).not.toMatch(/O-O|castl|g1/i);
    // Other pieces may say where they aim ("advantage" isn't "advance").
    const knight = at([], "g1f3");
    expect(
      factCheck("Your knight on g1 keeps the advantage; bring it forward.", "piece", knight, [])
        .revealedMove,
    ).toBe(false);
  });

  it("fails when the coach never had the engine's facts", () => {
    const fc = factCheck("Play d4, opening the centre.", "move", null, []);
    expect(fc.hadFacts).toBe(false);
    expect(factCheckText(fc, "move")).toMatch(/^Failed: the coach never got/);
  });

  it("explains a pass", () => {
    const fc = factCheck("Develop and castle.", "plan", facts, allowed);
    expect(factCheckText(fc, "plan")).toMatch(/^Passed/);
  });
});

describe("hintErrorMessage", () => {
  it("uses hint wording, not question-box wording", () => {
    expect(hintErrorMessage("refused").message).toMatch(/hint/);
    expect(hintErrorMessage("tools_unavailable").message).toMatch(/Facts in prompt/);
    expect(hintErrorMessage("not_granted").disable).toBe(true);
  });
});

// Positions from level-1 engine games (both sides), like Ale's: 20 of 48 best moves are captures.
describe("level-1 positions (CC-023)", () => {
  const positions = level1 as { id: string; moves: string; best: string }[];
  const factsOf = (p: { moves: string; best: string }) =>
    buildFacts(gameAt({ moves: p.moves.split(" ") }), {
      ...analysis,
      bestMove: p.best,
      pv: [p.best],
    });

  it("never show a capture's target square, or the moving piece's square, before the piece step", () => {
    for (const p of positions) {
      const f = factsOf(p);
      const plan = hiddenFactsText(f).split("Pieces under attack")[1]!;
      expect(plan, p.id).not.toContain(` on ${f.bestMoveTo}`);
      if (!f.bestPieceAttacked) expect(plan, p.id).not.toContain(` on ${f.bestMoveFrom}`);
      expect(hiddenFactsText(f, true).split("Pieces under attack")[1], p.id).not.toContain(
        ` on ${f.bestMoveTo}`,
      );
    }
  });

  it("give an engine hint for every step that passes the check", () => {
    for (const p of positions) {
      const f = factsOf(p);
      const allowed = [...gameAt({ moves: p.moves.split(" ") }).history(), ...f.lineSans];
      for (const stage of ["question", "plan", "piece", "move"] as const) {
        const text = engineHint(f, stage);
        expect(text, `${p.id}:${stage}`).not.toBe("");
        const fc = factCheck(text, stage, f, allowed);
        expect(fc.revealedMove || fc.unknownMoves.length > 0, `${p.id}:${stage}: ${text}`).toBe(
          false,
        );
      }
    }
  });

  it("lets a plan describe the opponent's piece with a few words (stand-in coach, g2p22)", () => {
    const p = positions.find((x) => x.id === "g2p22")!;
    const f = factsOf(p);
    expect(f.bestMove).toBe("Bb2");
    const plan = (text: string) => factCheck(text, "plan", f, []).revealedMove;
    expect(plan("Attack Black's key defensive bishop on the long diagonal.")).toBe(false);
    // Still caught: the player's own piece after the opponent's.
    expect(plan("Black's pawn and your bishop both matter here.")).toBe(true);
  });

  it("doesn't let 'with the knight' after the opponent's piece hide the player's own (review)", () => {
    const f = buildFacts(gameAt({ moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6"] }), {
      ...analysis,
      bestMove: "f3g5",
      pv: ["f3g5"],
    });
    const plan = (text: string) => factCheck(text, "plan", f, []).revealedMove;
    expect(plan("Hit Black's pawn with the knight.")).toBe(true);
    expect(plan("Hit Black's pawn using the knight.")).toBe(true);
  });

  it("says 'win material' only when the engine's line wins some (review)", () => {
    // 1. e4 e5 2. Nf3 Nc6 3. Bb5 a6: Bxc6 dxc6 is an even trade.
    const trade = buildFacts(gameAt({ moves: ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6"] }), {
      ...analysis,
      bestMove: "b5c6",
      pv: ["b5c6", "d7c6"],
    });
    expect(engineHint(trade, "plan")).not.toMatch(/win/i);
    expect(engineHint(trade, "piece")).toBe(
      "The piece to move: your bishop on b5. It makes a capture.",
    );
    // 1. e4 d5 2. Bb5+ c6 3. ... a hanging pawn: exd5 wins one.
    const win = buildFacts(gameAt({ moves: ["e2e4", "d7d5", "a2a3", "a7a6"] }), {
      ...analysis,
      bestMove: "e4d5",
      pv: ["e4d5"],
    });
    expect(engineHint(win, "plan")).toMatch(/^You can win material/);
    // A second question in ask mode is a different one.
    expect(engineHint(win, "question", true)).not.toBe(engineHint(win, "question"));
  });
});
