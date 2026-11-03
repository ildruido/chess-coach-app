// POST /api/coach/ask (CC-130, CC-131): the only way to the coach. The page sends what the
// engine reported; the server checks it against the rules, builds the prompt itself, answers
// from the shared knowledge base when it can and calls the model when it must. Nothing a
// player sends is ever a prompt, and nothing is kept for others unless it passed the same
// engine-facts check the page runs.
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type pg from "pg";
import { addUsage } from "./ledger.js";
import { onTopic, questionProblem } from "./guard.js";
import { StreamMapper, mapUpstreamError, type CoachEvent, type ModelIds } from "./mapping.js";
import { PERSONA } from "./persona.js";
import { UpstreamError, type CoachUpstream } from "./upstream.js";
import {
  CALL_POLICY,
  CallError,
  checkReply,
  parseCall,
  renderCall,
  type CoachCall,
} from "../shared/coach/call.js";
import { splitScope } from "../shared/lessons/ask.js";

export interface AskDeps {
  pool: pg.Pool;
  upstream: CoachUpstream;
  models: ModelIds;
  now: () => Date;
}

export function askHandler(deps: AskDeps, release: (id: string) => void) {
  const { pool, upstream, models, now } = deps;

  return async (
    c: Context,
    userId: string,
    body: unknown,
    gate: {
      enabled: (c: Context) => Promise<Response | null>;
      admit: (c: Context) => Promise<Response | null>;
    },
  ): Promise<Response> => {
    let call: CoachCall;
    let prompt: string;
    try {
      call = parseCall(body);
      if (
        (call.purpose === "ask" || call.purpose === "lesson-ask") &&
        questionProblem(call.question)
      )
        throw new CallError("bad question");
    } catch (err) {
      if (err instanceof CallError)
        return c.json({ error: { code: "invalid_request", message: err.message } }, 400);
      throw err;
    }

    const off = await gate.enabled(c);
    if (off) return off;

    // A whole-game review is the one expensive prompt to build: only for a call that is admitted.
    let admitted = false;
    if (call.purpose === "review") {
      const refused = await gate.admit(c);
      if (refused) return refused;
      admitted = true;
    }
    try {
      prompt = renderCall(call);
    } catch (err) {
      if (admitted) release(userId);
      if (err instanceof CallError)
        return c.json({ error: { code: "invalid_request", message: err.message } }, 400);
      throw err;
    }

    if (!admitted) {
      const refused = await gate.admit(c);
      if (refused) return refused;
    }

    const policy = CALL_POLICY[call.purpose];
    const params = {
      model: policy.tier === "quick" ? models.quick : models.default,
      max_tokens: policy.maxTokens,
      system: PERSONA,
      messages: [{ role: "user", content: prompt }],
      stream: true,
    };
    return streamSSE(c, async (stream) => {
      const mapper = new StreamMapper(policy.tier);
      const abort = new AbortController();
      stream.onAbort(() => abort.abort());
      const send = (ev: CoachEvent | (CoachEvent & { source: string; id?: string })) =>
        stream.writeSSE({ data: JSON.stringify(ev) });
      let text = "";
      try {
        for await (const raw of upstream(params, abort.signal)) {
          for (const ev of mapper.push(raw)) {
            if (ev.type === "text") text += ev.delta;
            else if (ev.type === "error") return void (await send(ev));
          }
        }
        const end = mapper.finish();
        if (end.type === "error") return void (await send(end));
        const truncated = end.type === "done" && end.truncated;
        const scoped =
          call.purpose === "ask" || call.purpose === "lesson-ask" ? splitScope(text) : null;
        const answer = (scoped ? scoped.answer : text).trim();
        // Only an answer that passed the engine-facts check and stays on chess is ever shown.
        if (!truncated && !(checkReply(call, answer, false) && onTopic(answer))) {
          return void (await send({
            type: "error",
            code: "refused",
            message: "the coach's answer did not match the engine",
          }));
        }
        await send({ type: "text", delta: answer });
        await send({
          type: "done",
          truncated,
          modelTierApplied: policy.tier,
        });
      } catch (err) {
        if (abort.signal.aborted) return;
        const status = err instanceof UpstreamError ? err.status : 0;
        console.error("coach upstream failed:", status);
        await send({ type: "error", ...mapUpstreamError(status) }).catch(() => undefined);
      } finally {
        abort.abort();
        release(userId);
        await addUsage(pool, userId, mapper.tokens, now()).catch(() =>
          console.error("coach usage not recorded"),
        );
      }
    });
  };
}
