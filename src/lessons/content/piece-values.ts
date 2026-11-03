// Lesson 3: What pieces are worth. Count points before you trade.
// Checked by tests/unit/lessons.test.ts and tests/engine/lessons.engine.test.ts.

import type { Lesson } from "../lesson";

export const PIECE_VALUES: Lesson = {
  id: "piece-values",
  version: 1,
  title: "What pieces are worth",
  summary: "What each piece is worth, and which trades are good.",
  takeaway:
    "Pawn 1, knight 3, bishop 3, rook 5, queen 9. Before you capture, count what you win and what you can lose back.",
  steps: [
    {
      kind: "explain",
      questions: [
        {
          q: "Why is the queen worth so much?",
          a: "She moves like a rook and a bishop together, so she attacks more squares than any other piece.",
        },
        {
          q: "What is the king worth?",
          a: "The king can never be traded: if it is checkmated, the game is over. So it has no points, but it is worth more than everything else.",
        },
        {
          q: "Are a knight and a bishop really equal?",
          a: "Nearly. Both are worth about 3. Which one is better depends on the position, so beginners can treat them as equal.",
        },
      ],
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      text: "Each piece is worth points: a pawn like {e2} is 1, a knight like {b1} is 3, a bishop like {c1} is 3, a rook like {a1} is 5, and the queen on {d1} is 9. Points tell you whether a trade is good.",
      marks: ["e2", "b1", "c1", "a1", "d1"],
    },
    {
      kind: "explain",
      questions: [
        {
          q: "But Black takes my pawn back. Is that bad?",
          a: "No. You lose a pawn (1 point) and win a knight (3 points), so you come out 2 points ahead.",
        },
        {
          q: "When is taking a defended piece bad?",
          a: "When the piece you take with is worth more than the piece you win. Your queen (9) for a defended knight (3) loses 6 points.",
        },
      ],
      fen: "4k3/8/5p2/4n3/3P4/8/8/4K3 w - - 0 1",
      text: "The pawn on {f6} defends the knight on {e5}. But your pawn on {d4} can still take it: you give a pawn (1 point) and win a knight (3 points). A cheap piece taking a more valuable one is a good trade.",
      arrows: [
        ["d4", "e5"],
        ["f6", "e5"],
      ],
      marks: ["e5"],
    },
    {
      kind: "show",
      questions: [
        {
          q: "Could Black not take back?",
          a: "Black could leave it, but then Black is simply a knight down. Taking back at least wins the pawn.",
        },
        {
          q: "Who is ahead after the trade?",
          a: "Count it: you gave 1 point and won 3, so the trade gained you 2 points.",
        },
      ],
      fen: "4k3/8/5p2/4n3/3P4/8/8/4K3 w - - 0 1",
      intro: "Watch the trade. Click Next.",
      line: [
        {
          san: "dxe5",
          text: "{dxe5}: the pawn takes the knight. You win 3 points.",
          marks: ["e5"],
        },
        {
          san: "fxe5",
          text: "{fxe5}: Black takes back and wins your pawn, 1 point. The trade gained you 2 points.",
          marks: ["e5"],
        },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          q: "Why not take the pawn on {e4}?",
          a: "Nothing defends it, so you win 1 point for free. Taking the rook wins more: 5 points, minus your knight's 3 when the pawn on {e6} takes back, still 2.",
        },
        {
          q: "Is giving up my knight for a rook good?",
          a: "Yes. A rook is worth 5 and a knight 3, so you are 2 points up after the trade.",
        },
      ],
      fen: "4k3/8/4p3/3r4/4p3/2N5/8/4K3 w - - 0 1",
      prompt:
        "White to move. Your knight on {c3} can take two things. Which capture wins the most? Click the piece to take.",
      squares: ["d5"],
      right:
        "Right: the knight takes the rook on {d5}. The pawn on {e6} takes back, but you win 5 points and lose 3.",
      wrong:
        "Count again: take the piece worth the most, then subtract your knight's 3 points if it can be taken back.",
      arrows: [],
    },
    {
      kind: "exercise",
      questions: [
        {
          q: "How do I count a trade quickly?",
          a: "Add up what you take, then subtract what your opponent can take back. If the result is above zero, the trade is good for you.",
        },
        {
          q: "Two captures look good. Which first?",
          a: "Take the most valuable piece, or the one taken with your cheapest piece. If both are equal, the Hint button can help.",
        },
        {
          q: "What if my piece is attacked too?",
          a: "Then count that as well: a good capture that also saves your piece is even better.",
        },
      ],
      task: "Find the capture that wins material.",
      theme: "winningCapture",
      count: 4,
      maxRating: 1200,
      fallback: [],
    },
  ],
};
