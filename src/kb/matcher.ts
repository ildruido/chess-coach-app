// The one similarity matcher of the knowledge base (CC-031). Any feature asks
// it for a reusable entry; it balances accuracy against tokens saved:
//   1. same kind and group, same place (unless the entry is `wide`), no 👎;
//   2. the hard facts of the text (squares, pieces, moves) exactly equal;
//   3. the words compared (kb/words.ts): CLOSE is reused, NEAR is only offered.
// Entries with no text (hints, comments, reviews) match on the exact key alone.
// A future similarity graph replaces this file; callers do not change.

import type { KbEntry, KbKind } from "./entry";
import { similarity, wordWeights } from "./words";

/** "Balanced": clear rewordings are reused at once. */
export const CLOSE = 0.8;
/** Below CLOSE, from here a saved answer is only offered ("Did you mean ...?"). */
export const NEAR = 0.5;

/** What a feature is looking for. */
export interface KbQuery {
  kind: KbKind;
  group: string;
  ctx: string;
  /** The question; empty when the key says everything. */
  text: string;
}

export type Match =
  { kind: "close"; entry: KbEntry } | { kind: "near"; entry: KbEntry } | { kind: "none" };

/** Whether an entry may be reused here at all, before its words are compared. */
export function applies(e: KbEntry, q: KbQuery): boolean {
  if (e.vote < 0 || e.kind !== q.kind || e.group !== q.group) return false;
  return e.wide || e.ctx === q.ctx;
}

/** The best entry for a query: close, near, or none. */
export function findEntry(q: KbQuery, entries: readonly KbEntry[]): Match {
  const pool = entries.filter((e) => applies(e, q));
  if (!pool.length) return { kind: "none" };
  const keyOnly = !q.text;
  const weight = wordWeights(
    entries.filter((e) => e.kind === q.kind && e.group === q.group).map((e) => e.text),
  );
  let best: { entry: KbEntry; score: number; rank: number[] } | null = null;
  for (const entry of pool) {
    const score = keyOnly ? (entry.text ? 0 : 1) : similarity(q.text, entry.text, weight);
    // Ties: the same place first, then 👍, then the newest.
    const rank = [score, entry.ctx === q.ctx ? 1 : 0, entry.vote, Date.parse(entry.createdAt) || 0];
    if (!best || compare(rank, best.rank) > 0) best = { entry, score, rank };
  }
  if (!best || best.score < NEAR) return { kind: "none" };
  return { kind: best.score >= CLOSE ? "close" : "near", entry: best.entry };
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

/** Entries of a kind that apply here, oldest first (the order they were given). */
export function listEntries(q: KbQuery, entries: readonly KbEntry[]): KbEntry[] {
  return entries
    .filter((e) => applies(e, q))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
