import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Storage } from "../src/storage.js";
import { handleInput } from "../src/input.js";
import { executeCommand } from "../src/executor.js";
import { stripAnsi } from "../src/screen.js";
import { modalGeometry } from "../src/modal.js";
import { THEMES } from "../src/themes.js";
import {
  chaptersModalHitTest,
  filteredBookmarkItems,
  filteredChapterItems,
  filteredNoteItems,
  renderBookmarksModal,
  renderChaptersModal,
  renderColorschemesModal,
  renderNotesModal,
  renderThemesModal
} from "../src/overlay-modals.js";
import type { AppState, CanonicalBook, ThemePreset } from "../src/types.js";

function makeTempStorage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stealth-overlay-modals-test-"));
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

function insertBook(storage: Storage, id: string, title = "Book") {
  storage.db.prepare(`
    INSERT INTO books (id, title, author, source_path, import_hash, parser_version, last_opened_at, render_mode)
    VALUES (?, ?, 'Author', ?, ?, 1, ?, 'plain')
  `).run(id, title, `/tmp/${id}.epub`, `hash-${id}`, Date.now());
}

const theme: ThemePreset = {
  id: "codex", label: "Codex", accent: "#88ccff", accentMuted: "#6699cc",
  foreground: "#d0d7de", dim: "#8b949e", background: "#0d1117", border: "#30363d",
  warning: "#d29922", keyword: "#ff7b72", codeString: "#a5d6ff", subtle: "#6e7681"
};

function makeBook(id = "b1"): CanonicalBook {
  const chapterTitles = ["Prologue", "The Dune Sea", "Arrival", "Epilogue"];
  return {
    id,
    title: "Test Book",
    author: "Author",
    sourcePath: `/tmp/${id}.epub`,
    importHash: `hash-${id}`,
    diagnostics: [],
    chapters: chapterTitles.map((title, index) => ({
      id: `c${index}`,
      index,
      title,
      href: `c${index}.xhtml`,
      depth: 0,
      blocks: [{ kind: "paragraph", text: `${title} text` }],
      wordCount: 2
    }))
  } as CanonicalBook;
}

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
    colorScheme: theme,
    appearanceTheme: { id: "dark", label: "Dark" },
    ...overrides
  } as AppState;
}

const redraw = () => {};
const noop = async () => {};

// ── chapters ──────────────────────────────────────────────────────────────────

test("chapters modal renders a bordered frame with book title and numbered rows", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    const state = makeState(storage, { overlay: "chapters", currentBook: makeBook() });
    const lines = renderChaptersModal(state, 100, 30).map(stripAnsi);
    const geometry = modalGeometry(100, 30);
    assert.match(lines[geometry.y]!, /╭─ Chapters · Test Book .*\[×\]─╮/);
    assert.match(lines[geometry.y + 1]!, /\/ to search/);
    const body = lines.slice(geometry.entriesY, geometry.entriesY + geometry.visibleRows).join(" | ");
    assert.match(body, /01 Prologue/);
    assert.match(body, /02 The Dune Sea/);
    const footer = lines[geometry.y + geometry.height - 2]!;
    assert.match(footer, /Enter:go/);
    assert.match(footer, /Esc:close/);
  } finally { cleanup(); }
});

test("filteredChapterItems fuzzy-matches chapter titles and keeps original indexes", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    const state = makeState(storage, {
      overlay: "chapters",
      currentBook: makeBook(),
      overlaySearchBuffer: "dune"
    });
    const items = filteredChapterItems(state);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.item.title, "The Dune Sea");
    assert.equal(items[0]?.index, 1);
  } finally { cleanup(); }
});

