// DOM-free helpers for the web platform (docs/API.md): reading the coach's event stream
// and turning server failures into the error shapes the page already branches on.

export type CoachEvent =
  | { type: "text"; delta: string }
  | {
      type: "done";
      truncated: boolean;
      modelTierApplied: "quick" | "default" | "complex";
      source?: "live" | "kb";
      id?: string;
    }
  | { type: "error"; code: string; message: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Validates one decoded event; anything the page doesn't know is dropped. */
export function parseCoachEvent(data: string): CoachEvent | null {
  let v: unknown;
  try {
    v = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isObj(v)) return null;
  switch (v.type) {
    case "text":
      return typeof v.delta === "string" ? { type: "text", delta: v.delta } : null;
    case "done":
      return {
        type: "done",
        truncated: v.truncated === true,
        modelTierApplied:
          v.modelTierApplied === "default" || v.modelTierApplied === "complex"
            ? v.modelTierApplied
            : "quick",
        ...((v.source === "live" || v.source === "kb") && { source: v.source }),
        ...(typeof v.id === "string" && { id: v.id }),
      };
    case "error":
      return {
        type: "error",
        code: typeof v.code === "string" ? v.code : "internal",
        message: typeof v.message === "string" ? v.message : "The coach could not answer.",
      };
    default:
      return null;
  }
}

/** Splits a server-sent-event byte stream into coach events. */
export async function* readCoachEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<CoachEvent> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buf = "";
  const parse = (block: string) => {
    const data = block
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    return data ? parseCoachEvent(data) : null;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf = (buf + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const ev = parse(buf.slice(0, i));
        buf = buf.slice(i + 2);
        if (ev) yield ev;
      }
    }
    const last = parse(buf);
    if (last) yield last;
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

/** The server's `{error:{code,message}}` body, or a code made from the status. */
export async function errorFromResponse(
  res: Response,
  statusCodes: Record<number, string>,
): Promise<{ code: string; message: string }> {
  try {
    const body: unknown = await res.json();
    const err = isObj(body) && isObj(body.error) ? body.error : null;
    if (err && typeof err.code === "string") {
      // Sign-in problems reach the page as "not granted" so its existing branches apply.
      const code = err.code === "unauthenticated" ? "not_granted" : err.code;
      return { code, message: typeof err.message === "string" ? err.message : code };
    }
  } catch {
    // Not JSON: fall through to the status.
  }
  const code = statusCodes[res.status] ?? "resource_exhausted";
  return { code, message: `The server answered ${res.status}.` };
}

/**
 * Fetch failures (offline, server unreachable) carry no status. The browser's online flag can't
 * be trusted (it stays true with a VPN or virtual adapter up), so any failure to get an answer
 * from the server is reported as offline.
 */
export const networkError = (): { code: string; message: string } => ({
  code: "offline",
  message: "Could not reach the server. Check your connection and try again.",
});
