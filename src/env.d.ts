// Types for the capabilities the page works with: `sample`, `db`, `user`, `downloads`.
// The web platform implements them over /api; the e2e build fakes them with `window.claude`.

declare const __APP_VERSION__: string;
/** The e2e test build (`--mode e2e`): the web page with no sign-in and no server. */
declare const __E2E__: boolean;

interface SampleTextUpdate {
  text: string;
  delta: string;
}

interface SampleOptions {
  onText?: (update: SampleTextUpdate) => void;
  signal?: AbortSignal;
}

interface SampleResult {
  text: string;
  truncated: boolean;
  modelTierApplied: "quick" | "default" | "complex";
  /** Where the answer came from: the model ("live") or the shared knowledge base ("kb"). */
  source?: "live" | "kb";
  /** The knowledge-base entry shown, to vote on. */
  id?: string;
}

/** What a rejected sample() call carries. A plain object, not an Error. */
interface SampleError {
  code: string;
  message: string;
  text?: string;
}

/** Asks the coach (docs/API.md "Coach ask"): the page sends engine output, never prompt text. */
type SampleFn = (
  input: import("./coach/call").CoachCall,
  options?: SampleOptions,
) => Promise<SampleResult>;

/** Subset of the `db` capability (runtime db.d.ts is the full reference). */
interface DbError {
  code: string;
  message: string;
}

interface DbDocumentSnapshot {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}

interface DbDocumentReference {
  id: string;
  path: string;
  get(): Promise<DbDocumentSnapshot>;
  set(data: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
  collection(path: string): DbCollectionReference;
}

interface DbQuerySnapshot {
  docs: DbDocumentSnapshot[];
  size: number;
  empty: boolean;
}

interface DbQuery {
  where(field: string, op: string, value: unknown): DbQuery;
  orderBy(field: string, dir?: "asc" | "desc"): DbQuery;
  /** At most `n` documents (1-1000). */
  limit(n: number): DbQuery;
  get(): Promise<DbQuerySnapshot>;
}

interface DbCollectionReference extends DbQuery {
  path: string;
  doc(id?: string): DbDocumentReference;
}

interface DbApi {
  doc(path: string): DbDocumentReference;
  collection(path: string): DbCollectionReference;
}

/** Subset of the `user` capability. Reads never reject. */
interface UserApi {
  /** Opaque per-organization id; null when there is no identity here. */
  id(): Promise<string | null>;
}

/** Subset of the `downloads` capability (no `request`, text or Blob only): offers the player a file; they may decline. */
type DownloadsFn = {
  save(request: {
    filename: string;
    data: string | Blob;
  }): Promise<{ status: "saved" | "delivered" }>;
};

interface ClaudeRuntime {
  use(name: "sample"): Promise<SampleFn | null>;
  use(name: "db"): Promise<DbApi | null>;
  use(name: "user"): Promise<UserApi | null>;
  use(name: "downloads"): Promise<DownloadsFn | null>;
  use(name: string): Promise<unknown>;
}

interface Window {
  claude?: ClaudeRuntime;
}
