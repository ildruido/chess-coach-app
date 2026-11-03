// Lesson 5: Back-rank mate. A king trapped behind its own pawns, and how to give it air.
// Checked by tests/unit/lessons.test.ts and tests/engine/lessons.engine.test.ts.

import type { Lesson } from "../lesson";

export const BACK_RANK: Lesson = {
  id: "back-rank",
  version: 1,
  title: "Back-rank mate",
  summary: "Trap a king behind its own pawns, and give your own king an escape square.",
  takeaway:
    "A king behind its own unmoved pawns can be mated by a rook or queen on the back rank. Give your own king air before it happens.",
  steps: [
    {
      kind: "explain",
      questions: [
        {
          q: "What is the back rank?",
          a: "The row where a side's pieces start: the first row for White, the eighth for Black. Here the black king on {g8} stands on it.",
        },
        {
          q: "Why can't the king go forward?",
          a: "Its own pawns on {f7}, {g7} and {h7} stand in front of it. A king can't move onto its own pieces.",
        },
      ],
      fen: "R5k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1",
      text: "The rook on {a8} checks the king on {g8} along the back rank. The king's own pawns on {f7}, {g7} and {h7} block its way forward, and nothing can take the rook or block. Checkmate.",
      arrows: [["a8", "g8"]],
      marks: ["g8"],
    },
    {
      kind: "explain",
      questions: [
        {
          q: "Isn't moving a pawn in front of the king weakening?",
          a: "A little, but one small step is usually worth it. A king with no square at all can lose the game to a single check.",
        },
        {
          q: "When should I make this move?",
          a: "When you have a quiet moment and the enemy has a rook or queen that could reach your back rank.",
        },
      ],
      fen: "6k1/5pp1/7p/8/8/8/5PPP/R5K1 w - - 0 1",
      text: "Same idea, but Black's pawn now stands on {h6}, one step forward. If White checks with {Ra8+}, the king just steps up next to it. That one pawn move gave the king air: a square to escape to.",
      arrows: [["a1", "a8"]],
      marks: ["h6"],
    },
    {
      kind: "show",
      questions: [
        {
          q: "Could Black have stopped this?",
          a: "Yes: a pawn step in front of the king earlier, or a rook guarding the back rank, would have given the king a way out.",
        },
        {
          q: "Does this only work with a rook?",
          a: "A queen does it too. Any piece that runs along the whole back rank can give this mate.",
        },
      ],
      fen: "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1",
      intro: "White to move. The black king on {g8} has no air. Click Next.",
      line: [
        {
          san: "Ra8#",
          text: "{Ra8#}: the rook checks along the back rank, and the pawns keep the king in. Checkmate.",
          arrows: [["a8", "g8"]],
        },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          q: "Why not move the bishop?",
          a: "The bishop on {c3} can't reach the back rank with check, so it can't give mate here.",
        },
        {
          q: "Is my own king safe here?",
          a: "Not completely: your pawns on {f2}, {g2} and {h2} trap your king on {g1} the same way. Watch your own back rank too.",
        },
      ],
      fen: "6k1/5ppp/8/8/8/2B5/5PPP/1R4K1 w - - 0 1",
      prompt: "White to move. Which piece gives a back-rank mate? Click it.",
      squares: ["b1"],
      right:
        "Right: the rook on {b1} runs to the back rank with check, and the king can't get out.",
      wrong: "Not that one. Which piece can reach Black's back rank with check?",
      arrows: [],
    },
    {
      kind: "exercise",
      questions: [
        {
          q: "What should I look for first?",
          a: "A king behind its own pawns, and your rook or queen that can reach its back rank.",
        },
        {
          q: "The back rank is guarded. Is there still a mate?",
          a: "Sometimes you first give up a piece to draw the defender away, then mate. Look for a check that forces the defender to take.",
        },
        {
          q: "How do I protect my own king from this?",
          a: "Move one pawn in front of your king a step forward when you have time, or keep a rook on your back rank.",
        },
      ],
      task: "Use the weak back rank: find the mate.",
      theme: "backRankMate",
      count: 4,
      maxRating: 900,
      fallback: [],
    },
  ],
};
