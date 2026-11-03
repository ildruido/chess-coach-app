// Lesson 10: Opening principles. Take the centre, develop the knights and
// bishops, castle early; then do it against the engine.
// Checked by tests/unit/lessons.test.ts and tests/engine/lessons.engine.test.ts.

import type { Lesson } from "../lesson";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export const OPENING_PRINCIPLES: Lesson = {
  id: "opening-principles",
  version: 1,
  title: "Opening principles",
  summary: "Take the centre, bring out your knights and bishops, and castle early.",
  takeaway:
    "In the opening: take the centre, bring out your knights and bishops, and castle early. Save the queen for later.",
  steps: [
    {
      kind: "explain",
      questions: [
        {
          q: "Why does the centre matter?",
          a: "A piece in the middle can go both ways, so it reaches more squares than one on the edge. A knight in a corner reaches only two.",
        },
        {
          q: "Should I push all my pawns?",
          a: "No. One or two centre pawns are enough. Then bring out your pieces.",
        },
      ],
      fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
      text: "The four squares in the middle of the board are the centre. Pieces in or near it reach more squares. White's first move puts the pawn on {e4} in the centre, and opens lines for the queen on {d1} and the bishop on {f1}.",
      arrows: [
        ["d1", "h5"],
        ["f1", "a6"],
      ],
      marks: ["d4", "e4", "d5", "e5"],
    },
    {
      kind: "show",
      questions: [
        {
          q: "Why not bring the queen out early?",
          a: "Pieces worth less can chase her, and each time she runs away you lose a move. Bring out the knights and bishops first.",
        },
        {
          q: "Can I move the same piece twice?",
          a: "Try not to in the opening, unless you must: each move should bring a new piece into play.",
        },
      ],
      fen: START,
      nearBest: true,
      intro:
        "Watch both sides follow the three rules: take the centre, bring out the knights and bishops, and castle. Click Next.",
      line: [
        { san: "e4", text: "{e4}: a pawn takes its place in the centre." },
        { san: "e5", text: "{e5}: Black does the same." },
        {
          san: "Nf3",
          text: "{Nf3}: a knight comes out and attacks the pawn on {e5}.",
          arrows: [["f3", "e5"]],
        },
        {
          san: "Nc6",
          text: "{Nc6}: Black brings out a knight too, and it defends the pawn on {e5}.",
          arrows: [["c6", "e5"]],
        },
        {
          san: "Nc3",
          text: "{Nc3}: the other knight comes out, towards the centre. Knights before bishops is a good habit.",
        },
        { san: "Nf6", text: "{Nf6}: Black copies. Each side has two pieces out." },
        { san: "Bb5", text: "{Bb5}: a bishop comes out, and now White's king is free to castle." },
        { san: "Bb4", text: "{Bb4}: Black's bishop comes out too." },
        {
          san: "O-O",
          text: "{O-O}: castling. The king tucks away behind its pawns, and the rook on {h1} comes towards the middle.",
        },
        {
          san: "O-O",
          text: "{O-O}: Black castles too. In five moves each, both sides took the centre, brought out pieces and made their king safe.",
        },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          q: "Where should the knight on {b1} go?",
          a: "Towards the centre: {Nc3} or {Nbd2} both bring it into play.",
        },
        {
          q: "And the bishop on {c1}?",
          a: "{Bg5} pins the knight on {f6} to the queen, or {Be3} offers to trade it for the bishop on {c5}.",
        },
      ],
      fen: "r1bqk2r/ppp2ppp/2np1n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQ1RK1 w kq - 0 6",
      prompt:
        "White to move. White has castled, but two pieces are still at home. Click a knight or bishop that is still on its starting square.",
      squares: ["b1", "c1"],
      right:
        "Right. The knight on {b1} and the bishop on {c1} haven't moved yet: bring them out next, then the real game begins.",
      wrong: "Not that one. Look along White's back row for a knight or bishop that hasn't moved.",
      marks: [],
    },
    {
      kind: "exercise",
      questions: [
        {
          q: "Which pieces should I move first?",
          a: "A centre pawn or two, then the knights, then the bishops. Castle as soon as the squares between your king and rook are empty.",
        },
        {
          q: "What if the engine attacks one of my pieces?",
          a: "Deal with the threat first: move the piece, defend it, or take the attacker. The engine warns you before a move that loses something.",
        },
        {
          q: "Does castling on either side count?",
          a: "Yes. Castling short is usually quicker: only the knight and the bishop need to move out of the way.",
        },
      ],
      task: "Bring out both knights and both bishops, and castle, within 10 moves. The engine plays Black at full strength.",
      theme: "play",
      goal: "develop",
      maxMoves: 10,
      count: 1,
      positions: [["op-1", START]],
    },
  ],
};
