import { describe, expect, it } from "vitest";
import { PracticeGame, legacyHintMode } from "../../src/practice/practice-game";
import { MAX_HINTS, parseSavedGame } from "../../src/storage/saved-game";

const play = (p: PracticeGame, ...moves: string[]) => {
  for (const m of moves) {
    const r = p.game.play(m.slice(0, 2), m.slice(2, 4));
    if (!r.ok) throw new Error(`${m}: ${r.reason}`);
  }
};

describe("PracticeGame", () => {
  it("starts with the chosen level and color, or a random color", () => {
    const p = PracticeGame.start(3, "black");
    expect(p.level.id).toBe(3);
    expect(p.playerColor).toBe("black");
    expect(p.needsEngineMove).toBe(true);
    expect(PracticeGame.start(1, "random", "tell", () => 0.1).playerColor).toBe("white");
    expect(PracticeGame.start(1, "random", "tell", () => 0.9).playerColor).toBe("black");
  });

  it("knows whose turn it is", () => {
    const p = PracticeGame.start(1, "white");
    expect(p.isPlayerTurn).toBe(true);
    play(p, "e2e4");
    expect(p.isPlayerTurn).toBe(false);
    expect(p.needsEngineMove).toBe(true);
    expect(p.statusLine()).toBe("The engine is thinking…");
  });

  it("takes back the player's move and the engine's reply together", () => {
    const p = PracticeGame.start(1, "white");
    play(p, "e2e4", "e7e5", "g1f3", "b8c6");
    expect(p.takeBack()).toBe(true);
    expect(p.game.moves).toEqual(["e2e4", "e7e5"]);
    expect(p.isPlayerTurn).toBe(true);
  });

  it("as Black, never takes back the engine's first move alone", () => {
    const p = PracticeGame.start(1, "black");
    play(p, "e2e4");
    expect(p.canTakeBack).toBe(false);
    expect(p.takeBack()).toBe(false);
    expect(p.game.moves).toEqual(["e2e4"]);
    play(p, "e7e5", "g1f3");
    expect(p.takeBack()).toBe(true);
    expect(p.game.moves).toEqual(["e2e4"]);
  });

  it("resigns, and a take-back undoes the resignation", () => {
    const p = PracticeGame.start(2, "white");
    play(p, "e2e4", "e7e5");
    p.resign();
    expect(p.isOver).toBe(true);
    expect(p.statusLine()).toBe("You resigned. The engine wins.");
    expect(p.takeBack()).toBe(true);
    expect(p.isOver).toBe(false);
    expect(p.game.moves).toHaveLength(2);
  });

  it("reports checkmate from the player's side", () => {
    const lost = PracticeGame.start(1, "white");
    play(lost, "f2f3", "e7e5", "g2g4", "d8h4");
    expect(lost.statusLine()).toBe("Checkmate. The engine wins.");
    const won = PracticeGame.start(1, "black");
    play(won, "f2f3", "e7e5", "g2g4", "d8h4");
    expect(won.statusLine()).toBe("Checkmate. You win!");
    // Take back after losing returns to the player's turn before the mate.
    expect(lost.takeBack()).toBe(true);
    expect(lost.game.moves).toEqual(["f2f3", "e7e5"]);
  });

  it("saves and resumes level, color, moves and resignation", () => {
    const p = PracticeGame.start(4, "black");
    play(p, "d2d4", "g8f6");
    p.resign();
    const saved = parseSavedGame(JSON.parse(JSON.stringify(p.toSaved())))!;
    const back = PracticeGame.fromSaved(saved)!;
    expect(back.level.id).toBe(4);
    expect(back.playerColor).toBe("black");
    expect(back.game.moves).toEqual(["d2d4", "g8f6"]);
    expect(back.resigned).toBe(true);
  });

  it("records the hints used, keeps them after a take back, and saves them", () => {
    const p = PracticeGame.start(2, "white", "ask");
    p.recordHint("question");
    play(p, "e2e4", "e7e5");
    p.recordHint("question");
    p.recordHint("plan");
    p.takeBack();
    expect(p.hints).toEqual([
      { ply: 0, step: "question", mode: "ask" },
      { ply: 2, step: "question", mode: "ask" },
      { ply: 2, step: "plan", mode: "ask" },
    ]);
    const saved = parseSavedGame(JSON.parse(JSON.stringify(p.toSaved())))!;
    expect(PracticeGame.fromSaved(saved)!.hints).toEqual(p.hints);
  });

  it("keeps the hint mode chosen at the start, through a save (CC-017)", () => {
    expect(PracticeGame.start(1, "white").hintMode).toBe("tell");
    const p = PracticeGame.start(1, "white", "ask");
    expect(p.hintMode).toBe("ask");
    const saved = parseSavedGame(JSON.parse(JSON.stringify(p.toSaved())))!;
    expect(saved.hintMode).toBe("ask");
    expect(PracticeGame.fromSaved(saved)!.hintMode).toBe("ask");
  });

  it("gives a game saved before CC-017 the mode of its last hint, else Tell me", () => {
    expect(legacyHintMode([])).toBe("tell");
    expect(
      legacyHintMode([
        { ply: 0, step: "plan", mode: "tell" },
        { ply: 2, step: "question", mode: "ask" },
      ]),
    ).toBe("ask");
    const old = JSON.parse(JSON.stringify(PracticeGame.start(1, "white", "ask").toSaved()));
    delete old.hintMode;
    expect(PracticeGame.fromSaved(parseSavedGame(old)!)!.hintMode).toBe("tell");
    // No hints yet: the toggle as last set on this device.
    expect(PracticeGame.fromSaved(parseSavedGame(old)!, "ask")!.hintMode).toBe("ask");
    old.hints = [{ ply: 0, step: "question", mode: "ask" }];
    expect(PracticeGame.fromSaved(parseSavedGame(old)!)!.hintMode).toBe("ask");
    expect(legacyHintMode([], "ask")).toBe("ask");
  });

  it("rejects a save with an unknown hint mode", () => {
    const bad = { ...PracticeGame.start(1, "white").toSaved(), hintMode: "shout" };
    expect(parseSavedGame(bad)).toBeNull();
  });

  it("is not resumed from a save without a level or color", () => {
    const p = PracticeGame.start(1, "white");
    const plain = { ...p.toSaved() };
    delete plain.level;
    delete plain.color;
    expect(PracticeGame.fromSaved(plain)).toBeNull();
  });
});

