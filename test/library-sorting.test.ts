import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Storage } from "../src/storage.js";
import { executeCommand } from "../src/executor.js";
import { handleInput } from "../src/input.js";
import { renderOverlay } from "../src/tui.js";
import { renderLibraryModal } from "../src/library-modal.js";
import { stripAnsi } from "../src/screen.js";
import type { AppState, CanonicalBook, ThemePreset } from "../src/types.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeTempStorage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stealth-sort-test-"));
  process.env.XDG_DATA_HOME = dir;
  process.env.XDG_CACHE_HOME = dir;
  const storage = new Storage();
  return {
    storage,
    cleanup: () => {
      storage.db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

function insertBook(storage: Storage, id: string, title = "Test Book", author = "Author", lastOpenedAt = Date.now(), progress: number | null = null) {
  storage.db.prepare(`
    INSERT INTO books (id, title, author, source_path, import_hash, parser_version, last_opened_at, render_mode)
    VALUES (?, ?, ?, ?, ?, 1, ?, 'plain')
  `).run(id, title, author, `/tmp/${id}.epub`, `hash-${id}`, lastOpenedAt);
  if (progress !== null) {
    storage.savePosition({ bookId: id, chapterIndex: 0, chapterProgress: 0, bookProgress: progress, blockOffset: 0 });
  }
}

const theme: ThemePreset = {
  id: "codex", label: "Codex", accent: "#88ccff", accentMuted: "#6699cc",
  foreground: "#d0d7de", dim: "#8b949e", background: "#0d1117", border: "#30363d",
  warning: "#d29922", keyword: "#ff7b72", codeString: "#a5d6ff", subtle: "#6e7681"
};

const book: CanonicalBook = {
  id: "b1", title: "Alpha", author: "Anon", sourcePath: "/tmp/b1.epub",
  importHash: "h1", diagnostics: [],
  chapters: [{ id: "c1", index: 0, title: "Ch1", href: "c1", depth: 0, blocks: [], wordCount: 0 }]
};

function makeState(storage: Storage, overrides: Partial<AppState> = {}): AppState {
  return {
    storage: storage as AppState["storage"],
    cwd: "/tmp", theme, renderMode: "plain", codeLanguage: "typescript",
    codeDensity: 3, plainHighlight: true, progressVisibility: "book",
    currentBook: null, chapterIndex: 0, blockOffset: 0,
    focusMode: false, focusBlockIndex: 0,
    commandBuffer: "", commandCursor: 0, commandMode: false, commandSuggestionIndex: 0,
    status: "", overlay: "none", overlayCursor: 0, discoveries: [],
    shouldQuit: false, filePickerCursor: 0, filePickerItems: [],
    filePickerSelected: new Set(), filePickerForce: false,
    chapterTransition: null, mouseDrag: null, layoutMetrics: null,
    searchState: null, navHistory: [], navHistoryCursor: -1,
    librarySortKey: "lastOpened", librarySortDir: "desc",
    booksTagFilter: null, booksTagMap: new Map(),
    helpCommand: null, mouseCapture: false,
    ...overrides
  };
}

const redraw = () => {};
const noop = async () => {};

// ── storage sort ─────────────────────────────────────────────────────────────

test("listBooksWithProgress default order is lastOpened desc", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1", "Zebra", "Author A", 1000);
    insertBook(storage, "b2", "Alpha", "Author B", 3000);
    insertBook(storage, "b3", "Mango", "Author C", 2000);
    const books = storage.listBooksWithProgress();
    assert.equal(books[0]?.id, "b2");
    assert.equal(books[1]?.id, "b3");
    assert.equal(books[2]?.id, "b1");
  } finally { cleanup(); }
});

test("listBooksWithProgress sort by title asc is case-insensitive", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1", "zebra", "A", 3000);
    insertBook(storage, "b2", "Alpha", "B", 2000);
    insertBook(storage, "b3", "mango", "C", 1000);
    const books = storage.listBooksWithProgress("title", "asc");
    assert.equal(books[0]?.title, "Alpha");
    assert.equal(books[1]?.title, "mango");
    assert.equal(books[2]?.title, "zebra");
  } finally { cleanup(); }
});

