// Lesson 12: Mate with king and queen. Box the king in, bring your own king,
// mate on the edge, and never stalemate; then do it against the engine.
// Checked by tests/unit/lessons.test.ts and tests/engine/lessons.engine.test.ts.

import type { Lesson } from "../lesson";

const FINISH = "1k6/8/2K5/8/8/8/8/3Q4 w - - 0 1";

export const QUEEN_MATE: Lesson = {
  id: "queen-mate",
  version: 1,
  title: "Mate with king and queen",
  summary: "Box the king in, bring your own king, and mate on the edge.",
  takeaway:
    "Shrink the box with quiet queen moves, bring your king, mate on the edge, and before every move check the king still has a square.",
  steps: [
    {
      kind: "explain",
      questions: [
        {
          q: "Why not just give check?",
          a: "A check lets the king step away, often out of the box. Taking squares away works better than chasing.",
        },
        {
          q: "How big is the box?",
          a: "Three files by four ranks: twelve squares. Each good queen move makes it smaller.",
        },
      ],
      fen: "8/8/2k5/8/3Q4/8/8/4K3 w - - 0 1",
      text: "A king and a queen always beat a lone king, if you know how. The queen on {d4} guards the whole file and rank she stands on, so the black king on {c6} can't cross them: it is shut in a box in the corner of the board.",
      arrows: [
        ["d4", "d8"],
        ["d4", "a4"],
      ],
      marks: ["c6"],
    },
    {
      kind: "explain",
      questions: [
        {
          q: "Why do I need my king?",
          a: "Alone, the queen can't mate: the king just steps next to her. Your king protects her and takes away the squares she can't.",
        },
        {
          q: "Which edge should I push the king to?",
          a: "Any edge works. Push it to the one it is already closest to.",
        },
      ],
      fen: FINISH,
      text: "Once the box is small, bring your own king. Mate comes on the edge of the board, with your king protecting the queen or guarding the last squares. Here the black king on {b8} is on the edge, and your king on {c6} is close.",
      marks: ["b8"],
    },
    {
      kind: "show",
      questions: [
        {
          q: "Is {Qd7} the only good move?",
          a: "No, other quiet queen moves win too. The idea is the same: take squares away, don't chase with checks.",
        },
        {
          q: "What if Black had one more square?",
          a: "Then the queen would take it away next move. Mate comes once the king is in check and has no square left.",
        },
      ],
      fen: FINISH,
      nearBest: true,
      intro:
        "White to move. The king is on the edge and your king is close. Watch the finish. Click Next.",
      line: [
        {
          san: "Qd7",
          text: "{Qd7}: no check, but the king on {b8} has only one square left.",
        },
        { san: "Ka8", text: "{Ka8}: forced. It is Black's only legal move." },
        {
          san: "Qb7#",
          text: "{Qb7#}: checkmate. Your king on {c6} protects the queen, so the black king can't take her.",
          arrows: [["c6", "b7"]],
        },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          q: "What should White play instead?",
          a: "Leave the king a square: {Qc5} keeps it on the edge, and mate follows in a few moves.",
        },
        {
          q: "How do I avoid stalemate?",
          a: "Before each queen move, check that the black king still has a square to go to, or that your move gives check.",
        },
      ],
      fen: "k7/8/2K5/8/8/4Q3/8/8 w - - 0 1",
      prompt:
        "Careful with stalemate: if Black has no legal move but isn't in check, the game is a draw. White to move: click the square where the queen would stalemate the king on {a8}.",
      squares: ["b6"],
      right:
        "Right: {Qb6} takes the king's last squares without giving check. Black can't move, so the game would be a draw.",
      wrong:
        "Not that one. Look for the queen move that takes all the king's squares without giving check.",
      marks: ["a8"],
    },
    {
      kind: "exercise",
      questions: [
        {
          q: "How long can it take?",
          a: "With good technique, ten moves or so. There's no move limit here, so take your time, but don't let the position repeat three times: that's a draw.",
        },
        {
          q: "What does the safety net watch for?",
          a: "Stalemate, a draw by repetition, and a queen left where the king can take her. It warns you before such a move is played.",
        },
        {
          q: "Can I use hints?",
          a: "Yes: the engine gives the plan, the piece, then the move, and the score counts it as help.",
        },
      ],
      task: "Checkmate with king and queen. The engine defends at full strength.",
      theme: "play",
      goal: "mate",
      count: 2,
      positions: [
        ["kq-1", "8/8/2k5/8/8/8/8/3QK3 w - - 0 1"],
        ["kq-2", "8/8/8/4k3/8/8/8/K6Q w - - 0 1"],
        ["kq-3", "7k/8/8/8/8/8/8/1Q2K3 w - - 0 1"],
        ["kq-4", "4k3/8/8/8/8/8/8/3QK3 w - - 0 1"],
      ],
    },
  ],
};
