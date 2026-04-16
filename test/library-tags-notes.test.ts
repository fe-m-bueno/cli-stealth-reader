import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Storage } from "../src/storage.js";
import { executeCommand } from "../src/executor.js";
import { handleInput } from "../src/input.js";
import { renderOverlay } from "../src/tui.js";
import { stripAnsi } from "../src/screen.js";
import type { AppState, CanonicalBook, ThemePreset } from "../src/types.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTempStorage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stealth-tags-test-"));
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

function insertBook(storage: Storage, id: string, title = "Test Book", author = "Author") {
  storage.db.prepare(`
    INSERT INTO books (id, title, author, source_path, import_hash, parser_version, last_opened_at, render_mode)
    VALUES (?, ?, ?, ?, ?, 1, ?, 'plain')
  `).run(id, title, author, `/tmp/${id}.epub`, `hash-${id}`, Date.now());
}

const theme: ThemePreset = {
  id: "codex", label: "Codex", accent: "#88ccff", accentMuted: "#6699cc",
  foreground: "#d0d7de", dim: "#8b949e", background: "#0d1117", border: "#30363d",
  warning: "#d29922", keyword: "#ff7b72", codeString: "#a5d6ff", subtle: "#6e7681"
};

const bookWithChapters: CanonicalBook = {
  id: "b1", title: "Test", author: "Anon", sourcePath: "/tmp/b1.epub",
  importHash: "h1", diagnostics: [],
  chapters: [
    { id: "c1", index: 0, title: "Chapter 1", href: "c1", depth: 0, blocks: [{ id: "blk1", type: "paragraph", text: "text" }], wordCount: 1 },
    { id: "c2", index: 1, title: "Chapter 2", href: "c2", depth: 0, blocks: [{ id: "blk2", type: "paragraph", text: "more text" }], wordCount: 2 }
  ]
};

function makeState(storage: Storage, overrides: Partial<AppState> = {}): AppState {
  return {
    storage: storage as AppState["storage"],
    cwd: "/tmp", theme, renderMode: "plain", codeLanguage: "typescript",
    codeDensity: 3, plainHighlight: true, progressVisibility: "book",
    currentBook: null, chapterIndex: 0, blockOffset: 0,
    focusMode: false, focusBlockIndex: 0,
    commandBuffer: "", commandMode: false, commandSuggestionIndex: 0,
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

// ── storage: tags ─────────────────────────────────────────────────────────────

test("addTag persists and listTags returns it", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1");
    storage.addTag("b1", "fiction");
    const tags = storage.listTags("b1");
    assert.deepEqual(tags, ["fiction"]);
  } finally { cleanup(); }
});

test("addTag is idempotent", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1");
    storage.addTag("b1", "sci-fi");
    storage.addTag("b1", "sci-fi");
    assert.equal(storage.listTags("b1").length, 1);
  } finally { cleanup(); }
});

test("removeTag deletes the tag", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1");
    storage.addTag("b1", "toRead");
    storage.removeTag("b1", "toRead");
    assert.deepEqual(storage.listTags("b1"), []);
  } finally { cleanup(); }
});

test("listTags returns tags sorted alphabetically", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1");
    storage.addTag("b1", "zzz");
    storage.addTag("b1", "aaa");
    storage.addTag("b1", "mmm");
    const tags = storage.listTags("b1");
    assert.deepEqual(tags, ["aaa", "mmm", "zzz"]);
  } finally { cleanup(); }
});

test("listTagsByBookId returns map with tags per book", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1");
    insertBook(storage, "b2");
    storage.addTag("b1", "fiction");
    storage.addTag("b1", "classic");
    storage.addTag("b2", "tech");
    const map = storage.listTagsByBookId();
    assert.ok(map.has("b1"));
    assert.deepEqual(map.get("b1")?.sort(), ["classic", "fiction"]);
    assert.deepEqual(map.get("b2"), ["tech"]);
  } finally { cleanup(); }
});

