// The history of finished practice games in the player's `db` (the server's database): one
// document per game at data/users/<id>/history/games/<gameId>, in the
// player's own private area.
import { openUserDb, withRetry, type StoreUnavailable } from "./game-store";
import { type HistoryRecord, newestFirst, parseHistoryRecord } from "./history";

/** Games the list fetches, newest first. */
export const HISTORY_LIMIT = 50;

export interface HistoryList {
  records: HistoryRecord[];
  /** Documents that weren't a game this version can read. */
  skipped: number;
}

export interface HistoryStore {
  list(): Promise<HistoryList>;
  save(record: HistoryRecord): Promise<void>;
}

/** Collection path of a viewer's history. */
export function historyPath(userId: string): string {
  return `data/users/${userId}/history/games`;
}

export class DbHistoryStore implements HistoryStore {
  constructor(
    private readonly db: DbApi,
    private readonly userId: string,
  ) {}

  private games() {
    return this.db.collection(historyPath(this.userId));
  }

  async list(): Promise<HistoryList> {
    const snap = await withRetry(() =>
      this.games().orderBy("finishedAt", "desc").limit(HISTORY_LIMIT).get(),
    );
    const records: HistoryRecord[] = [];
    let skipped = 0;
    for (const doc of snap.docs) {
      const r = parseHistoryRecord(doc.data());
      if (r && r.id === doc.id) records.push(r);
      else skipped++;
    }
    return { records: newestFirst(records), skipped };
  }

  save(record: HistoryRecord): Promise<void> {
    return withRetry(() =>
      this.games()
        .doc(record.id)
        .set({ ...record }),
    );
  }
}

export async function openHistoryStore(): Promise<
  { ok: true; store: HistoryStore } | { ok: false; reason: StoreUnavailable }
> {
  const u = await openUserDb();
  return u.ok ? { ok: true, store: new DbHistoryStore(u.db, u.userId) } : u;
}

/** Player-facing text for a history that couldn't be read. New games are still saved. */
export function historyLoadErrorText(err: unknown): string {
  if ((err as DbError)?.code === "not_granted") {
    return "Past games are off: you declined storage for this page. Reload to be asked again.";
  }
  return "Couldn't load your past games. Reload to try again.";
}
