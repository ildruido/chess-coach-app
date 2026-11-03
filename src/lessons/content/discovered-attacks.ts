// Lesson 9: Discovered attacks. Move one piece to reveal an attack by another.
// Checked by tests/unit/lessons.test.ts and tests/engine/lessons.engine.test.ts.

import type { Lesson } from "../lesson";

export const DISCOVERED_ATTACKS: Lesson = {
  id: "discovered-attacks",
  version: 1,
  title: "Discovered attacks",
  summary: "Move one piece to reveal an attack by another.",
  takeaway:
    "When one of your pieces blocks another's line, moving it makes two threats at once: the piece that moves, and the one behind it.",
  steps: [
    {
      kind: "explain",
      questions: [
        {
          q: "Why is this so strong?",
          a: "It makes two threats with one move: the rook's check and whatever the bishop attacks. Black can answer only one.",
        },
        {
          q: "What is a double check?",
          a: "When the moving piece gives check too. Then the king must move, because no single move can block or take two checking pieces.",
        },
      ],
      fen: "q3k3/8/8/8/4B3/8/8/4R1K1 w - - 0 1",
      text: "Your bishop on {e4} stands between your rook on {e1} and the king on {e8}. When the bishop moves, the rook checks the king. Black must answer the check, so the bishop can go anywhere, even take the queen on {a8}.",
      arrows: [
        ["e1", "e8"],
        ["e4", "a8"],
      ],
      marks: ["e4"],
    },
    {
      kind: "explain",
      questions: [
        {
          q: "Does the piece behind have to give check?",
          a: "No. Uncovering an attack on the queen or an undefended piece works too, as long as the moving piece makes a second threat.",
        },
        {
          q: "Can my opponent do this to me?",
          a: "Yes. Watch for an enemy bishop, rook or queen behind one of their own pieces, aimed at your king or queen.",
        },
      ],
      fen: "q3k3/8/8/8/4B3/8/8/4R1K1 w - - 0 1",
      text: "This is a discovered attack: the bishop on {e4} moves away and uncovers the rook on {e1}. A move like {Bc6+} even gives two checks at once, from the bishop and from the rook.",
      arrows: [["e1", "e8"]],
      marks: ["e4", "e1"],
    },
    {
      kind: "quiz",
      questions: [
        {
          q: "What about the bishop?",
          a: "Nothing stands in front of the bishop on {b2}, so moving another piece doesn't uncover anything for it here.",
        },
        {
          q: "Where should the knight go?",
          a: "Anywhere it makes a second threat. The rook's check means Black has no time to stop it.",
        },
      ],
      fen: "4k3/8/8/8/8/4N3/1B6/4R1K1 w - - 0 1",
      prompt:
        "White to move. Which piece should move to uncover a check on the black king? Click it.",
      squares: ["e3"],
      right:
        "Right: the knight on {e3} blocks your rook on {e1}. When it moves, the rook checks the king on {e8}.",
      wrong:
        "Not that one. Find your piece standing between one of your rooks or bishops and the black king.",
      arrows: [],
    },
    {
      kind: "exercise",
      questions: [
        {
          q: "How do I find a discovered attack?",
          a: "Look for your own piece standing in front of your bishop, rook or queen, on a line that leads to an enemy king, queen or loose piece.",
        },
        {
          q: "Where should the front piece go?",
          a: "To a square where it makes its own threat: a check, a capture, or an attack on another piece.",
        },
        {
          q: "Is a discovered check better than a normal one?",
          a: "Usually, because two pieces attack at once and your opponent can deal with only one of them.",
        },
      ],
      task: "Move one piece to uncover an attack, and win material.",
      theme: "discoveredAttack",
      count: 4,
      maxRating: 900,
      fallback: [],
    },
  ],
};
