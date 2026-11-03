// Lesson 7: Pins. A piece can't move without exposing a bigger one behind it.
// Checked by tests/unit/lessons.test.ts and tests/engine/lessons.engine.test.ts.

import type { Lesson } from "../lesson";

export const PINS: Lesson = {
  id: "pins",
  version: 1,
  title: "Pins",
  summary: "A piece can't move without exposing a bigger one behind it.",
  takeaway:
    "A pinned piece can't move without exposing a bigger piece behind it. Attack it again, because it can't run away.",
  steps: [
    {
      kind: "explain",
      questions: [
        {
          q: "Which pieces can pin?",
          a: "Only pieces that move in straight lines: the bishop, the rook and the queen. A knight or a pawn can't pin.",
        },
        {
          q: "Can the pinned knight still defend?",
          a: "No. A piece that may not move can't take anything either, so the knight on {c6} defends nothing right now.",
        },
      ],
      fen: "4k3/8/2n5/1B6/8/8/8/4K3 b - - 0 1",
      text: "The bishop on {b5}, the knight on {c6} and the king on {e8} stand on one line. If the knight moved, the bishop would attack the king, and a move that puts your own king in check is not allowed. The knight is pinned.",
      arrows: [["b5", "e8"]],
      marks: ["c6"],
    },
    {
      kind: "explain",
      questions: [
        {
          q: "So the knight may move here?",
          a: "Yes, the rules allow it. But then the bishop on {g5} takes the queen on {d8}. Even after the king takes back, Black has given 9 points for 3.",
        },
        {
          q: "How do I break a pin?",
          a: "Move the bigger piece behind off the line, put another piece in between, or chase the pinning piece away.",
        },
      ],
      fen: "3qk3/8/5n2/6B1/8/8/8/4K3 b - - 0 1",
      text: "Here the knight on {f6} is pinned to the queen on {d8} by the bishop on {g5}. The knight may legally move, but then the bishop takes the queen. A pin to the king is absolute; a pin to another piece just makes moving very costly.",
      arrows: [["g5", "d8"]],
      marks: ["f6"],
    },
    {
      kind: "quiz",
      questions: [
        {
          q: "Why isn't the bishop pinned?",
          a: "None of your pieces lines up the bishop on {d6} with the king, so it can move freely. It defends the knight, but that won't save it.",
        },
        {
          q: "How can I win the pinned knight?",
          a: "Push your pawn on {d2} two squares to attack it. The knight can't run away, and a pawn (1) for a knight (3) is a good trade even though the bishop takes back.",
        },
      ],
      fen: "4k3/8/3b4/4n3/8/8/3P4/4RK2 w - - 0 1",
      prompt: "White to move. Which black piece is pinned? Click it.",
      squares: ["e5"],
      right:
        "Right: the knight on {e5} stands between your rook on {e1} and the king on {e8}. It can't move.",
      wrong:
        "Not that one. Find a black piece between one of your rooks or bishops and the black king.",
      arrows: [],
    },
    {
      kind: "exercise",
      questions: [
        {
          q: "How do I find a pin?",
          a: "Look for an enemy piece on a line with the king or queen behind it, and a bishop, rook or queen of yours that can reach that line.",
        },
        {
          q: "I pinned a piece. What next?",
          a: "Pile up on it: attack it with another piece, ideally a pawn. A pinned piece can't escape.",
        },
        {
          q: "Can my pieces get pinned too?",
          a: "Yes. Before you move a piece, check whether it is shielding your king or queen from an enemy bishop, rook or queen.",
        },
      ],
      task: "Use a pin to win material.",
      theme: "pin",
      count: 5,
      maxRating: 800,
      fallback: [],
    },
  ],
};
