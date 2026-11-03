// What Ale says in a lesson (CC-057), turned into one request. No DOM and no coach
// call, so it is unit tested. Moves, "hint" and plain questions are read as in
// Practice (`parseCommand`); a lesson adds "next", "back", "skip",
// "leave lesson", "repeat" and "try again".
import { Chess } from "chess.js";
import { type Command, normalise, parseCommand } from "../voice/command";

export type LessonCommand =
  | Exclude<Command, { kind: "review" }>
  | { kind: "next" }
  | { kind: "repeat" }
  | { kind: "retry" }
  | { kind: "back" }
  | { kind: "skip" }
  | { kind: "leave" }
  /** A move was spoken but there is no move to make on this step. */
  | { kind: "no-move" };

const NEXT =
  /^(?:please )?(?:next|next step|next move|next exercise|next one|continue|go on|keep going|carry on|go to the next(?: step| one)?)(?: please)?$/;
const REPEAT =
  /^(?:please )?(?:repeat|repeat that|repeat it|say (?:it|that) again|read (?:it|that|this|the lesson|the step|the text)(?: again| to me| out| aloud)?|what does it say)$/;
const BACK = /^(?:please )?(?:back|go back|previous|previous step|go to the previous step)$/;
const SKIP = /^(?:please )?skip(?: this| it| this exercise| the exercise| exercise)?$/;
const LEAVE =
  /^(?:please )?(?:leave|leave (?:the |this )?lesson|exit(?: the| this)?(?: lesson)?|quit(?: the| this)?(?: lesson)?|close (?:the |this )?lesson|(?:go )?back to (?:the )?lessons?(?: list| screen)?)$/;
const RETRY = /^(?:please )?(?:try again|retry|let me try again|try it again)$/;

/**
 * `position` is where a move can be made right now (an exercise, Ale's turn), or null.
 * Moves spoken without one are answered with "no-move", never sent to the coach.
 */
export function parseLessonCommand(text: string, position: { fen: string } | null): LessonCommand {
  const s = normalise(text);
  if (!s) return { kind: "empty" };
  if (NEXT.test(s)) return { kind: "next" };
  if (REPEAT.test(s)) return { kind: "repeat" };
  if (RETRY.test(s)) return { kind: "retry" };
  if (LEAVE.test(s)) return { kind: "leave" };
  if (BACK.test(s)) return { kind: "back" };
  if (SKIP.test(s)) return { kind: "skip" };
  const cmd = parseCommand(text, new Chess(position?.fen));
  if (cmd.kind === "review") return { kind: "question", text: text.replace(/\s+/g, " ").trim() };
  if (!position && (cmd.kind === "move" || cmd.kind === "which" || cmd.kind === "bad-move")) {
    return { kind: "no-move" };
  }
  return cmd;
}
