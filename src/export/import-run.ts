// Writes an import plan (import-data.ts) into the signed-in player's documents.
//
// Nothing already there is overwritten: a game, past game, lesson or coach answer that
// exists is kept and the file's copy is skipped, so importing the same file twice, or
// into an account that has been used, is safe. Requests are paced under the server's
// limit of 600 document requests a minute, and an import that stops can simply be run again.

import { type ImportCounts, type PlannedDoc, countDocs, emptyCounts } from "./import-data";

/** About 6 requests a second, well under the 600 a minute the server allows. */
const GAP_MS = 160;
const BUSY_WAIT_MS = 12_000;
const BUSY_TRIES = 5;
const QUERY_LIMIT = 1000;

export interface ImportOutcome {
  added: ImportCounts;
  /** Records skipped because the same one is already in the account. */
  existing: number;
  /** Null when everything was handled; else the code of the error that stopped it. */
  stoppedBy: string | null;
}

export interface RunOptions {
  onProgress?: (done: number, total: number) => void;
  sleep?: (ms: number) => Promise<void>;
}

const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/"));
const idOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

export async function runImport(
  db: DbApi,
  docs: readonly PlannedDoc[],
  options: RunOptions = {},
): Promise<ImportOutcome> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last = 0;
  /** One paced request; waits and tries again only when the server says it is busy. */
  const call = async <T>(fn: () => Promise<T>): Promise<T> => {
    for (let attempt = 1; ; attempt++) {
      const wait = last + GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      try {
        return await fn();
      } catch (err) {
        if ((err as DbError)?.code !== "resource_exhausted" || attempt >= BUSY_TRIES) throw err;
        await sleep(BUSY_WAIT_MS);
      }
    }
  };

  const written: PlannedDoc[] = [];
  let existing = 0;
  let stoppedBy: string | null = null;
  let done = 0;
  const step = () => options.onProgress?.(++done, docs.length);

  // Which ids already exist, one query per collection. A full page may be cut short, so
  // those (and the two game slots, which are documents) are checked one document at a time.
  const known = new Map<string, Set<string> | null>();
  const exists = async (d: PlannedDoc): Promise<boolean> => {
    const parent = parentOf(d.path);
    if (d.section !== "games") {
      if (!known.has(parent)) {
        const snap = await call(() => db.collection(parent).limit(QUERY_LIMIT).get());
        known.set(
          parent,
          snap.docs.length >= QUERY_LIMIT ? null : new Set(snap.docs.map((x) => x.id)),
        );
      }
      const ids = known.get(parent);
      if (ids) return ids.has(idOf(d.path));
    }
    return (await call(() => db.doc(d.path).get())).exists;
  };

  try {
    for (const d of docs) {
      if (await exists(d)) existing++;
      else {
        await call(() => db.doc(d.path).set(d.data));
        written.push(d);
      }
      step();
    }
  } catch (err) {
    stoppedBy = (err as DbError)?.code ?? "unknown";
  }

  return { added: written.length ? countDocs(written) : emptyCounts(), existing, stoppedBy };
}
