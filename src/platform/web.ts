// The web app's platform: the shapes the page works with, backed by the
// server's /api routes (docs/API.md). The page's prompts, stores and error branches do not
// change; only this file knows about HTTP.

import { type CoachEvent, errorFromResponse, networkError, readCoachEvents } from "./web-sse";
import { browserDictation, browserSpeechOut } from "./browser-voice";
import type { Platform } from "./types";

type Fetch = typeof fetch;
const json = { "content-type": "application/json" };

let signedOutHandler: () => void = () => globalThis.location?.reload();
let signedOutOnce = false;
/** Tests replace the page reload that follows a lost session. */
export function onSignedOut(handler: () => void): void {
  signedOutHandler = handler;
  signedOutOnce = false;
}

async function request(fetchImpl: Fetch, input: string, init?: RequestInit): Promise<Response> {
  try {
    const res = await fetchImpl(input, { credentials: "same-origin", ...init });
    // The session ended (signed out on another device, or expired): reload, so the page shows
    // the sign-in screen instead of failing on every save. Sign-in's own calls are left alone.
    if (res.status === 401 && !input.startsWith("/api/auth/") && !signedOutOnce) {
      signedOutOnce = true;
      signedOutHandler();
    }
    return res;
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") throw err;
    throw networkError();
  }
}

/** How long the coach may take to start answering before the page calls it a lost connection. */
const FIRST_BYTE_MS = 30_000;

// ---------- documents ----------

const DB_STATUS = {
  429: "resource_exhausted",
  400: "invalid_argument",
  401: "not_granted",
  403: "not_granted",
  413: "invalid_argument",
};

class Snapshot implements DbDocumentSnapshot {
  constructor(
    readonly id: string,
    readonly exists: boolean,
    private readonly value: Record<string, unknown> | undefined,
  ) {}
  data() {
    return this.value;
  }
}

class QueryResult implements DbQuerySnapshot {
  readonly size: number;
  readonly empty: boolean;
  constructor(readonly docs: DbDocumentSnapshot[]) {
    this.size = docs.length;
    this.empty = docs.length === 0;
  }
}

interface Clause {
  field: string;
  op: string;
  value: unknown;
}

export function webDb(fetchImpl: Fetch = fetch): DbApi {
  const call = async (input: string, init?: RequestInit) => {
    const res = await request(fetchImpl, input, init);
    if (!res.ok) throw await errorFromResponse(res, DB_STATUS);
    return res;
  };

  class Query implements DbQuery {
    constructor(
      readonly path: string,
      private readonly spec: {
        where: Clause[];
        orderBy?: { field: string; dir: string };
        limit?: number;
      } = { where: [] },
    ) {}
    where(field: string, op: string, value: unknown): DbQuery {
      return new Query(this.path, {
        ...this.spec,
        where: [...this.spec.where, { field, op, value }],
      });
    }
    orderBy(field: string, dir: "asc" | "desc" = "asc"): DbQuery {
      return new Query(this.path, { ...this.spec, orderBy: { field, dir } });
    }
    limit(n: number): DbQuery {
      return new Query(this.path, { ...this.spec, limit: n });
    }
    async get(): Promise<DbQuerySnapshot> {
      const { where, orderBy, limit } = this.spec;
      const res = await call("/api/db/query", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ path: this.path, ...(where.length && { where }), orderBy, limit }),
      });
      const body = (await res.json()) as { docs: { id: string; data: Record<string, unknown> }[] };
      return new QueryResult(body.docs.map((d) => new Snapshot(d.id, true, d.data)));
    }
  }

  class Collection extends Query implements DbCollectionReference {
    doc(id: string = crypto.randomUUID()): DbDocumentReference {
      return new Doc(`${this.path}/${id}`);
    }
  }

  class Doc implements DbDocumentReference {
    readonly id: string;
    constructor(readonly path: string) {
      this.id = path.slice(path.lastIndexOf("/") + 1);
    }
    private url() {
      return `/api/db/doc?path=${encodeURIComponent(this.path)}`;
    }
    async get(): Promise<DbDocumentSnapshot> {
      const res = await call(this.url());
      const body = (await res.json()) as { exists: boolean; data?: Record<string, unknown> };
      return new Snapshot(this.id, body.exists, body.exists ? body.data : undefined);
    }
    async set(data: Record<string, unknown>): Promise<void> {
      await call(this.url(), { method: "PUT", headers: json, body: JSON.stringify({ data }) });
    }
    async delete(): Promise<void> {
      await call(this.url(), { method: "DELETE" });
    }
    collection(path: string): DbCollectionReference {
      return new Collection(`${this.path}/${path}`);
    }
  }

  return {
    doc: (path) => new Doc(path),
    collection: (path) => new Collection(path),
  };
}