describe("hints in the current position", () => {
  it("are the latest hints at this half-move, so a resumed game carries on", () => {
    const p = PracticeGame.start(1, "white", "ask");
    p.recordHint("plan");
    expect(p.hintsHere()).toEqual(["plan"]);
    play(p, "e2e4", "e7e5");
    expect(p.hintsHere()).toEqual([]);
    p.recordHint("question");
    p.recordHint("plan");
    expect(p.hintsHere()).toEqual(["question", "plan"]);
  });

  it("keeps only the newest hints beyond the cap", () => {
    const p = PracticeGame.start(1, "white");
    for (let i = 0; i < MAX_HINTS + 3; i++) p.recordHint("plan");
    expect(p.hints).toHaveLength(MAX_HINTS);
    const base = p.toSaved();
    const many = { ...base, hints: [...base.hints!, { ply: 0, step: "move", mode: "tell" }] };
    const parsed = parseSavedGame(many)!;
    expect(parsed.hints).toHaveLength(MAX_HINTS);
    expect(parsed.hints!.at(-1)!.step).toBe("move");
  });

  it("an older save without hints still resumes, with no hints", () => {
    const p = PracticeGame.start(3, "white");
    play(p, "e2e4");
    const old = JSON.parse(JSON.stringify(p.toSaved()));
    delete old.hints;
    const back = PracticeGame.fromSaved(parseSavedGame(old)!)!;
    expect(back.game.moves).toEqual(["e2e4"]);
    expect(back.hints).toEqual([]);
  });
});

describe("saved practice fields", () => {
  it("rejects a bad level, color, resigned flag or hint list", () => {
    const base = PracticeGame.start(1, "white").toSaved();
    expect(parseSavedGame({ ...base, level: 9 })).toBeNull();
    expect(parseSavedGame({ ...base, level: 2.5 })).toBeNull();
    expect(parseSavedGame({ ...base, color: "green" })).toBeNull();
    expect(parseSavedGame({ ...base, resigned: "yes" })).toBeNull();
    expect(parseSavedGame({ ...base, hints: "many" })).toBeNull();
    expect(
      parseSavedGame({ ...base, hints: [{ ply: -1, step: "plan", mode: "tell" }] }),
    ).toBeNull();
    expect(
      parseSavedGame({ ...base, hints: [{ ply: 0, step: "answer", mode: "tell" }] }),
    ).toBeNull();
    expect(
      parseSavedGame({ ...base, hints: [{ ply: 0, step: "plan", mode: "shout" }] }),
    ).toBeNull();
    // Extra fields in a hint are dropped, not kept.
    const extra = { ...base, hints: [{ ply: 0, step: "move", mode: "ask", note: "x" }] };
    expect(parseSavedGame(extra)!.hints).toEqual([{ ply: 0, step: "move", mode: "ask" }]);
    expect(parseSavedGame(base)).toEqual(base);
  });
});

describe("PracticeGame id and outcome (CC-015)", () => {
  const FOOLS_MATE = ["f2f3", "e7e5", "g2g4", "d8h4"];

  it("keeps one id for the whole game, through saves and reloads", () => {
    const p = PracticeGame.start(1, "white");
    expect(p.id).toMatch(/^g-[a-z0-9]+-[a-z0-9]{6}$/);
    play(p, "e2e4");
    const again = PracticeGame.fromSaved(parseSavedGame(JSON.parse(JSON.stringify(p.toSaved())))!)!;
    expect(again.id).toBe(p.id);
    expect(PracticeGame.start(1, "white").id).not.toBe(p.id);
  });

  it("gives a game saved before ids existed one when it resumes", () => {
    const old = {
      version: 1 as const,
      moves: [],
      createdAt: "2026-10-01T10:00:00Z",
      updatedAt: "2026-10-01T10:00:00Z",
      level: 1,
      color: "white" as const,
    };
    const p = PracticeGame.fromSaved(old)!;
    expect(p.id).toMatch(/^g-/);
    expect(p.toSaved().id).toBe(p.id);
  });

  it("says how the game ended for the player", () => {
    const loss = PracticeGame.start(1, "white");
    expect(loss.outcome).toBeNull();
    play(loss, ...FOOLS_MATE);
    expect(loss.outcome).toBe("loss");
    const win = PracticeGame.start(1, "black");
    play(win, ...FOOLS_MATE);
    expect(win.outcome).toBe("win");
    const resigned = PracticeGame.start(1, "white");
    play(resigned, "e2e4");
    resigned.resign();
    expect(resigned.outcome).toBe("loss");
  });

  it("knows whether the player has moved", () => {
    const w = PracticeGame.start(1, "white");
    expect(w.playerMoved).toBe(false);
    play(w, "e2e4");
    expect(w.playerMoved).toBe(true);
    const b = PracticeGame.start(1, "black");
    play(b, "e2e4");
    expect(b.playerMoved).toBe(false);
    play(b, "e7e5");
    expect(b.playerMoved).toBe(true);
  });
});
