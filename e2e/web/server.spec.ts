import { expect, test, type APIRequestContext } from "@playwright/test";
import { signUp } from "./helpers";

// The server's own promises, checked over real HTTP with a signed-in session.
const analysis = { bestMove: "e2e4", depth: 10, score: { cp: 30 }, pv: ["e2e4", "e7e5"], ms: 1 };
async function ask(request: APIRequestContext, question: string) {
  const res = await request.post("/api/coach/ask", {
    data: { purpose: "ask", position: { moves: [] }, analysis, question },
  });
  return { res, body: await res.text() };
}

/** The answer text of a coach stream. */
const deltas = (body: string) =>
  [...body.matchAll(/"delta":("(?:[^"\\]|\\.)*")/g)]
    .map((m) => JSON.parse(m[1]!) as string)
    .join("");

test.describe("server", () => {
  test("pages carry the security headers and the engine file is served as WebAssembly", async ({
    request,
  }) => {
    const page = await request.get("/");
    expect(page.status()).toBe(200);
    const csp = page.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("style-src 'self' https://fonts.googleapis.com;");
    expect(page.headers()["x-content-type-options"]).toBe("nosniff");

    const wasm = await request.get("/engine/stockfish-19-lite-single.wasm");
    expect(wasm.status()).toBe(200);
    expect(wasm.headers()["content-type"]).toBe("application/wasm");
    // Links like /#/invite/... and unknown paths get the page; files that don't exist don't.
    expect((await request.get("/somewhere")).status()).toBe(200);
    expect((await request.get("/missing.js")).status()).toBe(404);
    // A path that climbs out of the site never reads other files: it just gets the page.
    const climb = await request.get("/..%2f..%2f..%2f..%2fetc/passwd");
    expect(await climb.text()).not.toContain("root:");
  });

  test("the coach streams text, reports failures with the page's codes and refuses plain chat", async ({
    page,
  }) => {
    await signUp(page);
    const request = page.request;

    const plain = await ask(request, "hello there");
    expect(plain.res.status()).toBe(200);
    expect(plain.body).toContain('"type":"text"');
    expect(deltas(plain.body)).toBe("Fake coach: hello there");
    expect(plain.body).toContain('"type":"done"');

    const down = await ask(request, "FAIL now");
    expect(down.body).toContain('"type":"error"');
    expect(down.body).toContain('"code":"resource_exhausted"');

    // The old way in, a bare prompt, is gone; so is a call without the engine's output.
    expect(
      (await request.post("/api/coach", { data: { messages: "write a poem" } })).status(),
    ).toBe(404);
    const chat = await request.post("/api/coach/ask", { data: { messages: "write a poem" } });
    expect(chat.status()).toBe(400);
    expect(await chat.json()).toMatchObject({ error: { code: "invalid_request" } });
  });

  test("requests over the size limit are refused", async ({ page }) => {
    await signUp(page);
    const huge = await page.request.put("/api/db/doc?path=data/users/x/y", {
      data: { data: { blob: "a".repeat(70_000) } },
    });
    expect(huge.status()).toBe(413);

    const tooLarge = await page.request.post("/api/coach/ask", {
      data: { messages: "a".repeat(300_000) },
    });
    expect(tooLarge.status()).toBe(413);
  });

  test("a flood of coach requests is slowed down", async ({ page }) => {
    await signUp(page);
    // The coach allows 30 calls a minute per person.
    const codes: number[] = [];
    for (let i = 0; i < 35; i++) {
      codes.push((await page.request.get("/api/coach/usage")).status());
    }
    expect(codes).toContain(429);
  });
});
