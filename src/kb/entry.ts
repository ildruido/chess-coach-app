// One entry of the coach knowledge base (CC-031). Every kind of coach content
// (a lesson question, a practice hint, a move comment, a game review) is saved
// in this one shape, so new kinds can be added without a new database layout.

/** What an entry is. A new kind is a new string here and a context builder in contexts.ts. */
export type KbKind = "ask" | "reword" | "hint" | "commentary" | "review";

export const KB_KINDS: readonly KbKind[] = ["ask", "reword", "hint", "commentary", "review"];

export interface KbEntry {
  v: 2;
  id: string;
  kind: KbKind;
  /** The set of entries it lives with: a lesson id, or a position bucket. Entries are loaded by group. */
  group: string;
  /** Where the answer was given, as an exact key: a step, a position and stage, a move played. */
  ctx: string;
  /** True: reusable anywhere in its group (a general question). False: only where `ctx` matches. */
  wide: boolean;
  /** The question; empty for kinds driven by the engine alone. */
  text: string;
  answer: string;
  createdAt: string;
  /** How many times the answer was shown again instead of asking the coach. */
  reuses: number;
  /** The player's 👍 (1) or 👎 (-1). A 👎 stops the answer being reused. */
  vote: -1 | 0 | 1;
  /** Facts kept for the engineer and the future server, per kind (lesson id, best move, ...). */
  meta: Record<string, string | number | null>;
  /** Reserved for a similarity graph: ids of related entries. Never written yet. */
  related?: string[];
}

/** Entries of kinds that share a group are stored together. */
export function domainOf(kind: KbKind): string {
  return kind === "ask" || kind === "reword" ? "lesson" : kind;
}

/** A new entry's id: time first, so ids sort roughly by age. */
export function newEntryId(now = Date.now()): string {
  return `${now.toString(36).padStart(9, "0")}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Reads a stored entry; anything malformed is dropped. */
export function parseEntry(data: unknown): KbEntry | null {
  const d = data as Partial<KbEntry> | undefined;
  if (!d || d.v !== 2) return null;
  if (!KB_KINDS.includes(d.kind as KbKind)) return null;
  const str = (x: unknown) => typeof x === "string" && x.length > 0;
  if (![d.id, d.group, d.ctx, d.answer, d.createdAt].every(str)) return null;
  if (typeof d.text !== "string" || typeof d.wide !== "boolean") return null;
  if (typeof d.reuses !== "number") return null;
  if (d.vote !== -1 && d.vote !== 0 && d.vote !== 1) return null;
  if (!d.meta || typeof d.meta !== "object") return null;
  return d as KbEntry;
}
