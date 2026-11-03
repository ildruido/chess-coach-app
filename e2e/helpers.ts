import type { Page } from "@playwright/test";

/** Screen point at the centre of a square on a board, honouring its orientation. */
export async function squarePoint(
  page: Page,
  boardId: string,
  square: string,
  orientation: "white" | "black" = "white",
) {
  const board = page.locator(`#${boardId}`);
  await board.scrollIntoViewIfNeeded();
  // The board re-measures itself after a scroll; let it settle before clicking.
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const box = (await board.boundingBox())!;
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const col = orientation === "white" ? file : 7 - file;
  const row = orientation === "white" ? 7 - rank : rank;
  const size = box.width / 8;
  return { x: box.x + (col + 0.5) * size, y: box.y + (row + 0.5) * size };
}

/** Tap the piece, then its destination: touch taps when `touch`, else clicks. */
export async function tapMove(
  page: Page,
  boardId: string,
  from: string,
  to: string,
  touch: boolean,
  orientation: "white" | "black" = "white",
) {
  for (const sq of [from, to]) {
    const p = await squarePoint(page, boardId, sq, orientation);
    if (touch) await page.touchscreen.tap(p.x, p.y);
    else await page.mouse.click(p.x, p.y);
  }
}

/** Fake db + user capabilities backed by localStorage, so saves survive reloads. */
export async function installFakeStore(page: Page, userId: string | null) {
  await page.addInitScript((uid: string | null) => {
    const KEY = "fake-db";
    const read = (): Record<string, unknown> => JSON.parse(localStorage.getItem(KEY) ?? "{}");
    const write = (all: Record<string, unknown>) => localStorage.setItem(KEY, JSON.stringify(all));
    // Like the real db: a document path is collection/document pairs, so an
    // odd number of segments is refused.
    const docPathError = (path: string) =>
      path.split("/").length % 2 ? { code: "invalid_path", message: path } : null;
    const doc = (path: string) => ({
      id: path.split("/").at(-1),
      path,
      get: async () => {
        const bad = docPathError(path);
        if (bad) throw bad;
        if (localStorage.getItem("fake-db-fail-get")) {
          throw { code: "unavailable", message: "down" };
        }
        const d = read()[path];
        return { id: path, exists: d !== undefined, data: () => d };
      },
      set: async (data: unknown) => {
        const bad = docPathError(path);
        if (bad) throw bad;
        // "fake-db-fail-set" = an error code; "fake-db-fail-set-path" limits it to paths containing it.
        const code = localStorage.getItem("fake-db-fail-set");
        if (code && path.includes(localStorage.getItem("fake-db-fail-set-path") ?? "")) {
          throw { code, message: "refused" };
        }
        write({ ...read(), [path]: data });
      },
      delete: async () => {
        const all = read();
        delete all[path];
        write(all);
      },
      collection: (sub: string) => collection(`${path}/${sub}`),
    });
    // Collection queries: orderBy one field, limit, get.
    type Order = { field: string; dir: string } | null;
    const query = (path: string, order: Order, max: number) => ({
      orderBy: (field: string, dir = "asc") => query(path, { field, dir }, max),
      limit: (n: number) => query(path, order, n),
      get: async () => {
        if (localStorage.getItem("fake-db-fail-list")) {
          throw { code: "unavailable", message: "down" };
        }
        const all = read() as Record<string, Record<string, unknown>>;
        const depth = path.split("/").length + 1;
        let keys = Object.keys(all).filter(
          (k) => k.startsWith(`${path}/`) && k.split("/").length === depth,
        );
        keys.sort();
        if (order) {
          const v = (k: string) => String(all[k]![order.field] ?? "");
          keys.sort((a, b) => v(a).localeCompare(v(b)) * (order.dir === "desc" ? -1 : 1));
        }
        keys = keys.slice(0, max);
        const docs = keys.map((k) => ({
          id: k.split("/").at(-1),
          exists: true,
          data: () => all[k],
        }));
        return { docs, size: docs.length, empty: !docs.length };
      },
    });
    const collection = (path: string) => ({
      ...query(path, null, 1000),
      path,
      doc: (id: string) => doc(`${path}/${id}`),
    });
    const db = { doc, collection };
    const user = { id: async () => uid };
    (window as unknown as { claude: unknown }).claude = {
      use: async (name: string) => (name === "db" ? db : name === "user" ? user : null),
    };
  }, userId);
}

/**
 * Replaces the Stockfish worker with a scripted one, so a whole game against
 * the engine plays out the same way every time. `replies` maps a UCI position
 * command ("position fen … moves …") to the engine's move there, with its
 * score for the side to move ("cp 0", "mate 1"); any other position gets no move.
 */
export async function installFakeEngine(
  page: Page,
  replies: Record<string, { move: string; score?: string }>,
) {
  await page.addInitScript((script) => {
    class FakeEngine {
      onmessage: ((e: { data: string }) => void) | null = null;
      onerror: unknown = null;
      private position = "";
      private say(...lines: string[]) {
        setTimeout(() => lines.forEach((data) => this.onmessage?.({ data })), 5);
      }
      postMessage(cmd: string) {
        if (cmd === "uci") this.say("id name Fake engine", "uciok");
        else if (cmd === "isready") this.say("readyok");
        else if (cmd.startsWith("position")) this.position = cmd;
        else if (cmd.startsWith("go")) {
          const r = script[this.position];
          this.say(
            r
              ? `info depth 20 score ${r.score ?? "cp 0"} pv ${r.move}`
              : "info depth 20 score cp 0",
            `bestmove ${r?.move ?? "(none)"}`,
          );
        }
      }
      terminate() {}
      addEventListener() {}
      removeEventListener() {}
    }
    (window as unknown as { Worker: unknown }).Worker = FakeEngine;
  }, replies);
}

/** Scripted replies for a line: after each of the player's moves, the opponent's next one. */
export function scriptLine(fen: string, line: string): Record<string, { move: string }> {
  const moves = line.split(" ");
  const out: Record<string, { move: string }> = {};
  for (let i = 0; i + 1 < moves.length; i += 2) {
    out[`position fen ${fen} moves ${moves.slice(0, i + 1).join(" ")}`] = { move: moves[i + 1]! };
  }
  return out;
}

/** Turns the coach diagnostics switch on before the page loads (CC-051). */
export async function showDiagnostics(page: Page) {
  await page.addInitScript(() => localStorage.setItem("chess-coach.diagnostics", "1"));
}