test("listBooksWithProgress sort by title desc reverses order", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1", "Apple", "A", 1000);
    insertBook(storage, "b2", "Banana", "B", 2000);
    const books = storage.listBooksWithProgress("title", "desc");
    assert.equal(books[0]?.title, "Banana");
    assert.equal(books[1]?.title, "Apple");
  } finally { cleanup(); }
});

test("listBooksWithProgress sort by author asc", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1", "Title1", "Zola", 1000);
    insertBook(storage, "b2", "Title2", "Asimov", 2000);
    const books = storage.listBooksWithProgress("author", "asc");
    assert.equal(books[0]?.author, "Asimov");
    assert.equal(books[1]?.author, "Zola");
  } finally { cleanup(); }
});

test("listBooksWithProgress sort by progress places unstarted books last", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1", "T1", "A", 1000, 0.9);
    insertBook(storage, "b2", "T2", "B", 2000, null);
    insertBook(storage, "b3", "T3", "C", 3000, 0.2);
    const booksAsc = storage.listBooksWithProgress("progress", "asc");
    assert.equal(booksAsc[0]?.id, "b3");
    assert.equal(booksAsc[1]?.id, "b1");
    assert.equal(booksAsc[2]?.id, "b2");

    const booksDesc = storage.listBooksWithProgress("progress", "desc");
    assert.equal(booksDesc[0]?.id, "b1");
    assert.equal(booksDesc[1]?.id, "b3");
    assert.equal(booksDesc[2]?.id, "b2");
  } finally { cleanup(); }
});

test("listBooksWithProgress with tagFilter only returns tagged books", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1", "Sci-Fi Book", "A", 1000);
    insertBook(storage, "b2", "Fantasy Book", "B", 2000);
    storage.addTag("b1", "sci-fi");
    storage.addTag("b2", "fantasy");
    const filtered = storage.listBooksWithProgress("lastOpened", "desc", "sci-fi");
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.id, "b1");
  } finally { cleanup(); }
});

test("listBooksWithProgress tagFilter is case-insensitive", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1", "Book", "A", 1000);
    storage.addTag("b1", "Sci-Fi");
    const filtered = storage.listBooksWithProgress("lastOpened", "desc", "sci-fi");
    assert.equal(filtered.length, 1);
  } finally { cleanup(); }
});

// ── overlay rendering ─────────────────────────────────────────────────────────

test("books overlay shows sort header", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1", "Test", "A", 1000);
    const state = makeState(storage, { overlay: "books", librarySortKey: "title", librarySortDir: "asc" });
    const lines = renderLibraryModal(state, 100, 30).map(stripAnsi);
    const title = lines.find((line) => line.includes("Library"));
    assert.ok(title?.includes("Sort: Title"), `Expected sort in title, got: ${title}`);
    assert.ok(title?.includes("↑"), `Expected asc arrow, got: ${title}`);
  } finally { cleanup(); }
});

test("books overlay shows descending arrow by default", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1", "Test", "A", 1000);
    const state = makeState(storage, { overlay: "books" });
    const lines = renderLibraryModal(state, 100, 30).map(stripAnsi);
    const title = lines.find((line) => line.includes("Library"));
    assert.ok(title?.includes("↓"), `Expected desc arrow, got: ${title}`);
  } finally { cleanup(); }
});

