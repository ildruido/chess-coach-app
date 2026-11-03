// Past games: the list of finished practice games, newest first, and a
// viewer that replays one move by move and shows its review. A game saved
// without a review can be reviewed from here, on a click; the review is
// then saved with it.
import { mountMiniBoard, type MiniBoard } from "../board/mini-board";
import type { StockfishEngine } from "../engine/stockfish";
import { levelById } from "../engine/strength";
import { movesSoFar, gameAt } from "../chess/notation";
import { isTerminalStoreError, saveErrorText } from "../storage/game-store";
import { type HistoryRecord, historyRow, hintsText, newestFirst } from "../storage/history";
import {
  type HistoryStore,
  historyLoadErrorText,
  openHistoryStore,
} from "../storage/history-store";
import { formatSavedAt } from "../storage/saved-game";
import { replayAt } from "./replay";
import { mountReviewPanel } from "./review-panel";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface HistoryPanel {
  /** The list shows only while no game is being played. */
  setVisible(visible: boolean): void;
  /** Adds or replaces a game (just finished, or newly reviewed) and saves it. */
  record(r: HistoryRecord): void;
}

export function mountHistoryPanel(
  engine: StockfishEngine,
  /** Also told when a game couldn't be saved: the list is hidden while a game is played. */
  onSaveError: (text: string) => void = () => {},
): HistoryPanel {
  const section = $<HTMLElement>("history");
  const status = $<HTMLParagraphElement>("history-status");
  const list = $<HTMLOListElement>("history-list");
  const view = $<HTMLDivElement>("history-view");
  const title = $<HTMLHeadingElement>("history-title");
  const info = $<HTMLParagraphElement>("history-info");
  const plyLabel = $<HTMLParagraphElement>("history-ply");
  const movesEl = $<HTMLParagraphElement>("history-moves");
  const hintsEl = $<HTMLParagraphElement>("history-hints");
  const boardEl = $<HTMLDivElement>("history-board");
  const firstBtn = $<HTMLButtonElement>("history-first");
  const prevBtn = $<HTMLButtonElement>("history-prev");
  const nextBtn = $<HTMLButtonElement>("history-next");
  const lastBtn = $<HTMLButtonElement>("history-last");

  let store: HistoryStore | null = null;
  /** Saves run one at a time, in order, once the store has opened (`ready`). */
  let saving: Promise<void> = Promise.resolve();
  let records: HistoryRecord[] = [];
  let loaded = false;
  let visible = false;
  let open: HistoryRecord | null = null;
  let ply = 0;
  let board: MiniBoard | null = null;
  /** A save or load problem stays shown until the page reloads. */
  let warning = false;

  const review = mountReviewPanel(engine, $("history-review"), {
    subject: () =>
      open && {
        key: `history|${open.id}|${open.finishedAt}`,
        moves: open.moves,
        playerColor: open.color,
        levelLabel: `${open.level} (${levelById(open.level).name})`,
        result: open.result,
        ...(open.review && { saved: open.review }),
      },
    onReviewed: (key, r) => {
      if (open && key === `history|${open.id}|${open.finishedAt}`) {
        record({ ...open, review: r });
      }
    },
  });

  function setStatus(text: string, tone: "info" | "ok" | "warn" = "info") {
    if (warning && tone !== "warn") return;
    if (tone === "warn") warning = true;
    status.textContent = text;
    status.dataset.tone = tone;
  }

  function renderList() {
    list.replaceChildren();
    for (const r of records) {
      const row = historyRow(r);
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "history-row";
      btn.dataset.id = r.id;
      btn.dataset.outcome = r.outcome;
      const when = document.createElement("span");
      when.className = "history-when";
      when.textContent = row.when;
      const outcome = document.createElement("strong");
      outcome.className = "history-outcome";
      outcome.textContent = row.outcome;
      const details = document.createElement("span");
      details.className = "history-details";
      details.textContent = row.details;
      btn.append(outcome, when, details);
      btn.addEventListener("click", () => openGame(r.id));
      li.append(btn);
      list.append(li);
    }
    if (loaded && store && !records.length && !open) {
      setStatus("No finished games yet. Your games appear here when they end.");
    } else if (loaded && store && !open) {
      setStatus(`${records.length} game${records.length === 1 ? "" : "s"}. Open one to replay it.`);
    }
  }

  function sync() {
    section.hidden = !visible || (!store && !status.textContent);
    list.hidden = !!open;
    view.hidden = !open;
    review.sync();
  }

  function showPly(n: number) {
    if (!open) return;
    const step = replayAt(open.moves, n);
    ply = step.ply;
    board?.show(step.fen, step.lastMove);
    plyLabel.textContent = step.label;
    const focused = document.activeElement;
    firstBtn.disabled = prevBtn.disabled = ply === 0;
    nextBtn.disabled = lastBtn.disabled = ply === open.moves.length;
    // A step button that just became disabled would drop the focus to the page.
    if (focused instanceof HTMLButtonElement && focused.disabled) view.focus();
  }

  function openGame(id: string) {
    const r = records.find((x) => x.id === id);
    if (!r) return;
    open = r;
    const row = historyRow(r);
    title.textContent = `${formatSavedAt(r.finishedAt)}: ${row.outcome}`;
    info.textContent = `${r.result} ${row.details.charAt(0).toUpperCase()}${row.details.slice(1)}.`;
    movesEl.textContent = movesSoFar(gameAt({ moves: r.moves })) || "(no moves)";
    hintsEl.textContent = hintsText(r);
    setStatus("");
    sync();
    // The board measures itself, so it is drawn once the viewer shows.
    board?.destroy();
    const end = replayAt(r.moves, r.moves.length);
    board = mountMiniBoard(boardEl, end.fen, r.color, []);
    showPly(r.moves.length);
    view.focus();
  }

  function close(focus = true) {
    const id = open?.id;
    board?.destroy();
    board = null;
    open = null;
    renderList();
    sync();
    if (focus) list.querySelector<HTMLButtonElement>(`button[data-id="${id}"]`)?.focus();
  }

  function record(r: HistoryRecord) {
    records = newestFirst([r, ...records.filter((x) => x.id !== r.id)]);
    if (open?.id === r.id) open = r;
    renderList();
    sync();
    saving = saving.then(async () => {
      await ready;
      const s = store;
      if (!s) return;
      try {
        await s.save(r);
      } catch (err) {
        if (store !== s) return;
        if (isTerminalStoreError(err)) store = null;
        const text = `This game wasn't saved to Past games. ${saveErrorText(err)}`;
        setStatus(text, "warn");
        onSaveError(text);
        sync();
      }
    });
  }

  $("history-back").addEventListener("click", () => close());
  firstBtn.addEventListener("click", () => showPly(0));
  prevBtn.addEventListener("click", () => showPly(ply - 1));
  nextBtn.addEventListener("click", () => showPly(ply + 1));
  lastBtn.addEventListener("click", () => showPly(Number.MAX_SAFE_INTEGER));
  view.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement).closest("#history-review")) return;
    if (e.key === "ArrowLeft") showPly(ply - 1);
    else if (e.key === "ArrowRight") showPly(ply + 1);
    else if (e.key === "Home") showPly(0);
    else if (e.key === "End") showPly(Number.MAX_SAFE_INTEGER);
    else return;
    e.preventDefault();
  });

  const ready = (async () => {
    const opened = await openHistoryStore();
    if (!opened.ok) return;
    store = opened.store;
    try {
      const got = await opened.store.list();
      // Games recorded while the list was loading stay on top.
      const fresh = new Set(records.map((r) => r.id));
      records = newestFirst([...records, ...got.records.filter((r) => !fresh.has(r.id))]);
      loaded = true;
      renderList();
      if (got.skipped) {
        setStatus(
          `${status.textContent} ${got.skipped} saved game${got.skipped === 1 ? "" : "s"} couldn't be read.`,
        );
      }
    } catch (err) {
      if (isTerminalStoreError(err)) store = null;
      setStatus(historyLoadErrorText(err), "warn");
    }
    sync();
  })();

  sync();
  return {
    setVisible(v) {
      visible = v;
      // Starting a game closes the viewer, which also stops a review running there.
      if (!v && open) close(false);
      sync();
    },
    record,
  };
}
