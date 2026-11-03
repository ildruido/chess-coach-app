// What the server refuses before it spends anything (CC-130), and what it will not keep for
// other players (CC-131). Pure functions, unit tested.

/** Text that has no place in a chess question: links, markup, code. */
const NOT_A_QUESTION =
  /https?:|www\.|`|<\/?\w|\{\{|\bignore (?:all |the |any )?(?:previous|above)/i;

/** Why a typed question is refused outright, or null. */
export function questionProblem(question: string): string | null {
  if (NOT_A_QUESTION.test(question)) return "not a chess question";
  if (!/[a-z]/i.test(question)) return "not a chess question";
  return null;
}

/** A long answer must talk about chess: a stray instruction in a free-text field can't turn it into something else. */
const CHESS_WORDS =
  /\b(?:chess|pawns?|knights?|bishops?|rooks?|queens?|kings?|castl\w*|check\w*|mate|stalemate|draw|fork\w*|pins?|skewers?|tactics?|opening|gambit|endgame|middlegame|centre|center|files?|ranks?|diagonals?|squares?|capture\w*|attack\w*|defen[cs]\w*|threat\w*|develop\w*|promot\w*|passant|material|blunder|mistake|engine|move|moves|position|board|sacrifice|exchange|trade|hang\w*|protect\w*|piece|pieces|opponent|tempo)\b/i;

export function onTopic(answer: string): boolean {
  if (answer.split(/\s+/).length <= 14) return true;
  return CHESS_WORDS.test(answer);
}