test("books overlay documents management actions and richer row metadata", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1", "Tagged Book", "A", Date.now() - 60_000, 0.42);
    storage.addTag("b1", "work");
    const state = makeState(storage, {
      overlay: "books",
      booksTagMap: storage.listTagsByBookId(),
      booksTagFilter: "work"
    });
    const lines = renderLibraryModal(state, 100, 30).map(stripAnsi);
    const title = lines.find((line) => line.includes("Library"));
    assert.ok(title?.includes("#work"), `Expected tag filter in title, got: ${title}`);
    const footer = lines.find((line) => line.includes("Enter:open"));
    assert.ok(footer, `Expected Enter:open footer hint, got: ${lines.join(" | ")}`);
    assert.ok(footer?.includes("b/n:marks/notes"), `Expected marks/notes hint, got: ${footer}`);
    assert.ok(footer?.includes("s/r:sort"), `Expected sort hint, got: ${footer}`);
    assert.ok(lines.some((line) => line.includes("/ to search")), `Expected search affordance, got: ${lines.join(" | ")}`);
    assert.ok(lines.some((line) => line.includes("[continue]")), `Expected continue marker, got: ${lines.join(" | ")}`);
    assert.ok(lines.some((line) => line.includes("42%")), `Expected progress metadata, got: ${lines.join(" | ")}`);
    assert.ok(lines.some((line) => line.includes("#work")), `Expected tag metadata, got: ${lines.join(" | ")}`);
  } finally { cleanup(); }
});

// ── keyboard keys s and r ─────────────────────────────────────────────────────

test("s key cycles sort key in books overlay", async () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1");
    const state = makeState(storage, { overlay: "books", librarySortKey: "lastOpened" });
    await handleInput("s", state, redraw, noop, () => {}, noop);
    assert.equal(state.librarySortKey, "title");
    await handleInput("s", state, redraw, noop, () => {}, noop);
    assert.equal(state.librarySortKey, "author");
    await handleInput("s", state, redraw, noop, () => {}, noop);
    assert.equal(state.librarySortKey, "progress");
    await handleInput("s", state, redraw, noop, () => {}, noop);
    assert.equal(state.librarySortKey, "lastOpened");
  } finally { cleanup(); }
});

test("r key reverses sort direction in books overlay", async () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1");
    const state = makeState(storage, { overlay: "books", librarySortDir: "desc" });
    await handleInput("r", state, redraw, noop, () => {}, noop);
    assert.equal(state.librarySortDir, "asc");
    await handleInput("r", state, redraw, noop, () => {}, noop);
    assert.equal(state.librarySortDir, "desc");
  } finally { cleanup(); }
});

test("s and r keys reset overlayCursor to 0", async () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1");
    const state = makeState(storage, { overlay: "books", overlayCursor: 0 });
    await handleInput("s", state, redraw, noop, () => {}, noop);
    assert.equal(state.overlayCursor, 0);

    state.overlayCursor = 0;
    await handleInput("r", state, redraw, noop, () => {}, noop);
    assert.equal(state.overlayCursor, 0);
  } finally { cleanup(); }
});

test("books overlay b and n open selected book management overlays", async () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    storage.saveBook(book, "plain");
    const state = makeState(storage, { overlay: "books" });

    await handleInput("b", state, redraw, noop, () => {}, noop);
    assert.equal(state.overlay, "bookmarks");
    assert.equal(state.currentBook?.id, "b1");
    assert.match(state.status, /Opened bookmarks/);

    state.overlay = "books";
    await handleInput("n", state, redraw, noop, () => {}, noop);
    assert.equal(state.overlay, "notes");
    assert.equal(state.currentBook?.id, "b1");
    assert.match(state.status, /Opened notes/);
  } finally { cleanup(); }
});

test("s and r keys only work inside books overlay", async () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    const state = makeState(storage, { overlay: "chapters", currentBook: book, librarySortKey: "lastOpened" });
    await handleInput("s", state, redraw, noop, () => {}, noop);
    assert.equal(state.librarySortKey, "lastOpened");
  } finally { cleanup(); }
});

// ── /changebook --sort flag ────────────────────────────────────────────────────

test("/changebook --sort title sets librarySortKey and opens overlay", async () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1", "Test", "A", 1000);
    const state = makeState(storage, { overlay: "none" });
    await executeCommand(state, "/changebook --sort title");
    assert.equal(state.overlay, "books");
    assert.equal(state.librarySortKey, "title");
  } finally { cleanup(); }
});

test("/changebook --sort with invalid value throws an error", async () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    const state = makeState(storage, { overlay: "none" });
    await executeCommand(state, "/changebook --sort invalid");
    assert.match(state.status, /Invalid sort key/);
  } finally { cleanup(); }
});
