import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Storage } from "../src/storage.js";
import { executeCommand } from "../src/executor.js";
import type { AppState, ThemePreset } from "../src/types.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTempStorage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stealth-export-test-"));
  process.env.XDG_DATA_HOME = dir;
  process.env.XDG_CACHE_HOME = dir;
  const storage = new Storage();
  return {
    storage,
    dir,
    cleanup: () => {
      storage.db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

function insertBook(storage: Storage, id: string, importHash: string, title = "Test", author = "Author", lastOpenedAt = Date.now()) {
  storage.db.prepare(`
    INSERT INTO books (id, title, author, source_path, import_hash, parser_version, last_opened_at, render_mode)
    VALUES (?, ?, ?, ?, ?, 1, ?, 'plain')
  `).run(id, title, author, `/tmp/${id}.epub`, importHash, lastOpenedAt);
}

const theme: ThemePreset = {
  id: "codex", label: "Codex", accent: "#88ccff", accentMuted: "#6699cc",
  foreground: "#d0d7de", dim: "#8b949e", background: "#0d1117", border: "#30363d",
  warning: "#d29922", keyword: "#ff7b72", codeString: "#a5d6ff", subtle: "#6e7681"
};

function makeState(storage: Storage, cwd: string, overrides: Partial<AppState> = {}): AppState {
  return {
    storage: storage as AppState["storage"],
    cwd, theme, renderMode: "plain", codeLanguage: "typescript",
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

// ── exportAll ─────────────────────────────────────────────────────────────────

test("exportAll produces valid JSON with version=1 and exportedAt", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    const data = storage.exportAll();
    assert.equal(data.version, 1);
    assert.ok(typeof data.exportedAt === "string");
    assert.ok(!Number.isNaN(new Date(data.exportedAt).getTime()));
    assert.ok(Array.isArray(data.positions));
    assert.ok(Array.isArray(data.bookmarks));
    assert.ok(Array.isArray(data.notes));
    assert.ok(Array.isArray(data.tags));
  } finally { cleanup(); }
});

test("exportAll includes saved position keyed by importHash", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1", "sha256abc", "My Book", "Author X");
    storage.savePosition({ bookId: "b1", chapterIndex: 3, chapterProgress: 0.5, bookProgress: 0.31, blockOffset: 42 });
    const data = storage.exportAll();
    assert.equal(data.positions.length, 1);
    assert.equal(data.positions[0]?.bookImportHash, "sha256abc");
    assert.equal(data.positions[0]?.bookTitle, "My Book");
    assert.equal(data.positions[0]?.chapterIndex, 3);
    assert.equal(data.positions[0]?.blockOffset, 42);
    assert.ok(Math.abs((data.positions[0]?.bookProgress ?? 0) - 0.31) < 0.001);
  } finally { cleanup(); }
});

test("exportAll includes bookmarks keyed by importHash", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1", "hash-bm");
    storage.addBookmark("b1", 2, 10, "My mark");
    const data = storage.exportAll();
    assert.equal(data.bookmarks.length, 1);
    assert.equal(data.bookmarks[0]?.bookImportHash, "hash-bm");
    assert.equal(data.bookmarks[0]?.label, "My mark");
  } finally { cleanup(); }
});

test("exportAll includes notes keyed by importHash", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1", "hash-note");
    storage.addNote("b1", "Great passage", 1, 5);
    const data = storage.exportAll();
    assert.equal(data.notes.length, 1);
    assert.equal(data.notes[0]?.bookImportHash, "hash-note");
    assert.equal(data.notes[0]?.content, "Great passage");
  } finally { cleanup(); }
});

test("exportAll includes tags keyed by importHash", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1", "hash-tag");
    storage.addTag("b1", "fiction");
    const data = storage.exportAll();
    assert.equal(data.tags.length, 1);
    assert.equal(data.tags[0]?.bookImportHash, "hash-tag");
    assert.equal(data.tags[0]?.tag, "fiction");
  } finally { cleanup(); }
});

// ── importMerge ───────────────────────────────────────────────────────────────

test("importMerge updates position when export is newer than local", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    const oldTime = Date.now() - 60_000;
    insertBook(storage, "b1", "hash1", "Book", "A", oldTime);

    const exportedAt = new Date(Date.now()).toISOString();
    const result = storage.importMerge({
      version: 1,
      exportedAt,
      positions: [{ bookImportHash: "hash1", bookTitle: "Book", chapterIndex: 5, blockOffset: 20, bookProgress: 0.7 }],
      bookmarks: [],
      notes: [],
      tags: []
    });

    assert.equal(result.positionsUpdated, 1);
    const pos = storage.getPosition("b1");
    assert.equal(pos?.chapterIndex, 5);
    assert.equal(pos?.blockOffset, 20);
  } finally { cleanup(); }
});

