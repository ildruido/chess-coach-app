// The only code that talks to the Anthropic API. The key is held here and never logged or returned.

export class UpstreamError extends Error {
  constructor(readonly status: number) {
    super(`upstream status ${status}`);
  }
}

/** Streams decoded Anthropic events for one Messages API request. Tests inject a fake. */
export type CoachUpstream = (
  params: Record<string, unknown>,
  signal: AbortSignal,
) => AsyncIterable<Record<string, unknown>>;

/** Splits a server-sent-event byte stream into JSON data payloads. */
export async function* sseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Record<string, unknown>> {
  const decoder = new TextDecoder();
  let buf = "";
  const parse = (block: string): Record<string, unknown> | null => {
    const data = block
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!data) return null;
    try {
      const v: unknown = JSON.parse(data);
      return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const ev = parse(buf.slice(0, i));
      buf = buf.slice(i + 2);
      if (ev) yield ev;
    }
  }
  const last = parse(buf);
  if (last) yield last;
}

export function anthropicUpstream(apiKey: string, fetchImpl: typeof fetch = fetch): CoachUpstream {
  return async function* (params, signal) {
    let res: Response;
    try {
      res = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(params),
        signal,
      });
    } catch (err) {
      if (signal.aborted) throw err;
      throw new UpstreamError(0);
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => undefined);
      throw new UpstreamError(res.status);
    }
    yield* sseEvents(res.body);
  };
}