// ---------- the coach ----------

const SAMPLE_STATUS = {
  401: "not_granted",
  403: "capability_disabled",
  413: "prompt_too_large",
  429: "rate_limited",
  503: "capability_removed",
};

export function webSample(fetchImpl: Fetch = fetch): SampleFn {
  return async (call, options = {}) => {
    const { onText, signal } = options;
    const fail = (e: { code: string; message: string }): SampleError => ({
      code: e.code,
      message: e.message,
    });
    // A dead connection (Wi-Fi switched off mid-session) can leave the request hanging for
    // minutes, so give up waiting for the first answer and say the connection is the problem.
    const waiting = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      waiting.abort();
    }, FIRST_BYTE_MS);
    const stopWaiting = () => waiting.abort();
    signal?.addEventListener("abort", stopWaiting, { once: true });
    if (signal?.aborted) stopWaiting();
    let res: Response;
    try {
      res = await request(fetchImpl, "/api/coach/ask", {
        method: "POST",
        headers: json,
        signal: waiting.signal,
        body: JSON.stringify(call),
      });
    } catch (err) {
      if (timedOut && !signal?.aborted) throw fail(networkError());
      if (signal?.aborted) throw { code: "aborted", message: "The request was cancelled." };
      throw fail(err as { code: string; message: string });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stopWaiting);
    }
    if (!res.ok || !res.body) throw fail(await errorFromResponse(res, SAMPLE_STATUS));

    let text = "";
    let done: Extract<CoachEvent, { type: "done" }> | null = null;
    try {
      for await (const ev of readCoachEvents(res.body)) {
        if (ev.type === "text") {
          text += ev.delta;
          onText?.({ text, delta: ev.delta });
        } else if (ev.type === "done") done = ev;
        else throw { ...fail(ev), ...(text && { text }) };
      }
    } catch (err) {
      if (signal?.aborted) throw { code: "aborted", message: "The request was cancelled." };
      if ((err as { code?: string })?.code) throw err;
      throw { ...fail(networkError()), ...(text && { text }) };
    }
    if (!text.trim())
      throw { code: "empty_completion", message: "The coach sent an empty answer." };
    // A stream cut off before its closing event is an incomplete answer.
    if (!done)
      throw { ...fail({ code: "resource_exhausted", message: "The answer stopped early." }), text };
    return {
      text,
      truncated: done.truncated,
      modelTierApplied: done.modelTierApplied,
      ...(done.source && { source: done.source }),
      ...(done.id && { id: done.id }),
    };
  };
}

// ---------- the web platform ----------

export function createWebPlatform(fetchImpl: Fetch = fetch): Platform {
  const db = webDb(fetchImpl);
  const sample = webSample(fetchImpl);
  const user: UserApi = {
    id: async () => {
      try {
        const res = await request(fetchImpl, "/api/auth/me");
        if (!res.ok) return null;
        const body = (await res.json()) as { userId?: unknown };
        return typeof body.userId === "string" ? body.userId : null;
      } catch {
        return null;
      }
    },
  };
  const downloads: DownloadsFn = {
    async save({ filename, data }) {
      const blob = typeof data === "string" ? new Blob([data], { type: "application/json" }) : data;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return { status: "saved" };
    },
  };
  return {
    hasRuntime: () => true,
    sample: async () => sample,
    db: async () => db,
    user: async () => user,
    downloads: async () => downloads,
    voice: () => ({ speechOut: browserSpeechOut, dictation: browserDictation }),
  };
}
