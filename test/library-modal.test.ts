import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Storage } from "../src/storage.js";
import { handleInput } from "../src/input.js";
import { stripAnsi } from "../src/screen.js";
import { modalGeometry } from "../src/modal.js";
import {
  filteredLibraryItems,
  filteredPickerItems,
  renderFilePickerModal,
  renderLibraryModal
} from "../src/library-modal.js";
import type { AppState, ThemePreset } from "../src/types.js";

function makeTempStorage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stealth-library-modal-test-"));
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

function insertBook(storage: Storage, id: string, title: string, author = "Author", lastOpenedAt = Date.now(), progress: number | null = null) {
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
  } as AppState;
}

const redraw = () => {};
const noop = async () => {};

test("library modal renders a bordered frame with sort in the title and book metadata rows", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1", "Tagged Book", "A", Date.now() - 60_000, 0.42);
    storage.addTag("b1", "work");
    const state = makeState(storage, {
      overlay: "books",
      librarySortKey: "title",
      librarySortDir: "asc",
      booksTagMap: storage.listTagsByBookId()
    });
    const lines = renderLibraryModal(state, 100, 30).map(stripAnsi);
    const geometry = modalGeometry(100, 30);
    assert.match(lines[geometry.y]!, /╭─ Library · Sort: Title ↑ .*\[×\]─╮/);
    assert.match(lines[geometry.y + 1]!, /\/ to search/);
    const body = lines.slice(geometry.entriesY, geometry.entriesY + geometry.visibleRows).join(" | ");
    assert.match(body, /Tagged Book/);
    assert.match(body, /42%/);
    assert.match(body, /#work/);
    assert.match(body, /\[continue\]/);
    const footer = lines[geometry.y + geometry.height - 2]!;
    assert.match(footer, /Enter:open/);
  } finally { cleanup(); }
});

test("library modal title shows the active tag filter", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1", "Book", "A", 1000);
    storage.addTag("b1", "work");
    const state = makeState(storage, { overlay: "books", booksTagFilter: "work" });
    const lines = renderLibraryModal(state, 100, 30).map(stripAnsi);
    const geometry = modalGeometry(100, 30);
    assert.match(lines[geometry.y]!, /#work/);
  } finally { cleanup(); }
});

test("filteredLibraryItems fuzzy-matches title, author, and tags", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1", "Dune", "Frank Herbert", 3000);
    insertBook(storage, "b2", "Neuromancer", "William Gibson", 2000);
    const state = makeState(storage, { overlay: "books", overlaySearchBuffer: "gibsn" });
    const items = filteredLibraryItems(state);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.kind === "stored" && items[0].book.title, "Neuromancer");
  } finally { cleanup(); }
});

test("typing / in the books overlay enters search mode and typed text filters rows", async () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1", "Dune", "Frank Herbert", 3000);
    insertBook(storage, "b2", "Neuromancer", "William Gibson", 2000);
    const state = makeState(storage, { overlay: "books" });
    await handleInput("/", state, redraw, noop, () => {}, noop);
    assert.equal(state.overlaySearchMode, true);
    assert.equal(state.commandMode, false);
    await handleInput("d", state, redraw, noop, () => {}, noop);
    await handleInput("u", state, redraw, noop, () => {}, noop);
    const items = filteredLibraryItems(state);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.kind === "stored" && items[0].book.title, "Dune");
  } finally { cleanup(); }
});

test("Enter in a searched books overlay opens the filtered selection", async () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    const book = {
      id: "b2", title: "Neuromancer", author: "William Gibson", sourcePath: "/tmp/b2.epub",
      importHash: "h2", diagnostics: [],
      chapters: [{ id: "c1", index: 0, title: "Ch1", href: "c1", depth: 0, blocks: [], wordCount: 0 }]
    };
    storage.saveBook(book as never, "plain");
    insertBook(storage, "b1", "Dune", "Frank Herbert", 3000);
    const state = makeState(storage, {
      overlay: "books",
      overlaySearchBuffer: "neuro",
      overlaySearchMode: false
    });
    await handleInput("\r", state, redraw, noop, () => {}, noop);
    assert.equal(state.currentBook?.id, "b2");
    assert.equal(state.overlay, "none");
  } finally { cleanup(); }
});

test("file picker modal renders checkboxes and fuzzy search filters items", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    const state = makeState(storage, {
      overlay: "file-picker",
      filePickerItems: [
        { path: "/tmp/dune.epub", fileName: "dune.epub" },
        { path: "/tmp/other.epub", fileName: "other.epub" }
      ],
      filePickerSelected: new Set([0])
    });
    const lines = renderFilePickerModal(state, 100, 30).map(stripAnsi);
    const geometry = modalGeometry(100, 30);
    assert.match(lines[geometry.y]!, /╭─ Add Books /);
    const body = lines.slice(geometry.entriesY, geometry.entriesY + geometry.visibleRows).join(" | ");
    assert.match(body, /\[x\] dune\.epub/);
    assert.match(body, /\[ \] other\.epub/);

    state.overlaySearchBuffer = "dn";
    const filtered = filteredPickerItems(state);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.item.fileName, "dune.epub");
  } finally { cleanup(); }
});

test("space in the file picker toggles selection of the filtered row's original item", async () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    const state = makeState(storage, {
      overlay: "file-picker",
      filePickerItems: [
        { path: "/tmp/aaa.epub", fileName: "aaa.epub" },
        { path: "/tmp/dune.epub", fileName: "dune.epub" }
      ],
      overlaySearchBuffer: "dune",
      filePickerCursor: 0
    });
    await handleInput(" ", state, redraw, noop, () => {}, noop);
    assert.deepEqual(Array.from(state.filePickerSelected), [1]);
  } finally { cleanup(); }
});

test("Enter in a searched file picker imports the filtered selection", async () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    const imported: string[] = [];
    const state = makeState(storage, {
      overlay: "file-picker",
      filePickerItems: [
        { path: "/tmp/aaa.epub", fileName: "aaa.epub" },
        { path: "/tmp/dune.epub", fileName: "dune.epub" }
      ],
      overlaySearchBuffer: "dune",
      filePickerCursor: 0
    });
    await handleInput("\r", state, redraw, noop, () => {}, async (paths) => {
      imported.push(...paths);
    });
    assert.deepEqual(imported, ["/tmp/dune.epub"]);
    assert.equal(state.overlay, "none");
  } finally { cleanup(); }
});
