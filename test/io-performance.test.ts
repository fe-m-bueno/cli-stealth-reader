import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Storage } from "../src/storage.js";
import { importAndOpen } from "../src/executor.js";
import { createWriteThrottle } from "../src/write-throttle.js";
import { createEmptyPaceState } from "../src/reading-pace.js";
import JSZip from "jszip";
import type { AppState, CanonicalBook } from "../src/types.js";

async function createEpubFixture(dir: string): Promise<string> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?>
    <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles>
        <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
      </rootfiles>
    </container>`
  );
  zip.file(
    "OEBPS/text/ch1.xhtml",
    `<!doctype html><html><body><h1>One</h1><p>First chapter begins here.</p></body></html>`
  );
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0"?>
    <package version="3.0" xmlns="http://www.idpf.org/2007/opf">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>Fixture Book</dc:title>
        <dc:creator>Fixture Author</dc:creator>
      </metadata>
      <manifest>
        <item id="chapter" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine>
        <itemref idref="chapter"/>
      </spine>
    </package>`
  );
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const filePath = path.join(dir, "fixture.epub");
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

function makeTempStorage(): { storage: Storage; dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stealth-reader-io-test-"));
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

function makeBook(id: string): CanonicalBook {
  return {
    id,
    title: `Title ${id}`,
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
        blocks: [{ id: `${id}-block`, type: "paragraph", text: "some words here" }],
        wordCount: 3
      }
    ]
  };
}

test("repeated hot-path storage calls prepare each SQL statement only once", () => {
  const { storage, cleanup } = makeTempStorage();
  try {
    storage.saveBook(makeBook("b1"), "plain");
    const original = storage.db.prepare.bind(storage.db);
    const prepared: string[] = [];
    (storage.db as unknown as { prepare: (sql: string) => unknown }).prepare = (sql: string) => {
      prepared.push(sql);
      return original(sql);
    };

    const position = { bookId: "b1", chapterIndex: 0, chapterProgress: 0, bookProgress: 0, blockOffset: 0 };
    storage.savePosition(position);
    storage.savePosition({ ...position, blockOffset: 1 });
    storage.savePosition({ ...position, blockOffset: 2 });
    storage.getSetting("themeId");
    storage.getSetting("renderMode");
    storage.saveReadingPace({ bookId: "b1", wpm: 200, activeMs: 1000, updatedAt: 1 });
    storage.saveReadingPace({ bookId: "b1", wpm: 210, activeMs: 2000, updatedAt: 2 });

    const counts = new Map<string, number>();
    for (const sql of prepared) {
      counts.set(sql, (counts.get(sql) ?? 0) + 1);
    }
    for (const [sql, count] of counts) {
      assert.equal(count, 1, `statement prepared ${count} times: ${sql}`);
    }
    assert.equal(storage.getPosition("b1")?.blockOffset, 2);
  } finally {
    cleanup();
  }
});

test("write throttle flushes on the leading edge immediately", () => {
  let now = 0;
  const throttle = createWriteThrottle(1500, () => now);
  let written = 0;
  throttle.schedule(() => written++);
  assert.equal(written, 1);
  assert.equal(throttle.hasPending(), false);
});

test("write throttle coalesces writes inside the window and flush() drains the latest", () => {
  let now = 0;
  const throttle = createWriteThrottle(1500, () => now);
  const writes: string[] = [];
  throttle.schedule(() => writes.push("a"));
  now = 100;
  throttle.schedule(() => writes.push("b"));
  now = 200;
  throttle.schedule(() => writes.push("c"));
  assert.deepEqual(writes, ["a"], "writes within the window are deferred");
  assert.equal(throttle.hasPending(), true);
  throttle.flush();
  assert.deepEqual(writes, ["a", "c"], "flush drains only the latest pending write");
  assert.equal(throttle.hasPending(), false);
  throttle.flush();
  assert.deepEqual(writes, ["a", "c"], "flush with nothing pending is a no-op");
});

test("write throttle writes immediately again after the window has elapsed", () => {
  let now = 0;
  const throttle = createWriteThrottle(1500, () => now);
  let written = 0;
  throttle.schedule(() => written++);
  now = 2000;
  throttle.schedule(() => written++);
  assert.equal(written, 2);
});

test("write throttle immediate option bypasses the window and clears pending writes", () => {
  let now = 0;
  const throttle = createWriteThrottle(1500, () => now);
  const writes: string[] = [];
  throttle.schedule(() => writes.push("a"));
  now = 100;
  throttle.schedule(() => writes.push("b"));
  throttle.schedule(() => writes.push("c"), { immediate: true });
  assert.deepEqual(writes, ["a", "c"]);
  assert.equal(throttle.hasPending(), false);
});

test("write throttle trailing timer flushes the pending write", async () => {
  const throttle = createWriteThrottle(30);
  const writes: string[] = [];
  throttle.schedule(() => writes.push("a"));
  throttle.schedule(() => writes.push("b"));
  assert.deepEqual(writes, ["a"]);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.deepEqual(writes, ["a", "b"]);
});

test("saveBook does not write a book.json cache file", () => {
  const { storage, dir, cleanup } = makeTempStorage();
  try {
    const book = makeBook("cache-check");
    storage.saveBook(book, "plain");
    const cachePath = path.join(dir, "cli-stealth-reader", "books", book.id, "book.json");
    assert.equal(fs.existsSync(cachePath), false, "book.json cache should no longer be written");
    assert.equal(storage.getBook(book.id)?.title, book.title);
  } finally {
    cleanup();
  }
});

test("importAndOpen reports Imported <title> when the import succeeds", async () => {
  const { storage, dir, cleanup } = makeTempStorage();
  try {
    const sourcePath = await createEpubFixture(dir);
    const state = {
      storage,
      currentBook: null,
      chapterIndex: 0,
      blockOffset: 0,
      focusMode: false,
      focusBlockIndex: 0,
      searchState: null,
      navHistory: [],
      navHistoryCursor: -1,
      renderMode: "plain",
      readingPace: createEmptyPaceState(),
      status: "Ready"
    } as unknown as AppState;
    await importAndOpen(state, sourcePath);
    assert.match(state.status, /^Imported /);
    assert.ok(state.currentBook);
  } finally {
    cleanup();
  }
});
