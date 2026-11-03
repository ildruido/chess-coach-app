// Saves the game in progress to the player's `db` (the server's database),
// in their own private area (data/users/<id>/...), which nobody else can read.
import { type SavedGame, parseSavedGame } from "./saved-game";
import { getPlatform } from "../platform";

/** What a load found. "unreadable": a document exists but isn't a game this version can read. */
export type LoadResult =
  { status: "none" } | { status: "ok"; game: SavedGame } | { status: "unreadable" };

export interface GameStore {
  load(): Promise<LoadResult>;
  save(game: SavedGame): Promise<void>;
}

export type StoreResult = { ok: true; store: GameStore } | { ok: false; reason: StoreUnavailable };

/** Which saved game: the practice game in progress, or the old `current-game` slot (kept for export/import). */
export type GameSlot = "current-game" | "practice-game";

/** Path of a saved game: data/users/<id>/<slot> (a document). */
export function currentGamePath(userId: string, slot: GameSlot = "current-game"): string {
  return `data/users/${userId}/${slot}`;
}

export class DbGameStore implements GameStore {
  constructor(
    private readonly db: DbApi,
    private readonly userId: string,
    private readonly slot: GameSlot = "current-game",
  ) {}

  private ref() {
    return this.db.doc(currentGamePath(this.userId, this.slot));
  }

  async load(): Promise<LoadResult> {
    const snap = await withRetry(() => this.ref().get());
    if (!snap.exists) return { status: "none" };
    const game = parseSavedGame(snap.data());
    return game ? { status: "ok", game } : { status: "unreadable" };
  }

  save(game: SavedGame): Promise<void> {
    return withRetry(() => this.ref().set({ ...game }));
  }
}

/** Codes where trying again cannot help: stop using the store for this page load. */
const TERMINAL = new Set([
  "not_granted",
  "revoked",
  "capability_disabled",
  "capability_removed",
  "invalid_argument",
  "transform_error",
  "quota_exceeded",
]);

/** Known codes that are never retried: the terminal ones, plus resource_exhausted (retrying fast can't help). */
const KNOWN_NON_TRANSIENT = new Set([...TERMINAL, "resource_exhausted"]);

export function isTerminalStoreError(err: unknown): boolean {
  return TERMINAL.has((err as DbError)?.code);
}

/**
 * Retries once after a short randomized delay for `unavailable`, and, as the
 * db contract says, for unknown codes too. Never for known non-transient codes.
 */
export async function withRetry<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (KNOWN_NON_TRANSIENT.has((err as DbError)?.code)) throw err;
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 700));
    return call();
  }
}

export type StoreUnavailable = "no-runtime" | "no-db" | "no-identity";

export type UserDb =
  { ok: true; db: DbApi; userId: string } | { ok: false; reason: StoreUnavailable };

/** The db and the player's id; or why saving is off. */
export async function openUserDb(): Promise<UserDb> {
  const platform = getPlatform();
  if (!platform.hasRuntime()) return { ok: false, reason: "no-runtime" };
  const [db, user] = await Promise.all([platform.db(), platform.user()]);
  if (!db) return { ok: false, reason: "no-db" };
  const userId = (await user?.id()) ?? null;
  if (!userId) return { ok: false, reason: "no-identity" };
  return { ok: true, db, userId };
}

/** Connects to the store, or says why saving is off in this view. */
export async function openGameStore(slot: GameSlot = "current-game"): Promise<StoreResult> {
  const u = await openUserDb();
  return u.ok ? { ok: true, store: new DbGameStore(u.db, u.userId, slot) } : u;
}

export function storeUnavailableText(reason: StoreUnavailable): string {
  switch (reason) {
    case "no-runtime":
      return "Saving is off: storage isn't available in this view.";
    case "no-db":
      return "Saving is off: storage isn't available in this view.";
    case "no-identity":
      return "Saving is off: sign in to save games.";
  }
}

/** Player-facing text for a failed load. Saving stays paused so nothing is overwritten. */
export function loadErrorText(err: unknown): string {
  if ((err as DbError)?.code === "not_granted") {
    return "Saving is off: you declined storage for this page. Reload to be asked again.";
  }
  return "Couldn't load your saved game. Saving is paused so it isn't overwritten. Reload to try again.";
}

/** Player-facing text for a failed save, by db error code. */
export function saveErrorText(err: unknown): string {
  switch ((err as DbError)?.code) {
    case "not_granted":
      return "Saving is off: you declined storage for this page. Reload to be asked again.";
    case "quota_exceeded":
      return "Saving is off: this page's storage is full.";
    case "revoked":
      return "Saving stopped: this page's storage access changed. Reload the page.";
    case "resource_exhausted":
      return "Saving too often. Your next move or new game will save again.";
    case "invalid_argument":
    case "transform_error":
    case "capability_disabled":
    case "capability_removed":
      return "Saving is off: this game couldn't be stored. Reload the page.";
    default:
      return "Couldn't save just now. Your next move or new game will try again.";
  }
}