test("typing / in the chapters overlay enters search and Enter jumps to the filtered chapter", async () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    const state = makeState(storage, { overlay: "chapters", currentBook: makeBook() });
    await handleInput("/", state, redraw, noop, () => {}, noop);
    assert.equal(state.overlaySearchMode, true);
    assert.equal(state.commandMode, false);
    await handleInput("d", state, redraw, noop, () => {}, noop);
    await handleInput("u", state, redraw, noop, () => {}, noop);
    await handleInput("\r", state, redraw, noop, () => {}, noop);
    assert.equal(state.overlaySearchMode, false);
    await handleInput("\r", state, redraw, noop, () => {}, noop);
    assert.equal(state.overlay, "none");
    assert.equal(state.chapterIndex, 1);
    assert.ok(state.navHistory.length >= 1);
  } finally { cleanup(); }
});

test("chapters modal hit test maps a row click to the filtered index", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    const state = makeState(storage, { overlay: "chapters", currentBook: makeBook() });
    const geometry = modalGeometry(100, 30);
    const hit = chaptersModalHitTest(state, 100, 30, geometry.x + 2, geometry.entriesY + 2);
    assert.deepEqual(hit, { kind: "row", index: 2 });
  } finally { cleanup(); }
});

test("/chapters resets any stale overlay search buffer", async () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    const state = makeState(storage, {
      currentBook: makeBook(),
      overlaySearchBuffer: "stale",
      overlaySearchMode: true
    });
    await executeCommand(state, "/chapters");
    assert.equal(state.overlay, "chapters");
    assert.equal(state.overlaySearchBuffer, "");
    assert.equal(state.overlaySearchMode, false);
  } finally { cleanup(); }
});

// ── bookmarks ─────────────────────────────────────────────────────────────────

test("bookmarks modal renders location, label, and age rows", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1");
    storage.addBookmark("b1", 2, 5, "the spice");
    const state = makeState(storage, { overlay: "bookmarks", currentBook: makeBook("b1") });
    const lines = renderBookmarksModal(state, 100, 30).map(stripAnsi);
    const geometry = modalGeometry(100, 30);
    assert.match(lines[geometry.y]!, /╭─ Bookmarks /);
    const body = lines.slice(geometry.entriesY, geometry.entriesY + geometry.visibleRows).join(" | ");
    assert.match(body, /Ch\.3 §5/);
    assert.match(body, /"the spice"/);
    assert.match(body, /\[agora\]/);
    const footer = lines[geometry.y + geometry.height - 2]!;
    assert.match(footer, /d:delete/);
  } finally { cleanup(); }
});

test("d in a searched bookmarks overlay deletes the filtered selection", async () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1");
    storage.addBookmark("b1", 0, 0, "keep me");
    storage.addBookmark("b1", 1, 3, "delete me");
    const state = makeState(storage, {
      overlay: "bookmarks",
      currentBook: makeBook("b1"),
      overlaySearchBuffer: "delete",
      overlayCursor: 0
    });
    await handleInput("d", state, redraw, noop, () => {}, noop);
    const remaining = storage.listBookmarks("b1");
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0]?.label, "keep me");
  } finally { cleanup(); }
});

test("Enter in a searched bookmarks overlay jumps to the filtered bookmark", async () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1");
    storage.addBookmark("b1", 0, 0, "start");
    storage.addBookmark("b1", 2, 9, "spice");
    const state = makeState(storage, {
      overlay: "bookmarks",
      currentBook: makeBook("b1"),
      overlaySearchBuffer: "spice",
      overlayCursor: 0
    });
    await handleInput("\r", state, redraw, noop, () => {}, noop);
    assert.equal(state.overlay, "none");
    assert.equal(state.chapterIndex, 2);
    assert.equal(state.blockOffset, 9);
  } finally { cleanup(); }
});

test("filteredBookmarkItems matches label and location text", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1");
    storage.addBookmark("b1", 0, 0, "alpha");
    storage.addBookmark("b1", 4, 2, "beta");
    const state = makeState(storage, {
      overlay: "bookmarks",
      currentBook: makeBook("b1"),
      overlaySearchBuffer: "ch.5"
    });
    const items = filteredBookmarkItems(state);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.label, "beta");
  } finally { cleanup(); }
});

