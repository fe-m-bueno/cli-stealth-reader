import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Storage } from "../src/storage.js";

function makeTempStorage(): { storage: Storage; dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stealth-reader-storage-test-"));
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

test("getPosition returns camelCase fields matching ReadingPosition interface", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    storage.savePosition({
      bookId: "test-book",
      chapterIndex: 7,
      chapterProgress: 0.6,
      bookProgress: 0.45,
      blockOffset: 33
    });

    const pos = storage.getPosition("test-book");
    assert.ok(pos !== null, "position should exist");
    assert.equal(pos.bookId, "test-book");
    assert.equal(pos.chapterIndex, 7);
    assert.equal(pos.blockOffset, 33);
    assert.ok(Math.abs(pos.bookProgress - 0.45) < 0.001);
  } finally {
    cleanup();
  }
});

test("getPosition returns null for a book with no saved position", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    const pos = storage.getPosition("nonexistent-book");
    assert.equal(pos, null);
  } finally {
    cleanup();
  }
});

test("savePosition overwrites the previous position for the same book", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    storage.savePosition({ bookId: "b1", chapterIndex: 2, chapterProgress: 0.3, bookProgress: 0.2, blockOffset: 10 });
    storage.savePosition({ bookId: "b1", chapterIndex: 5, chapterProgress: 0.8, bookProgress: 0.6, blockOffset: 42 });

    const pos = storage.getPosition("b1");
    assert.equal(pos?.chapterIndex, 5);
    assert.equal(pos?.blockOffset, 42);
  } finally {
    cleanup();
  }
});

test("adds, lists and deletes bookmarks", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    const created = storage.addBookmark("book-1", 2, 42, "Trecho");
    assert.ok(created.id.length > 0);
    assert.equal(created.bookId, "book-1");
    assert.equal(created.chapterIndex, 2);
    assert.equal(created.blockOffset, 42);
    assert.equal(created.label, "Trecho");

    const listed = storage.listBookmarks("book-1");
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, created.id);
    assert.equal(listed[0]?.createdAt, created.createdAt);

    storage.deleteBookmark(created.id);
    assert.deepEqual(storage.listBookmarks("book-1"), []);
  } finally {
    cleanup();
  }
});

test("getReadingPace returns null when missing and upserts book pace", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    assert.equal(storage.getReadingPace("book-1"), null);
    storage.db.prepare(`
      INSERT INTO books (id, title, author, source_path, import_hash, parser_version, last_opened_at, render_mode)
      VALUES (?, ?, ?, ?, ?, 1, ?, 'plain')
    `).run("book-1", "Book", "Author", "/tmp/book.epub", "hash", Date.now());
    storage.saveReadingPace({
      bookId: "book-1",
      wpm: 210.5,
      activeMs: 90_000,
      updatedAt: 1_700_000_000_000
    });
    const row = storage.getReadingPace("book-1");
    assert.ok(row);
    assert.equal(row.bookId, "book-1");
    assert.ok(Math.abs(row.wpm - 210.5) < 0.001);
    assert.equal(row.activeMs, 90_000);
    storage.removeBook("book-1");
    assert.equal(storage.getReadingPace("book-1"), null);
  } finally {
    cleanup();
  }
});

test("global pace settings round-trip via raw settings", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    storage.setRawSetting("globalWpm", "215.25");
    storage.setRawSetting("globalActiveMs", "120000");
    assert.equal(storage.getSetting("globalWpm"), "215.25");
    assert.equal(storage.getSetting("globalActiveMs"), "120000");
  } finally {
    cleanup();
  }
});

test("command history redacts Toggl authentication tokens", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    storage.saveCommandHistory("/toggl auth super-secret-token", "toggl");

    const row = storage.db.prepare("SELECT raw_command FROM command_history").get() as { raw_command: string };
    assert.equal(row.raw_command, "/toggl auth <redacted>");
    assert.equal(row.raw_command.includes("super-secret-token"), false);
  } finally {
    cleanup();
  }
});

test("opening an existing database redacts legacy Toggl tokens", () => {
  const { storage, dir } = makeTempStorage();
  storage.db.prepare(`
    INSERT INTO command_history (raw_command, normalized_name, created_at)
    VALUES (?, 'toggl', ?)
  `).run("/toggl auth legacy-secret-token", Date.now());
  storage.db.close();

  const reopened = new Storage();
  try {
    const row = reopened.db.prepare("SELECT raw_command FROM command_history").get() as { raw_command: string };
    assert.equal(row.raw_command, "/toggl auth <redacted>");
  } finally {
    reopened.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("reading layout settings persist with numeric validation", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    storage.setSetting("fontScale", 1.3);
    storage.setSetting("marginSize", 12);
    storage.setSetting("lineSpacing", "relaxed");
    storage.setSetting("mouseCapture", true);

    const settings = storage.getSettings();
    assert.equal(settings.fontScale, 1.3);
    assert.equal(settings.marginSize, 12);
    assert.equal(settings.lineSpacing, "relaxed");
    assert.equal(settings.mouseCapture, true);

    storage.setRawSetting("fontScale", "1.7");
    storage.setRawSetting("marginSize", "30");
    storage.setRawSetting("lineSpacing", "huge");
    const fallback = storage.getSettings();
    assert.equal(fallback.fontScale, 1);
    assert.equal(fallback.marginSize, 0);
    assert.equal(fallback.lineSpacing, "normal");
  } finally {
    cleanup();
  }
});

test("saveSettings atomically round-trips the complete reader configuration", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    const settings = storage.getSettings();
    storage.saveSettings({
      ...settings,
      renderMode: "plain",
      fontScale: 1.5,
      marginSize: 24,
      lineSpacing: "compact",
      mouseCapture: true
    });

    const saved = storage.getSettings();
    assert.equal(saved.renderMode, "plain");
    assert.equal(saved.fontScale, 1.5);
    assert.equal(saved.marginSize, 24);
    assert.equal(saved.lineSpacing, "compact");
    assert.equal(saved.mouseCapture, true);
  } finally {
    cleanup();
  }
});

test("saveSettings rolls back every preference when one write fails", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    const before = storage.getSettings();
    storage.db.exec(`
      CREATE TRIGGER reject_margin_setting
      BEFORE UPDATE ON settings
      WHEN NEW.key = 'marginSize' AND NEW.value = '24'
      BEGIN
        SELECT RAISE(ABORT, 'rejected setting');
      END;
    `);

    assert.throws(() => storage.saveSettings({
      ...before,
      themeId: "solarized",
      fontScale: 1.5,
      marginSize: 24
    }), /rejected setting/);

    assert.deepEqual(storage.getSettings(), before);
  } finally {
    cleanup();
  }
});

test("fresh installs default to mouseCapture off so native terminal text selection works", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    assert.equal(storage.getSettings().mouseCapture, false);
  } finally {
    cleanup();
  }
});
