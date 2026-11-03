// The knowledge base as features see it (CC-031): save, find, feedback.
// Entries of a group are loaded once and kept in memory; writes go to the
// backend in the background. Reading and writing never block a feature: a
// failure just means no reuse (the question goes to the coach).

import { domainOf, type KbEntry, type KbKind, newEntryId } from "./entry";
import { findEntry, listEntries, type KbQuery, type Match } from "./matcher";
import { DbBackend, type KbBackend } from "./store";
import { getPlatform } from "../platform";

/** What a feature hands over to save; the base adds id, time, reuses and vote. */
export type NewEntry = Omit<KbEntry, "v" | "id" | "createdAt" | "reuses" | "vote" | "related">;

/** Reused answers and coach calls this visit, per kind (the diagnostics line). */
export interface Tally {
  reused: number;
  asked: number;
}

export class KnowledgeBase {
  /** The last storage failure, for the diagnostics line: "load: not_granted". Null while storage works. */
  problem: string | null = null;
  /** No db in this view: entries are kept only for this visit. */
  offline = false;
  private readonly groups = new Map<string, KbEntry[]>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly tallies = new Map<KbKind, Tally>();
  private backend: Promise<KbBackend | null> | null = null;
  /** One write at a time, so an entry's later change always lands last. */
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly open: () => Promise<KbBackend | null> = openBackend) {}

  private connect() {
    this.backend ??= this.open().catch(() => null);
    return this.backend;
  }

  private keyOf(kind: KbKind, group: string) {
    return `${domainOf(kind)}.${group}`;
  }

  /**
   * Loads a group's entries (once per visit). Without storage, or after a failed
   * load, it stays empty for the visit: questions just go to the coach.
   */
  load(kind: KbKind, group: string): Promise<void> {
    const key = this.keyOf(kind, group);
    let p = this.loading.get(key);
    if (!p) {
      this.groups.set(key, []);
      p = this.fetch(key, domainOf(kind), group);
      this.loading.set(key, p);
    }
    return p;
  }

  private async fetch(key: string, domain: string, group: string): Promise<void> {
    const backend = await this.connect();
    this.offline = !backend;
    if (!backend) return;
    try {
      const found = await backend.load(domain, group);
      // Entries saved while the load was running stay too.
      const here = this.groups.get(key) ?? [];
      const ids = new Set(here.map((e) => e.id));
      this.groups.set(key, [...here, ...found.filter((e) => !ids.has(e.id))]);
    } catch (err) {
      this.problem = `load: ${(err as DbError)?.code ?? "error"}`;
    }
  }

  /** Every loaded entry of the group. */
  entries(kind: KbKind, group: string): readonly KbEntry[] {
    return this.groups.get(this.keyOf(kind, group)) ?? [];
  }

  /** The best reusable entry among those loaded: close, near, or none. */
  find(q: KbQuery): Match {
    return findEntry(q, this.entries(q.kind, q.group));
  }

  /** Reusable entries of this kind here, oldest first. */
  list(q: KbQuery): KbEntry[] {
    return listEntries(q, this.entries(q.kind, q.group));
  }

  /** Saves a new coach answer. It counts as a coach call in the diagnostics line. */
  save(input: NewEntry): KbEntry {
    const entry: KbEntry = {
      ...input,
      v: 2,
      id: newEntryId(),
      createdAt: new Date().toISOString(),
      reuses: 0,
      vote: 0,
    };
    const key = this.keyOf(entry.kind, entry.group);
    this.groups.set(key, [...(this.groups.get(key) ?? []), entry]);
    this.tally(entry.kind).asked++;
    this.write(entry);
    return entry;
  }

  /** Feedback: the entry was shown again instead of asking the coach, or got a 👍 / 👎. */
  feedback(entry: KbEntry, change: "reused" | { vote: -1 | 0 | 1 }): void {
    if (change === "reused") {
      entry.reuses++;
      this.tally(entry.kind).reused++;
    } else entry.vote = change.vote;
    this.write(entry);
  }

  counts(kind: KbKind): Tally {
    return { ...this.tally(kind) };
  }

  /** The diagnostics line for a feature: "Lesson questions: 2 reused, 1 asked the coach." */
  diagLine(label: string, ...kinds: KbKind[]): string {
    const t = kinds.map((k) => this.tally(k));
    const reused = t.reduce((s, x) => s + x.reused, 0);
    const asked = t.reduce((s, x) => s + x.asked, 0);
    const trouble = this.offline
      ? " Storage is off in this view."
      : this.problem
        ? ` Storage failed (${this.problem}).`
        : "";
    return `${label}: ${reused} reused, ${asked} asked the coach.${trouble}`;
  }

  private tally(kind: KbKind): Tally {
    let t = this.tallies.get(kind);
    if (!t) this.tallies.set(kind, (t = { reused: 0, asked: 0 }));
    return t;
  }

  private write(entry: KbEntry) {
    const copy = { ...entry };
    this.writing = this.writing.then(async () => {
      const backend = await this.connect();
      try {
        await backend?.save(copy);
      } catch (err) {
        // Silent for the player: the answer still works for the rest of this visit.
        this.problem = `save: ${(err as DbError)?.code ?? "error"}`;
      }
    });
  }

  /** Resolves once every write so far has finished (tests). */
  settled(): Promise<void> {
    return this.writing;
  }
}

export async function openBackend(): Promise<KbBackend | null> {
  // The shared knowledge base is the server's (CC-131): players cannot write it, so in the web app
  // this one only remembers answers for the visit. The e2e build keeps the db-backed store its
  // specs exercise until the single coach component replaces these panels.
  if (!__E2E__) return null;
  const db = await getPlatform().db();
  return db ? new DbBackend(db) : null;
}

/** The one knowledge base of the page. */
export const knowledge = new KnowledgeBase();