test("removeBook deletes associated tags", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1");
    storage.addTag("b1", "fiction");
    storage.removeBook("b1");
    const remaining = storage.db.prepare("SELECT * FROM book_tags WHERE book_id = 'b1'").all();
    assert.equal(remaining.length, 0);
  } finally { cleanup(); }
});

// ── storage: notes ────────────────────────────────────────────────────────────

test("addNote persists and listNotes returns it", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1");
    const note = storage.addNote("b1", "Interesting passage", 2, 15);
    assert.ok(note.id.length > 0);
    assert.equal(note.bookId, "b1");
    assert.equal(note.chapterIndex, 2);
    assert.equal(note.blockOffset, 15);
    assert.equal(note.content, "Interesting passage");
    const listed = storage.listNotes("b1");
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, note.id);
  } finally { cleanup(); }
});

test("listNotes returns most recent first", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1");
    const insertNote = storage.db.prepare(
      "INSERT INTO notes (id, book_id, chapter_index, block_offset, content, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    );
    insertNote.run("id-old", "b1", 0, 0, "First note", 1000);
    insertNote.run("id-new", "b1", 1, 5, "Second note", 2000);
    const listed = storage.listNotes("b1");
    assert.equal(listed[0]?.id, "id-new");
    assert.equal(listed[1]?.id, "id-old");
  } finally { cleanup(); }
});

test("deleteNote removes the note", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1");
    const note = storage.addNote("b1", "To delete", 0, 0);
    storage.deleteNote(note.id);
    assert.deepEqual(storage.listNotes("b1"), []);
  } finally { cleanup(); }
});

test("removeBook deletes associated notes", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1");
    storage.addNote("b1", "My note", 0, 0);
    storage.removeBook("b1");
    const remaining = storage.db.prepare("SELECT * FROM notes WHERE book_id = 'b1'").all();
    assert.equal(remaining.length, 0);
  } finally { cleanup(); }
});

// ── /tag command ───────────────────────────────────────────────────────────────

test("/tag adds a tag to the current book", async () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1");
    const state = makeState(storage, { currentBook: { ...bookWithChapters, id: "b1" } });
    await executeCommand(state, "/tag fiction");
    assert.deepEqual(storage.listTags("b1"), ["fiction"]);
    assert.match(state.status, /Tag added/);
  } finally { cleanup(); }
});

test("/tag without arg lists current book tags in status", async () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1");
    storage.addTag("b1", "sci-fi");
    const state = makeState(storage, { currentBook: { ...bookWithChapters, id: "b1" } });
    await executeCommand(state, "/tag");
    assert.match(state.status, /#sci-fi/);
  } finally { cleanup(); }
});

test("/tag -d removes a tag", async () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1");
    storage.addTag("b1", "toread");
    const state = makeState(storage, { currentBook: { ...bookWithChapters, id: "b1" } });
    await executeCommand(state, "/tag -d toread");
    assert.deepEqual(storage.listTags("b1"), []);
    assert.match(state.status, /Tag removed/);
  } finally { cleanup(); }
});

test("/tag with no current book shows error", async () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    const state = makeState(storage, { currentBook: null });
    await executeCommand(state, "/tag fiction");
    assert.match(state.status, /No book open/);
  } finally { cleanup(); }
});

test("/tags shows tags in status", async () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1");
    storage.addTag("b1", "classic");
    const state = makeState(storage, { currentBook: { ...bookWithChapters, id: "b1" } });
    await executeCommand(state, "/tags");
    assert.match(state.status, /#classic/);
  } finally { cleanup(); }
});

// ── /note command ─────────────────────────────────────────────────────────────

test("/note creates a note at current position", async () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1");
    const state = makeState(storage, { currentBook: { ...bookWithChapters, id: "b1" }, chapterIndex: 1, blockOffset: 5 });
    await executeCommand(state, "/note This is a great passage");
    const notes = storage.listNotes("b1");
    assert.equal(notes.length, 1);
    assert.equal(notes[0]?.content, "This is a great passage");
    assert.equal(notes[0]?.chapterIndex, 1);
    assert.equal(notes[0]?.blockOffset, 5);
    assert.match(state.status, /Note saved/);
  } finally { cleanup(); }
});

