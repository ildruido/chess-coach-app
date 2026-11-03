// Every lesson, in the order of the plan (docs/LESSONS-PLAN.md section 7).
// Each lesson is a data file in content/, checked by tests/unit/lessons.test.ts
// and tests/engine/lessons.engine.test.ts.

import { BACK_RANK } from "./content/back-rank";
import { DISCOVERED_ATTACKS } from "./content/discovered-attacks";
import { FORKS } from "./content/forks";
import { FREE_PIECES } from "./content/free-pieces";
import { ITALIAN_GAME } from "./content/italian-game";
import { MATE_IN_ONE } from "./content/mate-in-one";
import { OPENING_PRINCIPLES } from "./content/opening-principles";
import { PIECE_VALUES } from "./content/piece-values";
import { PINS } from "./content/pins";
import { QUEEN_MATE } from "./content/queen-mate";
import { SAFE_MOVES } from "./content/safe-moves";
import { SKEWERS } from "./content/skewers";
import type { Lesson } from "./lesson";

export interface LessonGroup {
  title: string;
  lessons: Lesson[];
}

/** The lesson list's sections, in the plan's order. */
export const LESSON_GROUPS: LessonGroup[] = [
  {
    title: "Tactics",
    lessons: [
      FREE_PIECES,
      SAFE_MOVES,
      PIECE_VALUES,
      MATE_IN_ONE,
      BACK_RANK,
      FORKS,
      PINS,
      SKEWERS,
      DISCOVERED_ATTACKS,
    ],
  },
  { title: "Openings", lessons: [OPENING_PRINCIPLES, ITALIAN_GAME] },
  { title: "Checkmates", lessons: [QUEEN_MATE] },
];

/** Every lesson, numbered in this order on the list. */
export const LESSONS: Lesson[] = LESSON_GROUPS.flatMap((g) => g.lessons);

/**
 * The recommended path for a beginner / casual player (CC-021): win and keep
 * material first, then mate in one, a first look at the opening, then the
 * tactical patterns, and last a first opening and the queen mate.
 */
export const PATH_IDS: readonly string[] = [
  "free-pieces",
  "safe-moves",
  "piece-values",
  "mate-in-one",
  "opening-principles",
  "back-rank",
  "forks",
  "pins",
  "skewers",
  "discovered-attacks",
  "italian-game",
  "queen-mate",
];

/** Every lesson in the recommended order. */
export const PATH: Lesson[] = PATH_IDS.map((id) => LESSONS.find((l) => l.id === id)!);
