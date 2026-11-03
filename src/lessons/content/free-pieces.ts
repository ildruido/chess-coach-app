// Lesson 1: Free pieces. Spot a piece that can be taken for nothing, and take it.
// Every position, move and square here is checked by tests/unit/lessons.test.ts
// and, for the exercises, by Stockfish in tests/engine/lessons.engine.test.ts.

import type { Lesson } from "../lesson";

export const FREE_PIECES: Lesson = {
  id: "free-pieces",
  version: 1,
  title: "Free pieces",
  summary: "Spot a piece that can be taken for nothing, and take it.",
  takeaway: "Before every move, look for an enemy piece nothing defends, and take it.",
  steps: [
    {
      kind: "explain",
      questions: [
        {
          q: "Why is the knight free?",
          a: "No black piece can reach {d5} to take back. The black king on {e8} is too far away, so if your queen takes the knight, you lose nothing.",
        },
        {
          q: "How many points is a knight worth?",
          a: "About 3. A pawn is worth 1, a bishop 3, a rook 5 and a queen 9. Counting points tells you whether a trade is good for you.",
        },
        {
          q: "Should I always take a free piece?",
          a: "Almost always. Check first that your opponent isn't threatening something bigger, like checkmate. A whole piece for nothing is often enough to win the game.",
        },
      ],
      fen: "4k3/8/8/3n4/8/8/8/3QK3 w - - 0 1",
      text: "Black's knight on {d5} has no defender: no black piece can take back on {d5}. Your queen on {d1} attacks it. A piece like this is free.",
      arrows: [["d1", "d5"]],
      marks: ["d5"],
    },
    {
      kind: "explain",
      questions: [
        {
          q: "What if I take the knight anyway?",
          a: "The pawn on {e6} takes your queen back. You win a knight (3 points) but lose your queen (9 points), so you end up 6 points down.",
        },
        {
          q: "What does defended mean?",
          a: "A piece is defended when one of its own pieces could take back on its square. Here the pawn on {e6} defends the knight on {d5}.",
        },
        {
          q: "Is a defended piece always safe?",
          a: "No. If you can take it with a cheaper piece, the trade can still be good: a pawn for a knight wins 2 points. Here only your queen can take, so it isn't worth it.",
        },
      ],
      fen: "4k3/8/4p3/3n4/8/8/8/3QK3 w - - 0 1",
      text: "Now the pawn on {e6} defends the knight. If your queen takes on {d5}, the pawn takes the queen back: you give 9 points for 3. This knight is not free.",
      arrows: [["e6", "d5"]],
      marks: ["d5", "e6"],
    },
    {
      kind: "show",
      questions: [
        {
          q: "What does the x in {Qxd5} mean?",
          a: "The x means the move captures: the queen takes whatever stands on {d5}.",
        },
        {
          q: "Why the queen and not the king?",
          a: "Your king on {e1} can't reach {d5}. Only the queen on {d1} attacks the knight.",
        },
      ],
      fen: "4k3/8/8/3n4/8/8/8/3QK3 w - - 0 1",
      intro: "Back to the free knight. Click Next to take it.",
      line: [
        {
          san: "Qxd5",
          text: "{Qxd5}: the queen takes the knight, and nothing can take the queen back. You are a knight (3 points) ahead.",
          marks: ["d5"],
        },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          q: "Why not the rook on {a5}?",
          a: "None of your pieces attacks the rook on {a5}, so you can't take it this move.",
        },
        {
          q: "What about the knight on {b4}?",
          a: "None of your pieces attacks the knight on {b4} either. Only the bishop on {g4} can be taken.",
        },
        {
          q: "The bishop attacks my queen. Is that a problem?",
          a: "It would be if you ignored it. Taking the bishop solves it: the attacker is gone and you win 3 points.",
        },
      ],
      fen: "4k3/8/8/r7/1n4b1/2N5/8/3QK3 w - - 0 1",
      prompt: "White to move. One black piece is free. Click it.",
      squares: ["g4"],
      right:
        "Right: the bishop on {g4} attacks your queen, but nothing defends it. Your queen can simply take it.",
      wrong: "Not that one. Look for a black piece your pieces attack that no black piece defends.",
      arrows: [],
    },
    {
      kind: "exercise",
      questions: [
        {
          q: "How do I check if a piece is defended?",
          a: "Look at every enemy piece, the pawns and the king too, and ask: could it move to that square next turn? If none can, the piece is free.",
        },
        {
          q: "Two of my pieces can take it. Which one?",
          a: "Usually the cheaper one. If the piece turns out to be defended after all, you lose less.",
        },
        {
          q: "I can't see a free piece.",
          a: "Start with your opponent's last move: the piece that just moved, or the one it stopped defending. The Hint button can help too.",
        },
      ],
      task: "Your opponent just left a piece free. Take it.",
      theme: "hangingPiece",
      count: 5,
      maxRating: 800,
      fallback: [
        ["fp-1", "4k3/pp4pp/8/8/1n6/2N5/PP4PP/4K3 b - - 0 1", "b4d5 c3d5", 400],
        ["fp-2", "4k3/ppq3pp/8/8/8/8/PP4PP/4KB2 b - - 0 1", "c7c4 f1c4", 400],
        ["fp-3", "4k3/pp4pp/8/r7/8/5N2/PP4PP/4K3 b - - 0 1", "a5e5 f3e5", 400],
        ["fp-4", "4k3/pp4pp/1b6/8/8/8/PP1P2PP/4K3 b - - 0 1", "b6e3 d2e3", 400],
        ["fp-5", "4k3/pp4pp/6n1/8/8/8/P1P3PP/Q3K3 b - - 0 1", "g6e5 a1e5", 400],
      ],
    },
  ],
};