test("importMerge skips position when export is older than local", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    const now = Date.now();
    insertBook(storage, "b1", "hash1", "Book", "A", now);
    storage.savePosition({ bookId: "b1", chapterIndex: 3, chapterProgress: 0, bookProgress: 0.5, blockOffset: 10 });

    const oldExportedAt = new Date(now - 30_000).toISOString();
    const result = storage.importMerge({
      version: 1,
      exportedAt: oldExportedAt,
      positions: [{ bookImportHash: "hash1", bookTitle: "Book", chapterIndex: 99, blockOffset: 99, bookProgress: 0.99 }],
      bookmarks: [],
      notes: [],
      tags: []
    });

    assert.equal(result.positionsUpdated, 0);
    assert.equal(storage.getPosition("b1")?.chapterIndex, 3);
  } finally { cleanup(); }
});

test("importMerge skips unknown importHash", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    const result = storage.importMerge({
      version: 1,
      exportedAt: new Date().toISOString(),
      positions: [{ bookImportHash: "unknown-hash", bookTitle: "Ghost", chapterIndex: 1, blockOffset: 0, bookProgress: 0.1 }],
      bookmarks: [],
      notes: [],
      tags: []
    });
    assert.equal(result.positionsUpdated, 0);
  } finally { cleanup(); }
});

test("importMerge adds bookmarks additively without duplicates", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1", "hash1");
    storage.addBookmark("b1", 1, 5, "existing");

    const result = storage.importMerge({
      version: 1,
      exportedAt: new Date().toISOString(),
      positions: [],
      bookmarks: [
        { bookImportHash: "hash1", bookTitle: "Book", chapterIndex: 1, blockOffset: 5, label: "existing", createdAt: Date.now() - 1000 },
        { bookImportHash: "hash1", bookTitle: "Book", chapterIndex: 2, blockOffset: 10, label: "new", createdAt: Date.now() - 500 }
      ],
      notes: [],
      tags: []
    });

    assert.equal(result.bookmarksAdded, 1);
    assert.equal(storage.listBookmarks("b1").length, 2);
  } finally { cleanup(); }
});

test("importMerge adds notes additively, deduplicates by content+createdAt", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1", "hash1");
    const existing = storage.addNote("b1", "Existing note", 0, 0);

    const result = storage.importMerge({
      version: 1,
      exportedAt: new Date().toISOString(),
      positions: [],
      bookmarks: [],
      notes: [
        { bookImportHash: "hash1", bookTitle: "Book", chapterIndex: 0, blockOffset: 0, content: "Existing note", createdAt: existing.createdAt },
        { bookImportHash: "hash1", bookTitle: "Book", chapterIndex: 1, blockOffset: 5, content: "New note", createdAt: Date.now() }
      ],
      tags: []
    });

    assert.equal(result.notesAdded, 1);
    assert.equal(storage.listNotes("b1").length, 2);
  } finally { cleanup(); }
});

test("importMerge adds tags additively without duplicates", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1", "hash1");
    storage.addTag("b1", "fiction");

    const result = storage.importMerge({
      version: 1,
      exportedAt: new Date().toISOString(),
      positions: [],
      bookmarks: [],
      notes: [],
      tags: [
        { bookImportHash: "hash1", bookTitle: "Book", tag: "fiction" },
        { bookImportHash: "hash1", bookTitle: "Book", tag: "classic" }
      ]
    });

    assert.equal(result.tagsAdded, 1);
    assert.equal(storage.listTags("b1").length, 2);
  } finally { cleanup(); }
});

test("importMerge throws for invalid exportedAt date", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    assert.throws(() => {
      storage.importMerge({
        version: 1,
        exportedAt: "not-a-date",
        positions: [],
        bookmarks: [],
        notes: [],
        tags: []
      });
    }, /invalid.*date/i);
  } finally { cleanup(); }
});

test("importMerge does not corrupt last_opened_at after position update", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    const oldTime = 1_000_000;
    insertBook(storage, "b1", "hash1", "Book", "A", oldTime);

    storage.importMerge({
      version: 1,
      exportedAt: new Date(Date.now()).toISOString(),
      positions: [{ bookImportHash: "hash1", bookTitle: "Book", chapterIndex: 2, blockOffset: 5, bookProgress: 0.5 }],
      bookmarks: [],
      notes: [],
      tags: []
    });

    const row = storage.db.prepare("SELECT last_opened_at FROM books WHERE id = 'b1'").get() as { last_opened_at: number };
    assert.equal(row.last_opened_at, oldTime, "importMerge must not update last_opened_at");
  } finally { cleanup(); }
});

// ── /export command ───────────────────────────────────────────────────────────

test("/export writes a valid JSON file to cwd by default", async () => {
  const { storage, dir, cleanup } = makeTempStorage();
  try {
    insertBook(storage, "b1", "h1", "My Book", "Author");
    storage.savePosition({ bookId: "b1", chapterIndex: 1, chapterProgress: 0, bookProgress: 0.5, blockOffset: 5 });

    const state = makeState(storage, dir);
    await executeCommand(state, "/export");

    const outFile = path.join(dir, "stealth-reader-export.json");
    assert.ok(fs.existsSync(outFile), "Export file should exist");
    const raw = JSON.parse(fs.readFileSync(outFile, "utf8"));
    assert.equal(raw.version, 1);
    assert.equal(raw.positions.length, 1);
    assert.match(state.status, /Exported/);
  } finally { cleanup(); }
});

