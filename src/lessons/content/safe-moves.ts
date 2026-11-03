// Lesson 2: Don't leave pieces hanging. Before moving, check what your
// opponent's last move attacks and what your own move leaves undefended.
// Checked by tests/unit/lessons.test.ts and tests/engine/lessons.engine.test.ts.

import type { Lesson } from "../lesson";

export const SAFE_MOVES: Lesson = {
  id: "safe-moves",
  version: 1,
  title: "Don't leave pieces hanging",
  summary: "Before you move, check what your move leaves undefended.",
  takeaway:
    "Before every move, ask: what does my opponent's last move attack, and what does my move leave undefended?",
  steps: [
    {
      kind: "explain",
      questions: [
        {
          q: "How do I know the bishop is attacked?",
          a: "Look at where the knight on {d5} can jump next. One of its squares is the bishop's square, {c3}.",
        },
        {
          q: "What can I do about it?",
          a: "Three things: move the bishop to a safe square, defend it with another piece, or take the attacker. Here moving the bishop is simplest.",
        },
      ],
      fen: "4k3/pp3ppp/8/3n4/8/2B5/P4PPP/4K3 w - - 0 1",
      text: "Black's knight just jumped to {d5}. It now attacks your bishop on {c3}, and nothing defends the bishop. If you play any other move, the knight takes it for free.",
      arrows: [["d5", "c3"]],
      marks: ["c3"],
    },
    {
      kind: "explain",
      questions: [
        {
          q: "Why does the pawn matter?",
          a: "If the bishop takes on {c3}, the pawn on {b2} takes it back. Black would give a bishop for a knight, an even trade, so the knight is safe for now.",
        },
        {
          q: "So should I never move that pawn?",
          a: "Not while it has a job. Move it only when the knight is safe some other way, or when moving it wins something bigger.",
        },
      ],
      fen: "4k3/pp3ppp/8/8/1b6/2N5/PP3PPP/6K1 w - - 0 1",
      text: "Your knight on {c3} is attacked by the bishop on {b4}, but the pawn on {b2} defends it. That pawn has a job: if it moves, the knight is left hanging and the bishop takes it for free.",
      arrows: [
        ["b4", "c3"],
        ["b2", "c3"],
      ],
      marks: ["c3"],
    },
    {
      kind: "quiz",
      questions: [
        {
          q: "Can't I just take the knight?",
          a: "Yes! Your bishop on {b3} can take the knight on {d5}. Taking the attacker is another way to save the rook.",
        },
        {
          q: "Is the bishop in danger too?",
          a: "No. The knight on {d5} can't reach {b3}, so the bishop is safe.",
        },
      ],
      fen: "4k3/pp3ppp/8/3n4/5R2/1B6/P4PPP/4K3 w - - 0 1",
      prompt: "Black just moved a knight to {d5}. Which of your pieces is now in danger? Click it.",
      squares: ["f4"],
      right:
        "Right: the knight on {d5} attacks your rook on {f4}, and nothing defends it. Move it, defend it, or take the knight.",
      wrong:
        "Not that one. Look at every square the knight on {d5} can jump to, and find your piece on one of them.",
      arrows: [],
    },
    {
      kind: "exercise",
      questions: [
        {
          q: "Which move counts as right here?",
          a: "Any move that leaves nothing to take. The engine checks your move before it is played and warns you if it loses a piece.",
        },
        {
          q: "How do I find what is attacked?",
          a: "Start with the piece your opponent just moved: look at every square it attacks now. Then check that each of your pieces there is defended.",
        },
        {
          q: "Is losing a pawn all right?",
          a: "In this lesson, yes: only a knight, bishop, rook or queen counts. In a real game a pawn matters too, so keep them safe when you can.",
        },
      ],
      task: "Your opponent just attacked one of your pieces. Make a move that keeps everything safe.",
      theme: "safe",
      count: 4,
      maxRating: 400,
      fallback: [
        ["sm-1", "4k3/pp4pp/1n3p2/8/8/2B5/P4PPP/4K3 b - - 0 1", "b6d5 c3d4", 400],
        ["sm-2", "4k3/pp3ppp/8/8/4N3/8/PP3PPP/4K3 b - - 0 1", "f7f5 e4c3", 400],
        ["sm-3", "4k3/pp3ppp/8/2b5/8/8/P4PPP/R3K3 b - - 0 1", "c5d4 a1d1", 400],
        ["sm-4", "4k3/pp3ppp/8/n7/8/8/PP1Q1PPP/4K3 b - - 0 1", "a5c4 d2c3", 400],
        ["sm-5", "4k3/pp3ppp/4p3/8/3R4/8/PP3PPP/4K3 b - - 0 1", "e6e5 d4d3", 400],
        ["sm-6", "4k3/pp3p1p/6p1/8/6B1/8/PP3PPP/4K3 b - - 0 1", "h7h5 g4f3", 400],
        ["sm-7", "r3k3/pp3ppp/8/8/8/3B4/PP3PPP/4K3 b - - 0 1", "a8d8 d3e2", 400],
        ["sm-8", "4kb2/pp3ppp/8/8/8/2N5/P4PPP/6K1 b - - 0 1", "f8b4 c3e4", 400],
      ],
    },
  ],
};
