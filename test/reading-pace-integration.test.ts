import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openBook } from "../src/executor.js";
import { createEmptyPaceState } from "../src/reading-pace.js";
import { Storage } from "../src/storage.js";
import type { AppState, CanonicalBook } from "../src/types.js";

function makeBook(id: string): CanonicalBook {
  return {
    id,
    title: id,
    author: "Author",
    sourcePath: `/tmp/${id}.txt`,
    importHash: `hash-${id}`,
    diagnostics: [],
    chapters: [
      {
        id: `${id}-chapter`,
        index: 0,
        title: "Chapter",
        href: "chapter",
        depth: 0,
        blocks: [{ id: `${id}-block`, type: "paragraph", text: "some words" }],
        wordCount: 2
      }
    ]
  };
}

test("opening another book flushes the previous pace and loads the target pace", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stealth-pace-integration-"));
  process.env.XDG_DATA_HOME = dir;
  process.env.XDG_CACHE_HOME = dir;
  const storage = new Storage();
  const first = makeBook("first");
  const second = makeBook("second");

  try {
    storage.saveBook(first, "plain");
    storage.saveBook(second, "plain");
    storage.saveReadingPace({
      bookId: second.id,
      wpm: 275,
      activeMs: 180_000,
      updatedAt: 1
    });

    const state = {
      storage,
      currentBook: first,
      readingPace: createEmptyPaceState({
        bookId: first.id,
        globalWpm: 210,
        globalActiveMs: 300_000,
        bookWpm: 190,
        bookActiveMs: 120_000
      })
    } as AppState;

    await openBook(state, second);

    assert.deepEqual(storage.getReadingPace(first.id), {
      bookId: first.id,
      wpm: 190,
      activeMs: 120_000,
      updatedAt: storage.getReadingPace(first.id)!.updatedAt
    });
    assert.equal(storage.getSetting("globalWpm"), "210");
    assert.equal(storage.getSetting("globalActiveMs"), "300000");
    assert.equal(state.currentBook, second);
    assert.equal(state.readingPace.bookId, second.id);
    assert.equal(state.readingPace.bookWpm, 275);
    assert.equal(state.readingPace.bookActiveMs, 180_000);
    assert.equal(state.readingPace.globalWpm, 210);
    assert.equal(state.readingPace.lastWordCursor, null);
    assert.equal(state.readingPace.lastSampleAt, null);
  } finally {
    storage.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
