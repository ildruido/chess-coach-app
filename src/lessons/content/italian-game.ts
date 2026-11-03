// Lesson 11: The Italian Game. A first opening to play as White: its moves,
// its ideas, a drill against the book, and two mistakes to punish.
// Checked by tests/unit/lessons.test.ts and tests/engine/lessons.engine.test.ts.

import type { Lesson } from "../lesson";

const GIUOCO_PIANO = "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4";

export const ITALIAN_GAME: Lesson = {
  id: "italian-game",
  version: 1,
  title: "The Italian Game",
  summary: "A first opening to play as White, and its ideas.",
  takeaway:
    "In the Italian Game, the bishop aims at the weak pawn next to Black's king. Develop calmly, castle, and watch for Black's mistakes around that pawn.",
  steps: [
    {
      kind: "show",
      questions: [
        {
          q: "Why is the pawn on {f7} weak?",
          a: "At the start only the king defends it. A bishop and a knight aimed at it can win it, or worse, if Black isn't careful.",
        },
        {
          q: "Why is it called the Italian Game?",
          a: "Italian players wrote about it more than 400 years ago. Beginners and world champions still play it.",
        },
      ],
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      nearBest: true,
      intro: "The Italian Game is one of the oldest openings. Click Next to play its first moves.",
      line: [
        { san: "e4", text: "{e4}: White takes the centre." },
        { san: "e5", text: "{e5}: Black answers in the centre." },
        {
          san: "Nf3",
          text: "{Nf3}: the knight comes out and attacks the pawn on {e5}.",
          arrows: [["f3", "e5"]],
        },
        {
          san: "Nc6",
          text: "{Nc6}: Black defends it with a knight.",
          arrows: [["c6", "e5"]],
        },
        {
          san: "Bc4",
          text: "{Bc4}: the Italian Game. The bishop aims at {f7}, the weakest pawn near Black's king: only the king defends it.",
          arrows: [["c4", "f7"]],
          marks: ["f7"],
        },
      ],
    },
    {
      kind: "explain",
      questions: [
        {
          q: "Why do the two bishops look the same?",
          a: "They mirror each other: the bishop on {c4} aims at {f7}, the one on {c5} at {f2}. Each side must keep that pawn defended.",
        },
        {
          q: "Can White attack at once?",
          a: "{Ng5} attacks {f7} a second time, but Black can defend it, and White's knight has used two moves. Calm development is better here.",
        },
      ],
      fen: GIUOCO_PIANO,
      text: "Black's most natural answer brings the bishop to {c5}, aiming at {f2} the same way. This is the Giuoco Piano, Italian for 'quiet game'. White's plan: support the centre with pawns, castle, then bring out the rest.",
      arrows: [
        ["c4", "f7"],
        ["c5", "f2"],
      ],
    },
    {
      kind: "show",
      questions: [
        {
          q: "Why not push the d-pawn two squares at once?",
          a: "You can: that is the sharper Classical line. But it opens the centre before White has castled. The quiet {d3} keeps everything safe while you develop.",
        },
        {
          q: "Could Black take the pawn on {e4}?",
          a: "Not after {d3}: the pawn is defended, so taking it would give a knight for a pawn.",
        },
      ],
      fen: GIUOCO_PIANO,
      nearBest: true,
      intro: "The quiet main line: White builds the centre slowly and castles. Click Next.",
      line: [
        {
          san: "c3",
          text: "{c3}: a quiet pawn move. It gets ready to push the d-pawn later, and takes a square away from the knight on {c6}.",
        },
        {
          san: "Nf6",
          text: "{Nf6}: Black brings out the other knight and attacks the pawn on {e4}.",
          arrows: [["f6", "e4"]],
        },
        {
          san: "d3",
          text: "{d3}: the pawn defends {e4} and opens a line for the bishop on {c1}.",
        },
        { san: "d6", text: "{d6}: Black does the same for the pawn on {e5}." },
        { san: "O-O", text: "{O-O}: White castles. The king is safe, and the rook joins in." },
        {
          san: "O-O",
          text: "{O-O}: so does Black. This calm setup is the Giuoco Pianissimo: everything is protected, and the real game begins.",
        },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          q: "Why not take the pawn on {e5}?",
          a: "{Nxe5} gives away the knight: the knight on {c6} takes it back.",
        },
        {
          q: "Is the knight jump the best move?",
          a: "It is a real attack that you must know how to meet with Black. {d3} and {O-O} are calmer and just as good.",
        },
      ],
      fen: "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
      prompt:
        "Here Black brought out the other knight instead. White to move: which White piece can jump to a square where it attacks {f7} a second time? Click it.",
      squares: ["f3"],
      right:
        "Right: {Ng5} attacks {f7} with the knight and the bishop on {c4} together. Black must defend it at once.",
      wrong: "Not that one. Only one kind of piece jumps: where could it land to attack {f7}?",
      marks: ["f7"],
    },
    {
      kind: "exercise",
      questions: [
        {
          q: "What if I forget the next move?",
          a: "Press Hint: it shows which piece moves, then the move. A hint counts as help in your score.",
        },
        {
          q: "What happens if I play another move?",
          a: "The drill says you left the book, names the move the Italian Game plays, and lets you take yours back.",
        },
        {
          q: "Will Black always answer like this?",
          a: "In the drill the engine follows the main line so you learn it. In a real game Black may answer differently.",
        },
      ],
      task: "Play the Italian Game as White. The engine answers with the book moves.",
      theme: "drill",
      opening: "Italian Game",
      line: "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O",
      count: 1,
    },
    {
      kind: "exercise",
      questions: [
        {
          q: "How do I spot Black's mistake?",
          a: "Ask what Black's last move changed: what did it stop guarding, and did it put a piece where it can be taken?",
        },
        {
          q: "Why is the pawn next to Black's king so often the target?",
          a: "Only the king guards it at the start, and in the Italian Game the bishop already aims at it. One more attacker is often enough.",
        },
      ],
      task: "Black just made a mistake in the Italian Game. Punish it.",
      theme: "own",
      count: 2,
      maxRating: 1500,
      fallback: [
        [
          "it-1",
          "r1bqkb1r/pppp1ppp/2n2n2/4p1N1/2B1P3/8/PPPP1PPP/RNBQK2R b KQkq - 5 4",
          "h7h6 g5f7",
          800,
        ],
        [
          "it-2",
          "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R b KQkq - 0 4",
          "f6e4 d3e4",
          800,
        ],
        [
          "it-3",
          "r1bqkb1r/pppp1ppp/2n2n2/4p1N1/2B1P3/8/PPPP1PPP/RNBQK2R b KQkq - 5 4",
          "a7a6 g5f7",
          900,
        ],
        [
          "it-4",
          "r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/2P2N2/PP1P1PPP/RNBQK2R b KQkq - 0 4",
          "c5b4 c3b4",
          900,
        ],
      ],
    },
  ],
};