// ── notes ─────────────────────────────────────────────────────────────────────

test("notes modal renders note content with position and age", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1");
    storage.addNote("b1", "Great insight here", 3, 42);
    const state = makeState(storage, { overlay: "notes", currentBook: makeBook("b1") });
    const lines = renderNotesModal(state, 100, 30).map(stripAnsi);
    const geometry = modalGeometry(100, 30);
    assert.match(lines[geometry.y]!, /╭─ Notes /);
    const body = lines.slice(geometry.entriesY, geometry.entriesY + geometry.visibleRows).join(" | ");
    assert.match(body, /Ch\.4 §42/);
    assert.match(body, /Great insight here/);
  } finally { cleanup(); }
});

test("Enter in a searched notes overlay jumps to the filtered note", async () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1");
    storage.addNote("b1", "first note", 0, 0);
    storage.addNote("b1", "jump target", 1, 7);
    const state = makeState(storage, {
      overlay: "notes",
      currentBook: makeBook("b1"),
      overlaySearchBuffer: "jump",
      overlayCursor: 0
    });
    await handleInput("\r", state, redraw, noop, () => {}, noop);
    assert.equal(state.overlay, "none");
    assert.equal(state.chapterIndex, 1);
    assert.equal(state.blockOffset, 7);
  } finally { cleanup(); }
});

test("d in the notes overlay deletes the selected note", async () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1");
    storage.addNote("b1", "Note to keep", 1, 5);
    storage.addNote("b1", "Note to delete", 0, 0);
    const state = makeState(storage, {
      overlay: "notes",
      currentBook: makeBook("b1"),
      overlayCursor: 0
    });
    const first = filteredNoteItems(state)[0];
    await handleInput("d", state, redraw, noop, () => {}, noop);
    const remaining = storage.listNotes("b1");
    assert.equal(remaining.length, 1);
    assert.notEqual(remaining[0]?.id, first?.id);
  } finally { cleanup(); }
});

// ── colorschemes and themes ───────────────────────────────────────────────────

test("colorschemes modal renders theme labels and Enter applies the filtered scheme", async () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    const state = makeState(storage, { overlay: "colorschemes" });
    const lines = renderColorschemesModal(state, 100, 30).map(stripAnsi);
    const geometry = modalGeometry(100, 30);
    assert.match(lines[geometry.y]!, /╭─ Colorscheme /);
    const body = lines.slice(geometry.entriesY, geometry.entriesY + geometry.visibleRows).join(" | ");
    assert.match(body, /Codex \(codex\)/);

    state.overlaySearchBuffer = "amber";
    state.overlayCursor = 0;
    await handleInput("\r", state, redraw, noop, () => {}, noop);
    assert.equal(state.overlay, "none");
    assert.equal(state.colorScheme.id, "amber");
    assert.equal(storage.getSetting("themeId"), "amber");
  } finally { cleanup(); }
});

test("themes modal renders appearance labels and Enter applies the filtered theme", async () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    const state = makeState(storage, { overlay: "themes", colorScheme: THEMES[0]! });
    const lines = renderThemesModal(state, 100, 30).map(stripAnsi);
    const geometry = modalGeometry(100, 30);
    assert.match(lines[geometry.y]!, /╭─ Theme /);
    const body = lines.slice(geometry.entriesY, geometry.entriesY + geometry.visibleRows).join(" | ");
    assert.match(body, /Dark \(dark\)/);

    state.overlaySearchBuffer = "chalk";
    state.overlayCursor = 0;
    await handleInput("\r", state, redraw, noop, () => {}, noop);
    assert.equal(state.overlay, "none");
    assert.equal(state.appearanceTheme.id, "light");
    assert.equal(storage.getSetting("appearanceThemeId"), "light");
  } finally { cleanup(); }
});
