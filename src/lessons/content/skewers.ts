// Lesson 8: Skewers. A pin in reverse: the bigger piece is in front.
// Checked by tests/unit/lessons.test.ts and tests/engine/lessons.engine.test.ts.

import type { Lesson } from "../lesson";

export const SKEWERS: Lesson = {
  id: "skewers",
  version: 1,
  title: "Skewers",
  summary: "A pin in reverse: the bigger piece in front.",
  takeaway:
    "Attack a big piece that has a smaller one behind it on the same line. When the big piece moves, take the one behind.",
  steps: [
    {
      kind: "explain",
      questions: [
        {
          q: "How is this different from a pin?",
          a: "In a pin the smaller piece is in front and can't move. In a skewer the bigger piece is in front, it has to move, and the one behind is lost.",
        },
        {
          q: "Can Black save the rook?",
          a: "No. Any king move leaves the line open, and the king must get out of check first.",
        },
      ],
      fen: "7r/8/8/8/3k4/8/1B6/4K3 b - - 0 1",
      text: "The bishop on {b2} checks the king on {d4}. Behind the king, on the same line, stands the rook on {h8}. The king must step away, and then the bishop takes the rook. That is a skewer.",
      arrows: [["b2", "h8"]],
      marks: ["d4", "h8"],
    },
    {
      kind: "explain",
      questions: [
        {
          q: "Does a skewer need a check?",
          a: "No. Attacking the queen with a rook behind her works too: the queen must move, and the rook is lost.",
        },
        {
          q: "Which pieces can skewer?",
          a: "Like pins, only the bishop, the rook and the queen, because a skewer works along a line.",
        },
      ],
      fen: "6r1/8/4k3/8/8/8/8/5B1K w - - 0 1",
      text: "Your bishop on {f1} can go to a square that checks the king on {e6}. The rook on {g8} sits behind the king on that same line. After the check the king must move, and the bishop takes the rook.",
      arrows: [["e6", "g8"]],
      marks: ["e6", "g8"],
    },
    {
      kind: "quiz",
      questions: [
        {
          q: "Why not check with the rook?",
          a: "A rook check from the side lets the king step away, but nothing stands behind it on that line, so you win nothing.",
        },
        {
          q: "What if the queen were behind instead of the rook?",
          a: "Even better: the skewer would win the queen, 9 points.",
        },
      ],
      fen: "7r/8/8/8/3k4/8/8/R1B1K3 w - - 0 1",
      prompt:
        "White to move. One of your pieces can skewer the black king and the rook behind it. Click it.",
      squares: ["c1"],
      right:
        "Right: the bishop on {c1} goes to a square that checks the king on {d4}, with the rook on {h8} behind it on the same line.",
      wrong:
        "Not that one. Find a check along a line that has another black piece behind the king.",
      arrows: [],
    },
    {
      kind: "exercise",
      questions: [
        {
          q: "How do I spot a skewer?",
          a: "Look for two enemy pieces on one line, the bigger one in front, and a bishop, rook or queen of yours that can reach that line.",
        },
        {
          q: "What if the front piece is defended?",
          a: "It doesn't matter: the front piece moves away, and you take the piece behind it.",
        },
        {
          q: "What if the piece behind is defended?",
          a: "Then count: if what you take is worth more than the piece you lose, it is still good.",
        },
      ],
      task: "Find the skewer.",
      theme: "skewer",
      count: 4,
      maxRating: 900,
      fallback: [],
    },
  ],
};
