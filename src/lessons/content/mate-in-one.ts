// Lesson 4: Checkmate in one. Find the move that ends the game.
// Checked by tests/unit/lessons.test.ts and tests/engine/lessons.engine.test.ts.

import type { Lesson } from "../lesson";

export const MATE_IN_ONE: Lesson = {
  id: "mate-in-one",
  version: 1,
  title: "Checkmate in one",
  summary: "Find the move that ends the game.",
  takeaway:
    "Look at every check first. Checkmate is a check the king can't escape: it can't move, block or take the attacker.",
  steps: [
    {
      kind: "explain",
      questions: [
        {
          q: "Can the king take the queen?",
          a: "No. Your king on {f6} defends the queen on {g7}, and a king may never move into check.",
        },
        {
          q: "What happens after checkmate?",
          a: "The game is over and the side that gave checkmate wins. The king itself is never actually taken.",
        },
      ],
      fen: "7k/6Q1/5K2/8/8/8/8/8 b - - 0 1",
      text: "The queen on {g7} attacks the black king on {h8}. The king has nowhere safe to go, it can't take the queen because your king on {f6} defends her, and nothing can block. That is checkmate: the game is over.",
      arrows: [["g7", "h8"]],
      marks: ["h8"],
    },
    {
      kind: "explain",
      questions: [
        {
          q: "What are the three ways out of check?",
          a: "Move the king to a safe square, take the attacking piece, or put a piece in between. If none works, it is checkmate.",
        },
        {
          q: "Is a check always good?",
          a: "No. A check that lets the king escape can just waste a move. Look for the check that leaves no way out.",
        },
      ],
      fen: "7k/8/5K2/8/8/8/8/7Q b - - 0 1",
      text: "Here the queen on {h1} checks the king on {h8} too, but it is not mate: the king can step out of the way. Every check has three answers: move the king, take the attacker, or block. Checkmate is when none of them works.",
      arrows: [["h1", "h8"]],
      marks: ["h8"],
    },
    {
      kind: "show",
      questions: [
        {
          q: "Why does the queen go next to the king?",
          a: "From there she attacks the king and every square around it, and your king on {f6} protects her so she can't be taken.",
        },
        {
          q: "Is there another mate here?",
          a: "No, {Qg7#} is the only one. The engine checked every move.",
        },
      ],
      fen: "7k/8/5K2/8/8/8/8/6Q1 w - - 0 1",
      intro:
        "White to move. Your king on {f6} helps the queen on {g1}. Click Next to see the mate.",
      line: [
        {
          san: "Qg7#",
          text: "{Qg7#}: check, the queen is protected by your king, and the black king has no square left. Checkmate.",
          marks: ["g7"],
        },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          q: "What does the bishop do here?",
          a: "The bishop on {c3} protects the square next to the king, so the queen can land there safely.",
        },
        {
          q: "Why can't the king escape?",
          a: "Its own pawns on {f7} and {h7} block two squares, and the queen covers the rest.",
        },
      ],
      fen: "6k1/5p1p/6pQ/8/8/2B5/5PPP/6K1 w - - 0 1",
      prompt: "White to move. One of your pieces can give checkmate right now. Click it.",
      squares: ["h6"],
      right:
        "Right: the queen on {h6} goes next to the king, protected by the bishop on {c3}. The king can't move, block or take back: checkmate.",
      wrong:
        "Not that one. Look at every check you can give, and find the one where the king has no way out.",
      arrows: [],
    },
    {
      kind: "exercise",
      questions: [
        {
          q: "Where do I start looking?",
          a: "With every check you can give. Checks are the most forcing moves, and there are usually only a few.",
        },
        {
          q: "How do I know a check is mate?",
          a: "Ask the three questions: can the king move to a safe square, can the attacker be taken, can a piece block? If all three answers are no, it is mate.",
        },
        {
          q: "What if no check works?",
          a: "Every exercise here has a mate in one, so look again, especially at queen and rook checks. The Hint button can point at the right piece.",
        },
      ],
      task: "Find the checkmate in one move.",
      theme: "mateIn1",
      count: 6,
      maxRating: 800,
      fallback: [],
    },
  ],
};
