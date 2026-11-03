// Pure translation between the page's coach contract (docs/API.md) and the Anthropic Messages API.

export interface ModelIds {
  quick: string;
  default: string;
}

export type CoachEvent =
  | { type: "text"; delta: string }
  | { type: "done"; truncated: boolean; modelTierApplied: "quick" | "default" }
  | { type: "error"; code: string; message: string };

/** Upstream HTTP status (0 = network failure) to the page's error codes. */
export function mapUpstreamError(status: number): { code: string; message: string } {
  if (status === 401 || status === 403)
    return { code: "capability_removed", message: "the coach is not set up on the server" };
  if (status === 400 || status === 413 || status === 422)
    return { code: "invalid_request", message: "the coach could not take that request" };
  return { code: "resource_exhausted", message: "the coach is busy, try again later" };
}

/** Folds Anthropic stream events into page events and token usage. */
export class StreamMapper {
  inputTokens = 0;
  outputTokens = 0;
  private stop: string | null = null;
  private sawText = false;
  private sawStop = false;
  private textChars = 0;

  constructor(private readonly tier: "quick" | "default") {}

  /** Input plus output; a cut-off stream never reports its final count, so estimate from the text. */
  get tokens(): number {
    return this.inputTokens + Math.max(this.outputTokens, Math.ceil(this.textChars / 4));
  }

  /** Feeds one decoded Anthropic event; returns page events to send now. */
  push(ev: Record<string, unknown>): CoachEvent[] {
    const out: CoachEvent[] = [];
    switch (ev.type) {
      case "message_start": {
        const u = (ev.message as { usage?: Record<string, number> } | undefined)?.usage;
        if (u)
          this.inputTokens =
            (u.input_tokens ?? 0) +
            (u.cache_creation_input_tokens ?? 0) +
            (u.cache_read_input_tokens ?? 0);
        this.outputTokens = u?.output_tokens ?? 0;
        break;
      }
      case "content_block_delta": {
        const d = ev.delta as { type?: string; text?: string } | undefined;
        if (d?.type === "text_delta" && d.text) {
          this.sawText = true;
          this.textChars += d.text.length;
          out.push({ type: "text", delta: d.text });
        }
        break;
      }
      case "message_delta": {
        const d = ev.delta as { stop_reason?: string } | undefined;
        if (d?.stop_reason) this.stop = d.stop_reason;
        const u = ev.usage as Record<string, number> | undefined;
        if (u?.output_tokens !== undefined) this.outputTokens = u.output_tokens;
        break;
      }
      case "message_stop":
        this.sawStop = true;
        break;
      case "error":
        out.push({
          type: "error",
          code: "resource_exhausted",
          message: "the coach is busy, try again later",
        });
        break;
    }
    return out;
  }

  /** The closing event, or an error when the model said nothing at all. */
  finish(): CoachEvent {
    if (!this.sawStop)
      return {
        type: "error",
        code: "resource_exhausted",
        message: "the coach stopped early, try again",
      };
    if (!this.sawText)
      return { type: "error", code: "empty_completion", message: "the coach returned nothing" };
    if (this.stop === "refusal")
      return { type: "error", code: "refused", message: "the coach declined to answer" };
    return { type: "done", truncated: this.stop === "max_tokens", modelTierApplied: this.tier };
  }
}
