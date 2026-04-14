import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  AppSettings,
  CanonicalBook,
  CanonicalChapter,
  ImportDiagnostic,
  LibraryEntry,
  ProgressVisibility,
  ReadingPosition,
  RenderMode
} from "./types.js";
import { getAppPaths } from "./paths.js";

export type { AppSettings };

const DEFAULT_SETTINGS: AppSettings = {
  themeId: "codex",
  progressVisibility: "both",
  renderMode: "code"
};

export class Storage {
  readonly db: DatabaseSync;
  readonly chapterCacheDir: string;

  constructor() {
    const paths = getAppPaths();
    this.chapterCacheDir = path.join(paths.cacheDir, "books");
    fs.mkdirSync(this.chapterCacheDir, { recursive: true });
    this.db = new DatabaseSync(paths.dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS books (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        author TEXT NOT NULL,
        source_path TEXT NOT NULL,
        import_hash TEXT NOT NULL,
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
    `);
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
      if (row.key in settings) {
        (settings as Record<string, string>)[row.key] = row.value;
      }
    }
    return settings;
  }

  setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  saveBook(book: CanonicalBook, renderMode: RenderMode): void {
    const now = Date.now();
    this.db.exec("BEGIN");
    try {
      this.db.prepare(`
        INSERT INTO books (id, title, author, source_path, import_hash, last_opened_at, render_mode)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          author = excluded.author,
          source_path = excluded.source_path,
          import_hash = excluded.import_hash,
          last_opened_at = excluded.last_opened_at,
          render_mode = excluded.render_mode
      `).run(book.id, book.title, book.author, book.sourcePath, book.importHash, now, renderMode);

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
        last_opened_at AS lastOpenedAt,
        render_mode AS renderMode
      FROM books
      ORDER BY last_opened_at DESC
    `).all() as unknown as LibraryEntry[];
  }

  removeBook(bookId: string): void {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM books WHERE id = ?").run(bookId);
      this.db.prepare("DELETE FROM chapters WHERE book_id = ?").run(bookId);
      this.db.prepare("DELETE FROM diagnostics WHERE book_id = ?").run(bookId);
      this.db.prepare("DELETE FROM positions WHERE book_id = ?").run(bookId);
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
    return (this.db.prepare("SELECT * FROM positions WHERE book_id = ?").get(bookId) as ReadingPosition | undefined) ?? null;
  }

  getLatestBookId(): string | null {
    const row = this.db.prepare("SELECT id FROM books ORDER BY last_opened_at DESC LIMIT 1").get() as { id: string } | undefined;
    return row?.id ?? null;
  }

  saveCommandHistory(rawCommand: string, normalizedName: string): void {
    this.db.prepare("INSERT INTO command_history (raw_command, normalized_name, created_at) VALUES (?, ?, ?)").run(rawCommand, normalizedName, Date.now());
  }
}
