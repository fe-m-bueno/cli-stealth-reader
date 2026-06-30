import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import type {
  AppSettings,
  Bookmark,
  CanonicalBook,
  CanonicalChapter,
  CodeDensity,
  ExportData,
  ImportDiagnostic,
  ImportResult,
  LibraryEntry,
  LibraryEntryWithProgress,
  LibrarySortKey,
  Note,
  ProgressVisibility,
  ReadingPosition,
  RenderMode,
  SortDirection
} from "./types.js";
import { getAppPaths } from "./paths.js";
import { EPUB_PARSER_VERSION } from "./parser/epub.js";

export type { AppSettings };

const DEFAULT_SETTINGS: AppSettings = {
  themeId: "codex",
  appearanceThemeId: "dark",
  progressVisibility: "both",
  renderMode: "code",
  codeLanguage: "typescript",
  codeDensity: 3,
  plainHighlight: true
};

export class Storage {
  readonly db: Database.Database;
  readonly chapterCacheDir: string;

  constructor() {
    const paths = getAppPaths();
    this.chapterCacheDir = path.join(paths.cacheDir, "books");
    fs.mkdirSync(this.chapterCacheDir, { recursive: true });
    this.db = new Database(paths.dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS books (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        author TEXT NOT NULL,
        source_path TEXT NOT NULL,
        import_hash TEXT NOT NULL,
        parser_version INTEGER NOT NULL DEFAULT 1,
        last_opened_at INTEGER NOT NULL,
        render_mode TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chapters (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        title TEXT NOT NULL,
        href TEXT NOT NULL,
        depth INTEGER NOT NULL,
        word_count INTEGER NOT NULL,
        blocks_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS diagnostics (
        book_id TEXT NOT NULL,
        severity TEXT NOT NULL,
        message TEXT NOT NULL,
        context TEXT
      );
      CREATE TABLE IF NOT EXISTS positions (
        book_id TEXT PRIMARY KEY,
        chapter_index INTEGER NOT NULL,
        chapter_progress REAL NOT NULL,
        book_progress REAL NOT NULL,
        block_offset INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS command_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        raw_command TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bookmarks (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        block_offset INTEGER NOT NULL,
        label TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS book_tags (
        book_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY (book_id, tag)
      );
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        chapter_index INTEGER,
        block_offset INTEGER,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_book_tags_tag ON book_tags(tag);
      CREATE INDEX IF NOT EXISTS idx_notes_book_id ON notes(book_id);
    `);
    const columns = this.db.prepare("PRAGMA table_info(books)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "parser_version")) {
      this.db.exec("ALTER TABLE books ADD COLUMN parser_version INTEGER NOT NULL DEFAULT 1");
    }
    this.seedSettings();
  }

  private seedSettings(): void {
    const insert = this.db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      insert.run(key, String(value));
    }
  }

  getSettings(): AppSettings {
    const rows = this.db.prepare("SELECT key, value FROM settings").all() as Array<{ key: string; value: string }>;
    const settings = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      if (row.key === "codeDensity") {
        const parsed = Number(row.value);
        if ([1, 2, 3, 4, 5].includes(parsed)) {
          settings.codeDensity = parsed as CodeDensity;
        }
      } else if (row.key === "plainHighlight") {
        settings.plainHighlight = row.value === "true";
      } else if (row.key in settings) {
        (settings as Record<string, unknown>)[row.key] = row.value;
      }
    }
    return settings;
  }

  setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));
  }

  saveBook(book: CanonicalBook, renderMode: RenderMode): void {
    const now = Date.now();
    this.db.exec("BEGIN");
    try {
      this.db.prepare(`
        INSERT INTO books (id, title, author, source_path, import_hash, parser_version, last_opened_at, render_mode)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          author = excluded.author,
          source_path = excluded.source_path,
          import_hash = excluded.import_hash,
          parser_version = excluded.parser_version,
          last_opened_at = excluded.last_opened_at,
          render_mode = excluded.render_mode
      `).run(book.id, book.title, book.author, book.sourcePath, book.importHash, book.parserVersion ?? EPUB_PARSER_VERSION, now, renderMode);

      this.db.prepare("DELETE FROM chapters WHERE book_id = ?").run(book.id);
      this.db.prepare("DELETE FROM diagnostics WHERE book_id = ?").run(book.id);

      const chapterStmt = this.db.prepare(`
        INSERT INTO chapters (id, book_id, chapter_index, title, href, depth, word_count, blocks_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const chapter of book.chapters) {
        chapterStmt.run(
          chapter.id,
          book.id,
          chapter.index,
          chapter.title,
          chapter.href,
          chapter.depth,
          chapter.wordCount,
          JSON.stringify(chapter.blocks)
        );
      }

      const diagnosticsStmt = this.db.prepare(`
        INSERT INTO diagnostics (book_id, severity, message, context)
        VALUES (?, ?, ?, ?)
      `);
      for (const diagnostic of book.diagnostics) {
        diagnosticsStmt.run(book.id, diagnostic.severity, diagnostic.message, diagnostic.context ?? null);
      }

      const bookDir = path.join(this.chapterCacheDir, book.id);
      fs.mkdirSync(bookDir, { recursive: true });
      fs.writeFileSync(path.join(bookDir, "book.json"), JSON.stringify(book, null, 2), "utf8");
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getBook(bookId: string): CanonicalBook | null {
    const bookRow = this.db.prepare("SELECT * FROM books WHERE id = ?").get(bookId) as
      | {
          id: string;
          title: string;
          author: string;
          source_path: string;
          import_hash: string;
          parser_version?: number;
        }
      | undefined;
    if (!bookRow) {
      return null;
    }
    const chapterRows = this.db.prepare(
      "SELECT * FROM chapters WHERE book_id = ? ORDER BY chapter_index ASC"
    ).all(bookId) as Array<{
      id: string;
      chapter_index: number;
      title: string;
      href: string;
      depth: number;
      word_count: number;
      blocks_json: string;
    }>;
    const diagnostics = this.db.prepare("SELECT severity, message, context FROM diagnostics WHERE book_id = ?").all(bookId) as unknown as ImportDiagnostic[];
    const chapters: CanonicalChapter[] = chapterRows.map((row) => ({
      id: row.id,
      index: row.chapter_index,
      title: row.title,
      href: row.href,
      depth: row.depth,
      wordCount: row.word_count,
      blocks: JSON.parse(row.blocks_json)
    }));
    return {
      id: bookRow.id,
      title: bookRow.title,
      author: bookRow.author,
      sourcePath: bookRow.source_path,
      importHash: bookRow.import_hash,
      parserVersion: bookRow.parser_version,
      chapters,
      diagnostics
    };
  }

  listBooks(): LibraryEntry[] {
    return this.db.prepare(`
      SELECT
        id,
        title,
        author,
        source_path AS sourcePath,
        import_hash AS importHash,
        parser_version AS parserVersion,
        last_opened_at AS lastOpenedAt,
        render_mode AS renderMode
      FROM books
      ORDER BY last_opened_at DESC
    `).all() as unknown as LibraryEntry[];
  }

  listBooksWithProgress(sort: LibrarySortKey = "lastOpened", dir: SortDirection = "desc", tagFilter?: string): LibraryEntryWithProgress[] {
    let orderClause: string;
    if (sort === "title") {
      orderClause = `LOWER(b.title) ${dir === "asc" ? "ASC" : "DESC"}`;
    } else if (sort === "author") {
      orderClause = `LOWER(b.author) ${dir === "asc" ? "ASC" : "DESC"}`;
    } else {
      orderClause = `b.last_opened_at ${dir === "asc" ? "ASC" : "DESC"}`;
    }
    const rows = this.db.prepare(`
      SELECT
        b.id,
        b.title,
        b.author,
        b.source_path AS sourcePath,
        b.import_hash AS importHash,
        b.parser_version AS parserVersion,
        b.last_opened_at AS lastOpenedAt,
        b.render_mode AS renderMode,
        p.chapter_index AS chapterIndex,
        p.book_progress AS bookProgress,
        c.title AS chapterTitle
      FROM books b
      LEFT JOIN positions p ON p.book_id = b.id
      LEFT JOIN chapters c ON c.book_id = b.id AND c.chapter_index = p.chapter_index
      ORDER BY ${orderClause}
    `).all() as unknown as LibraryEntryWithProgress[];
    let filtered = rows;
    if (tagFilter) {
      const taggedIds = new Set(
        (this.db.prepare("SELECT book_id FROM book_tags WHERE LOWER(tag) = LOWER(?)").all(tagFilter) as Array<{ book_id: string }>).map((r) => r.book_id)
      );
      filtered = rows.filter((r) => taggedIds.has(r.id));
    }
    if (sort === "progress") {
      const multiplier = dir === "asc" ? 1 : -1;
      return filtered.sort((a, b) => {
        const ap = a.bookProgress;
        const bp = b.bookProgress;
        if (ap === null && bp === null) return 0;
        if (ap === null) return 1;
        if (bp === null) return -1;
        return (ap - bp) * multiplier;
      });
    }
    return filtered;
  }

  removeBook(bookId: string): void {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM books WHERE id = ?").run(bookId);
      this.db.prepare("DELETE FROM chapters WHERE book_id = ?").run(bookId);
      this.db.prepare("DELETE FROM diagnostics WHERE book_id = ?").run(bookId);
      this.db.prepare("DELETE FROM positions WHERE book_id = ?").run(bookId);
      this.db.prepare("DELETE FROM bookmarks WHERE book_id = ?").run(bookId);
      this.db.prepare("DELETE FROM book_tags WHERE book_id = ?").run(bookId);
      this.db.prepare("DELETE FROM notes WHERE book_id = ?").run(bookId);
      fs.rmSync(path.join(this.chapterCacheDir, bookId), { recursive: true, force: true });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  savePosition(position: ReadingPosition): void {
    this.db.prepare(`
      INSERT INTO positions (book_id, chapter_index, chapter_progress, book_progress, block_offset)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(book_id) DO UPDATE SET
        chapter_index = excluded.chapter_index,
        chapter_progress = excluded.chapter_progress,
        book_progress = excluded.book_progress,
        block_offset = excluded.block_offset
    `).run(position.bookId, position.chapterIndex, position.chapterProgress, position.bookProgress, position.blockOffset);
    this.db.prepare("UPDATE books SET last_opened_at = ? WHERE id = ?").run(Date.now(), position.bookId);
  }

  getPosition(bookId: string): ReadingPosition | null {
    return (this.db.prepare(`
      SELECT
        book_id AS bookId,
        chapter_index AS chapterIndex,
        chapter_progress AS chapterProgress,
        book_progress AS bookProgress,
        block_offset AS blockOffset
      FROM positions WHERE book_id = ?
    `).get(bookId) as ReadingPosition | undefined) ?? null;
  }

  getLatestBookId(): string | null {
    const row = this.db.prepare("SELECT id FROM books ORDER BY last_opened_at DESC LIMIT 1").get() as { id: string } | undefined;
    return row?.id ?? null;
  }

  needsEpubReimport(bookId: string): boolean {
    const row = this.db.prepare("SELECT parser_version, source_path FROM books WHERE id = ?").get(bookId) as { parser_version?: number; source_path: string } | undefined;
    if (!row?.source_path.toLowerCase().endsWith(".epub")) return false;
    return (row?.parser_version ?? 1) < EPUB_PARSER_VERSION;
  }

  saveCommandHistory(rawCommand: string, normalizedName: string): void {
    this.db.prepare("INSERT INTO command_history (raw_command, normalized_name, created_at) VALUES (?, ?, ?)").run(rawCommand, normalizedName, Date.now());
  }

  addBookmark(bookId: string, chapterIndex: number, blockOffset: number, label?: string): Bookmark {
    const bookmark: Bookmark = {
      id: crypto.randomUUID(),
      bookId,
      chapterIndex,
      blockOffset,
      label: label?.trim() || null,
      createdAt: Date.now()
    };
    this.db.prepare(`
      INSERT INTO bookmarks (id, book_id, chapter_index, block_offset, label, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(bookmark.id, bookmark.bookId, bookmark.chapterIndex, bookmark.blockOffset, bookmark.label, bookmark.createdAt);
    return bookmark;
  }

  listBookmarks(bookId: string): Bookmark[] {
    return this.db.prepare(`
      SELECT
        id,
        book_id AS bookId,
        chapter_index AS chapterIndex,
        block_offset AS blockOffset,
        label,
        created_at AS createdAt
      FROM bookmarks
      WHERE book_id = ?
      ORDER BY created_at DESC
    `).all(bookId) as Bookmark[];
  }

  deleteBookmark(id: string): void {
    this.db.prepare("DELETE FROM bookmarks WHERE id = ?").run(id);
  }

  addTag(bookId: string, tag: string): void {
    this.db.prepare("INSERT OR IGNORE INTO book_tags (book_id, tag) VALUES (?, ?)").run(bookId, tag.trim());
  }

  removeTag(bookId: string, tag: string): void {
    this.db.prepare("DELETE FROM book_tags WHERE book_id = ? AND tag = ?").run(bookId, tag.trim());
  }

  listTags(bookId: string): string[] {
    return (
      this.db.prepare("SELECT tag FROM book_tags WHERE book_id = ? ORDER BY tag").all(bookId) as Array<{ tag: string }>
    ).map((r) => r.tag);
  }

  listTagsByBookId(): Map<string, string[]> {
    const rows = this.db.prepare("SELECT book_id, tag FROM book_tags ORDER BY book_id, tag").all() as Array<{
      book_id: string;
      tag: string;
    }>;
    const map = new Map<string, string[]>();
    for (const row of rows) {
      if (!map.has(row.book_id)) {
        map.set(row.book_id, []);
      }
      map.get(row.book_id)!.push(row.tag);
    }
    return map;
  }

  addNote(bookId: string, content: string, chapterIndex: number, blockOffset: number): Note {
    const note: Note = {
      id: crypto.randomUUID(),
      bookId,
      chapterIndex,
      blockOffset,
      content: content.trim(),
      createdAt: Date.now()
    };
    this.db.prepare(`
      INSERT INTO notes (id, book_id, chapter_index, block_offset, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(note.id, note.bookId, note.chapterIndex, note.blockOffset, note.content, note.createdAt);
    return note;
  }

  listNotes(bookId: string): Note[] {
    return this.db.prepare(`
      SELECT
        id,
        book_id AS bookId,
        chapter_index AS chapterIndex,
        block_offset AS blockOffset,
        content,
        created_at AS createdAt
      FROM notes
      WHERE book_id = ?
      ORDER BY created_at DESC, id DESC
    `).all(bookId) as Note[];
  }

  deleteNote(id: string): void {
    this.db.prepare("DELETE FROM notes WHERE id = ?").run(id);
  }

  exportAll(): ExportData {
    const exportedAt = new Date().toISOString();

    const posRows = this.db.prepare(`
      SELECT b.import_hash AS importHash, b.title, p.chapter_index AS chapterIndex,
             p.block_offset AS blockOffset, p.book_progress AS bookProgress
      FROM positions p
      JOIN books b ON b.id = p.book_id
    `).all() as Array<{ importHash: string; title: string; chapterIndex: number; blockOffset: number; bookProgress: number }>;

    const bmRows = this.db.prepare(`
      SELECT b.import_hash AS importHash, b.title,
             bm.chapter_index AS chapterIndex, bm.block_offset AS blockOffset,
             bm.label, bm.created_at AS createdAt
      FROM bookmarks bm
      JOIN books b ON b.id = bm.book_id
    `).all() as Array<{ importHash: string; title: string; chapterIndex: number; blockOffset: number; label: string | null; createdAt: number }>;

    const noteRows = this.db.prepare(`
      SELECT b.import_hash AS importHash, b.title,
             n.chapter_index AS chapterIndex, n.block_offset AS blockOffset,
             n.content, n.created_at AS createdAt
      FROM notes n
      JOIN books b ON b.id = n.book_id
    `).all() as Array<{ importHash: string; title: string; chapterIndex: number | null; blockOffset: number | null; content: string; createdAt: number }>;

    const tagRows = this.db.prepare(`
      SELECT b.import_hash AS importHash, b.title, bt.tag
      FROM book_tags bt
      JOIN books b ON b.id = bt.book_id
    `).all() as Array<{ importHash: string; title: string; tag: string }>;

    return {
      version: 1,
      exportedAt,
      positions: posRows.map((r) => ({ bookImportHash: r.importHash, bookTitle: r.title, chapterIndex: r.chapterIndex, blockOffset: r.blockOffset, bookProgress: r.bookProgress })),
      bookmarks: bmRows.map((r) => ({ bookImportHash: r.importHash, bookTitle: r.title, chapterIndex: r.chapterIndex, blockOffset: r.blockOffset, label: r.label, createdAt: r.createdAt })),
      notes: noteRows.map((r) => ({ bookImportHash: r.importHash, bookTitle: r.title, chapterIndex: r.chapterIndex, blockOffset: r.blockOffset, content: r.content, createdAt: r.createdAt })),
      tags: tagRows.map((r) => ({ bookImportHash: r.importHash, bookTitle: r.title, tag: r.tag }))
    };
  }

  importMerge(data: ExportData): ImportResult {
    const exportedAtMs = new Date(data.exportedAt).getTime();
    if (Number.isNaN(exportedAtMs)) {
      throw new Error("Export file has an invalid exportedAt date.");
    }

    const findBook = this.db.prepare("SELECT id, last_opened_at FROM books WHERE import_hash = ?");
    const findBookById = this.db.prepare("SELECT id FROM books WHERE import_hash = ?");
    const updatePos = this.db.prepare(`
      INSERT INTO positions (book_id, chapter_index, chapter_progress, book_progress, block_offset)
      VALUES (?, ?, 0, ?, ?)
      ON CONFLICT(book_id) DO UPDATE SET
        chapter_index = excluded.chapter_index,
        chapter_progress = 0,
        book_progress = excluded.book_progress,
        block_offset = excluded.block_offset
    `);
    const findBm = this.db.prepare("SELECT id FROM bookmarks WHERE book_id = ? AND chapter_index = ? AND block_offset = ?");
    const insertBm = this.db.prepare("INSERT INTO bookmarks (id, book_id, chapter_index, block_offset, label, created_at) VALUES (?, ?, ?, ?, ?, ?)");
    const findNote = this.db.prepare("SELECT id FROM notes WHERE book_id = ? AND content = ? AND created_at = ?");
    const insertNote = this.db.prepare("INSERT INTO notes (id, book_id, chapter_index, block_offset, content, created_at) VALUES (?, ?, ?, ?, ?, ?)");
    const insertTag = this.db.prepare("INSERT OR IGNORE INTO book_tags (book_id, tag) VALUES (?, ?)");

    let positionsUpdated = 0;
    let bookmarksAdded = 0;
    let notesAdded = 0;
    let tagsAdded = 0;

    const tx = this.db.transaction(() => {
      for (const pos of data.positions) {
        const book = findBook.get(pos.bookImportHash) as { id: string; last_opened_at: number } | undefined;
        if (!book) continue;
        if (exportedAtMs > book.last_opened_at) {
          updatePos.run(book.id, pos.chapterIndex, pos.bookProgress, pos.blockOffset);
          positionsUpdated++;
        }
      }

      for (const bm of data.bookmarks) {
        const book = findBookById.get(bm.bookImportHash) as { id: string } | undefined;
        if (!book) continue;
        if (!findBm.get(book.id, bm.chapterIndex, bm.blockOffset)) {
          insertBm.run(crypto.randomUUID(), book.id, bm.chapterIndex, bm.blockOffset, bm.label, bm.createdAt);
          bookmarksAdded++;
        }
      }

      for (const note of data.notes) {
        const book = findBookById.get(note.bookImportHash) as { id: string } | undefined;
        if (!book) continue;
        if (!findNote.get(book.id, note.content, note.createdAt)) {
          insertNote.run(crypto.randomUUID(), book.id, note.chapterIndex, note.blockOffset, note.content, note.createdAt);
          notesAdded++;
        }
      }

      for (const tag of data.tags) {
        const book = findBookById.get(tag.bookImportHash) as { id: string } | undefined;
        if (!book) continue;
        const result = insertTag.run(book.id, tag.tag);
        if (result.changes > 0) tagsAdded++;
      }
    });

    tx();
    return { positionsUpdated, bookmarksAdded, notesAdded, tagsAdded };
  }
}
