import { describe, expect, it } from "vitest";
import { monthStart, resetsAt } from "../src/coach/ledger.js";
import { StreamMapper, mapUpstreamError } from "../src/coach/mapping.js";
import { sseEvents } from "../src/coach/upstream.js";

describe("StreamMapper", () => {
  const run = (evs: Record<string, unknown>[], tier: "quick" | "default" = "quick") => {
    const m = new StreamMapper(tier);
    return { m, out: evs.flatMap((e) => m.push(e)) };
  };
  it("streams text, counts tokens and flags truncation", () => {
    const { m, out } = run([
      {
        type: "message_start",
        message: { usage: { input_tokens: 10, cache_read_input_tokens: 5, output_tokens: 1 } },
      },
      { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } },
      { type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 7 } },
      { type: "message_stop" },
    ]);
    expect(out).toEqual([
      { type: "text", delta: "Hel" },
      { type: "text", delta: "lo" },
    ]);
    expect(m.tokens).toBe(22);
    expect(m.finish()).toEqual({ type: "done", truncated: true, modelTierApplied: "quick" });
  });
  it("reports empty and refused answers", () => {
    expect(run([{ type: "message_stop" }]).m.finish()).toMatchObject({
      code: "empty_completion",
    });
    expect(run([]).m.finish()).toMatchObject({ code: "resource_exhausted" });
    const { m } = run([
      { type: "content_block_delta", delta: { type: "text_delta", text: "x" } },
      { type: "message_delta", delta: { stop_reason: "refusal" } },
      { type: "message_stop" },
    ]);
    expect(m.finish()).toMatchObject({ code: "refused" });
  });
});

describe("errors and months", () => {
  it("maps upstream statuses", () => {
    expect(mapUpstreamError(401).code).toBe("capability_removed");
    expect(mapUpstreamError(400).code).toBe("invalid_request");
    expect(mapUpstreamError(429).code).toBe("resource_exhausted");
    expect(mapUpstreamError(0).code).toBe("resource_exhausted");
  });
  it("uses UTC months", () => {
    const d = new Date("2026-12-31T23:59:59Z");
    expect(monthStart(d)).toBe("2026-12-01");
    expect(resetsAt(d)).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("sseEvents", () => {
  it("parses events split across chunks", async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(ctl) {
        ctl.enqueue(enc.encode('event: a\ndata: {"type":"x"}\n\ndata: {"ty'));
        ctl.enqueue(enc.encode('pe":"y"}\r\n\r\n'));
        ctl.close();
      },
    });
    const got: unknown[] = [];
    for await (const e of sseEvents(body)) got.push(e);
    expect(got).toEqual([{ type: "x" }, { type: "y" }]);
  });
});