test("/note -l opens notes overlay", async () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1");
    storage.addNote("b1", "A note", 0, 0);
    const state = makeState(storage, { currentBook: { ...bookWithChapters, id: "b1" } });
    await executeCommand(state, "/note -l");
    assert.equal(state.overlay, "notes");
    assert.equal(state.overlayCursor, 0);
  } finally { cleanup(); }
});

test("/note -d deletes a note that belongs to the current book", async () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1");
    const note = storage.addNote("b1", "Delete me", 0, 0);
    const state = makeState(storage, { currentBook: { ...bookWithChapters, id: "b1" } });
    await executeCommand(state, `/note -d ${note.id}`);
    assert.deepEqual(storage.listNotes("b1"), []);
    assert.match(state.status, /Note deleted/);
  } finally { cleanup(); }
});

test("/note -d cannot delete a note from a different book", async () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1");
    insertBook(storage, "b2");
    const noteFromOtherBook = storage.addNote("b2", "Other book note", 0, 0);
    const state = makeState(storage, { currentBook: { ...bookWithChapters, id: "b1" } });
    await executeCommand(state, `/note -d ${noteFromOtherBook.id}`);
    assert.match(state.status, /not found/i);
    assert.equal(storage.listNotes("b2").length, 1);
  } finally { cleanup(); }
});

// ── notes overlay ─────────────────────────────────────────────────────────────

test("notes overlay renders notes with position and age", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1");
    storage.addNote("b1", "Great insight here", 3, 42);
    const state = makeState(storage, { overlay: "notes", currentBook: { ...bookWithChapters, id: "b1" } });
    const lines = renderOverlay(state, 80, 20).map(stripAnsi);
    const noteLine = lines.find((l) => l.includes("Great insight here"));
    assert.ok(noteLine, "Note content should appear in overlay");
    assert.ok(noteLine?.includes("Ch.4"), "Chapter number should be displayed");
    assert.ok(noteLine?.includes("§42"), "Block offset should be displayed");
  } finally { cleanup(); }
});

test("pressing Enter on notes overlay navigates to the note position", async () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1");
    storage.addNote("b1", "Jump here", 1, 7);
    const state = makeState(storage, {
      overlay: "notes",
      currentBook: bookWithChapters,
      chapterIndex: 0,
      blockOffset: 0,
      overlayCursor: 0
    });
    await handleInput("\r", state, redraw, noop, () => {}, noop);
    assert.equal(state.overlay, "none");
    assert.equal(state.chapterIndex, 1);
    assert.equal(state.blockOffset, 7);
  } finally { cleanup(); }
});

test("pressing d in notes overlay deletes the selected note", async () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1");
    storage.addNote("b1", "Note to delete", 0, 0);
    storage.addNote("b1", "Note to keep", 1, 5);
    const state = makeState(storage, {
      overlay: "notes",
      currentBook: { ...bookWithChapters, id: "b1" },
      overlayCursor: 0
    });
    await handleInput("d", state, redraw, noop, () => {}, noop);
    assert.equal(storage.listNotes("b1").length, 1);
    assert.equal(storage.listNotes("b1")[0]?.content, "Note to keep");
  } finally { cleanup(); }
});

// ── books overlay shows tags ──────────────────────────────────────────────────

test("books overlay shows tags next to book title", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1", "Dom Casmurro", "Machado");
    storage.addTag("b1", "clássico");
    const state = makeState(storage, {
      overlay: "books",
      booksTagMap: storage.listTagsByBookId()
    });
    const lines = renderOverlay(state, 80, 20).map(stripAnsi);
    const bookLine = lines.find((l) => l.includes("Dom Casmurro"));
    assert.ok(bookLine?.includes("#clássico"), `Expected tag in line, got: ${bookLine}`);
  } finally { cleanup(); }
});
