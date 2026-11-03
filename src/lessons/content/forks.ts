// Lesson 6: Forks. One piece attacks two at once; the knight is the master.
// Checked by tests/unit/lessons.test.ts and tests/engine/lessons.engine.test.ts.

import type { Lesson } from "../lesson";

export const FORKS: Lesson = {
  id: "forks",
  version: 1,
  title: "Forks",
  summary: "One piece attacks two at once.",
  takeaway:
    "Look for a move that attacks two things at once. Your opponent can save only one of them.",
  steps: [
    {
      kind: "explain",
      questions: [
        {
          q: "Why is the knight so good at forks?",
          a: "It jumps in an L-shape and attacks up to eight squares that a rook, bishop or queen can't block. Pieces near each other are often both in its reach.",
        },
        {
          q: "Can other pieces fork too?",
          a: "Yes. A pawn, bishop, rook, queen or even the king can attack two pieces at once. The knight is just the most common.",
        },
      ],
      fen: "r3k3/2N5/8/8/8/8/8/4K3 b - - 0 1",
      text: "The knight on {c7} attacks two black pieces at once: the king on {e8} and the rook on {a8}. Black must get the king out of check, and then the knight takes the rook. That double attack is a fork.",
      arrows: [
        ["c7", "e8"],
        ["c7", "a8"],
      ],
      marks: ["e8", "a8"],
    },
    {
      kind: "show",
      questions: [
        {
          q: "Why give check?",
          a: "A check must be answered at once, so Black has no time to save the rook as well.",
        },
        {
          q: "What if the rook were defended?",
          a: "Then the knight might be taken back after it takes the rook. A knight (3) for a rook (5) still wins 2 points.",
        },
      ],
      fen: "r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1",
      intro:
        "White to move. Your knight on {b5} can jump to a square that attacks both the king on {e8} and the rook on {a8}. Click Next.",
      line: [
        {
          san: "Nc7+",
          text: "{Nc7+}: check and a fork. The king must move, and next turn the knight takes the rook on {a8}.",
          arrows: [
            ["c7", "e8"],
            ["c7", "a8"],
          ],
        },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          q: "Where does the knight go?",
          a: "To a square that attacks both the king on {e8} and the queen on {b5}, giving check. Black must move the king, and the knight takes the queen.",
        },
        {
          q: "The queen attacks my knight. Does that matter?",
          a: "Not if the knight moves first with check: Black has to answer the check and loses the queen.",
        },
      ],
      fen: "4k3/8/8/1q6/2N5/8/8/2B1K3 w - - 0 1",
      prompt: "White to move. One of your pieces can fork the black king and queen. Click it.",
      squares: ["c4"],
      right:
        "Right: the knight on {c4} jumps to a square that checks the king on {e8} and attacks the queen on {b5}.",
      wrong:
        "Not that one. Which piece can reach a square that attacks the king and the queen together?",
      arrows: [],
    },
    {
      kind: "exercise",
      questions: [
        {
          q: "How do I spot a fork?",
          a: "Look for two enemy pieces that one of your pieces could attack from the same square, especially the king, the queen and undefended pieces.",
        },
        {
          q: "Does a fork have to be a check?",
          a: "No, but a check is the strongest kind, because your opponent must answer it first.",
        },
        {
          q: "What if both forked pieces are defended?",
          a: "Then the fork may win nothing. It works best when at least one target is the king, worth more than the attacker, or undefended.",
        },
      ],
      task: "Find the fork.",
      theme: "fork",
      count: 5,
      maxRating: 800,
      fallback: [],
    },
  ],
};