test("/export with explicit path writes to that path", async () => {
  const { storage, dir, cleanup } = makeTempStorage();
  try {
    const state = makeState(storage, dir);
    await executeCommand(state, "/export my-backup.json");
    const outFile = path.join(dir, "my-backup.json");
    assert.ok(fs.existsSync(outFile), "Named export file should exist");
  } finally { cleanup(); }
});

// ── /import command ───────────────────────────────────────────────────────────

test("/import merges positions from a valid file", async () => {
  const { storage, dir, cleanup } = makeTempStorage();
  try {
    const oldTime = Date.now() - 60_000;
    insertBook(storage, "b1", "hash-import", "Book", "Author", oldTime);

    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      positions: [{ bookImportHash: "hash-import", bookTitle: "Book", chapterIndex: 4, blockOffset: 12, bookProgress: 0.6 }],
      bookmarks: [],
      notes: [],
      tags: []
    };
    const jsonPath = path.join(dir, "import-test.json");
    fs.writeFileSync(jsonPath, JSON.stringify(exportData), "utf8");

    const state = makeState(storage, dir);
    await executeCommand(state, `/import import-test.json`);

    assert.match(state.status, /1 position/);
    assert.equal(storage.getPosition("b1")?.chapterIndex, 4);
  } finally { cleanup(); }
});

test("/import shows error when file does not exist", async () => {
  const { storage, dir, cleanup } = makeTempStorage();
  try {
    const state = makeState(storage, dir);
    await executeCommand(state, "/import nonexistent.json");
    assert.match(state.status, /File not found/);
  } finally { cleanup(); }
});

test("/import shows error for unsupported version", async () => {
  const { storage, dir, cleanup } = makeTempStorage();
  try {
    const jsonPath = path.join(dir, "bad-version.json");
    fs.writeFileSync(jsonPath, JSON.stringify({ version: 99, exportedAt: new Date().toISOString(), positions: [], bookmarks: [], notes: [], tags: [] }), "utf8");
    const state = makeState(storage, dir);
    await executeCommand(state, "/import bad-version.json");
    assert.match(state.status, /Unsupported/);
  } finally { cleanup(); }
});

test("/import shows error for malformed JSON", async () => {
  const { storage, dir, cleanup } = makeTempStorage();
  try {
    const jsonPath = path.join(dir, "malformed.json");
    fs.writeFileSync(jsonPath, "{ not valid json", "utf8");
    const state = makeState(storage, dir);
    await executeCommand(state, "/import malformed.json");
    assert.match(state.status, /Import failed/i);
  } finally { cleanup(); }
});

test("/import shows error when required arrays are missing", async () => {
  const { storage, dir, cleanup } = makeTempStorage();
  try {
    const jsonPath = path.join(dir, "missing-arrays.json");
    fs.writeFileSync(jsonPath, JSON.stringify({ version: 1, exportedAt: new Date().toISOString() }), "utf8");
    const state = makeState(storage, dir);
    await executeCommand(state, "/import missing-arrays.json");
    assert.match(state.status, /Invalid export file/);
  } finally { cleanup(); }
});

test("/export and /import round-trip preserves positions, bookmarks, notes, tags", async () => {
  const { storage: storageA, dir: dirA, cleanup: cleanupA } = makeTempStorage();
  const { storage: storageB, cleanup: cleanupB } = makeTempStorage();
  try {
    const oldTime = Date.now() - 120_000;
    insertBook(storageA, "b1", "shared-hash", "Shared Book", "Author", oldTime);
    insertBook(storageB, "b1", "shared-hash", "Shared Book", "Author", oldTime);

    storageA.savePosition({ bookId: "b1", chapterIndex: 2, chapterProgress: 0.3, bookProgress: 0.4, blockOffset: 8 });
    storageA.addBookmark("b1", 1, 3, "Important");
    storageA.addNote("b1", "Great line", 0, 1);
    storageA.addTag("b1", "classic");

    const stateA = makeState(storageA, dirA);
    await executeCommand(stateA, "/export");

    const exportFile = path.join(dirA, "stealth-reader-export.json");
    const stateB = makeState(storageB, dirA);
    await executeCommand(stateB, `/import ${exportFile}`);

    assert.equal(storageB.getPosition("b1")?.chapterIndex, 2);
    assert.equal(storageB.listBookmarks("b1").length, 1);
    assert.equal(storageB.listNotes("b1").length, 1);
    assert.deepEqual(storageB.listTags("b1"), ["classic"]);
    assert.match(stateB.status, /1 position/);
  } finally {
    cleanupA();
    cleanupB();
  }
});
