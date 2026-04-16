import fs from "node:fs";
import path from "node:path";
import { parseSlashCommand } from "./commands.js";
import { discoverBooks } from "./discovery.js";
import { mapBlockOffsetToFocusIndex, mapFocusIndexToBlockOffset } from "./focus.js";
import { EPUB_PARSER_VERSION, importEpub } from "./parser/epub.js";
import { importFile } from "./parser/index.js";
import { renderBlocks } from "./renderers.js";
import { computeChapterMaxOffset, getViewportLayout } from "./screen.js";
import { openSettingsPanel } from "./settings-panel.js";
import { APPEARANCE_THEMES, THEMES, applyAppearanceTheme } from "./themes.js";
import type {
  AppState,
  CanonicalBook,
  CanonicalChapter,
  CodeDensity,
  CodeLanguage,
  ExportData,
  FolderDiscovery,
  LibraryEntry,
  LibrarySortKey,
  ParsedCommandResult,
  ProgressVisibility,
  SearchHit
} from "./types.js";

export function pushNavHistory(state: AppState): void {
  if (!state.currentBook) {
    return;
  }
  state.navHistory = state.navHistory.slice(0, state.navHistoryCursor + 1);
  const last = state.navHistory[state.navHistory.length - 1];
  if (last && last.chapterIndex === state.chapterIndex && last.blockOffset === state.blockOffset) {
    state.navHistoryCursor = state.navHistory.length - 1;
    return;
  }
  state.navHistory.push({ chapterIndex: state.chapterIndex, blockOffset: state.blockOffset });
  if (state.navHistory.length > 50) {
    state.navHistory.shift();
  }
  state.navHistoryCursor = state.navHistory.length - 1;
}

function findBookByQuery(books: LibraryEntry[], query: string): LibraryEntry | undefined {
  const q = query.toLowerCase();
  return books.find((book) => book.title.toLowerCase().includes(q) || book.author.toLowerCase().includes(q));
}

export async function openBook(state: AppState, book: CanonicalBook): Promise<void> {
  const ext = book.sourcePath.toLowerCase();
  const isEpub = ext.endsWith(".epub");
  if (isEpub && (book.parserVersion ?? 1) < EPUB_PARSER_VERSION && fs.existsSync(book.sourcePath)) {
    const refreshed = await importFile(book.sourcePath);
    state.storage.saveBook(refreshed, state.renderMode);
    book = refreshed;
  }
  state.currentBook = book;
  const existing = state.storage.getPosition(book.id);
  state.chapterIndex = existing?.chapterIndex ?? 0;
  state.blockOffset = existing?.blockOffset ?? 0;
  state.focusMode = false;
  state.focusBlockIndex = 0;
  state.searchState = null;
  state.navHistory = [];
  state.navHistoryCursor = -1;
  state.status = `Opened ${book.title}`;
}

export async function importAndOpen(state: AppState, filePath: string, force = false): Promise<void> {
  if (!force && !fs.existsSync(filePath)) {
    state.status = `File not found: ${filePath}`;
    return;
  }
  const book = await importFile(filePath);
  state.storage.saveBook(book, state.renderMode);
  await openBook(state, book);
}

async function refreshDiscoveries(state: AppState): Promise<void> {
  state.cwd = process.cwd();
  state.discoveries = await discoverBooks(state.cwd);
}

function filterDiscoveries(discoveries: FolderDiscovery[], query: string): FolderDiscovery[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return discoveries;
  }
  return discoveries.filter((item) => item.fileName.toLowerCase().includes(normalized));
}

export function openFilePicker(
  state: AppState,
  items: FolderDiscovery[],
  options?: {
    force?: boolean;
    status?: string;
  }
): void {
  state.overlay = "file-picker";
  state.overlayCursor = 0;
  state.filePickerItems = items;
  state.filePickerCursor = 0;
  state.filePickerSelected = new Set();
  state.filePickerForce = Boolean(options?.force);
  state.status = options?.status ?? (items.length > 0 ? "Opened file picker." : "No books found in this folder.");
}

type CommandHandler = (state: AppState, parsed: ParsedCommandResult) => Promise<void>;

function viewportForCommand(state: AppState): { contentWidth: number; bodyHeight: number } {
  const w = process.stdout.columns || 120;
  const h = process.stdout.rows || 40;
  const layout = getViewportLayout(state, w, h);
  return { contentWidth: layout.contentWidth, bodyHeight: layout.bodyHeight };
}

function effectiveWordCount(chapter: CanonicalChapter): number {
  if (chapter.wordCount > 0) {
    return chapter.wordCount;
  }
  const fromText = chapter.blocks.reduce((sum, block) => sum + block.text.length, 0);
  return fromText > 0 ? fromText : 1;
}

function firstLineOfBlock(
  state: AppState,
  chapterIndex: number,
  blockIndex: number,
  contentWidth: number
): number {
  const chapter = state.currentBook!.chapters[chapterIndex]!;
  const prefix = chapter.blocks.slice(0, blockIndex);
  return renderBlocks(
    prefix,
    state.renderMode,
    contentWidth,
    state.theme,
    state.codeLanguage,
    state.codeDensity,
    undefined,
    state.plainHighlight
  ).length;
}

export function applySearchHit(state: AppState, hit: SearchHit): void {
  const { contentWidth, bodyHeight } = viewportForCommand(state);
  state.chapterIndex = hit.chapterIndex;
  const lineStart = firstLineOfBlock(state, hit.chapterIndex, hit.blockIndex, contentWidth);
  const maxOff = computeChapterMaxOffset(state, contentWidth, bodyHeight);
  state.blockOffset = Math.min(lineStart, maxOff);
  if (state.focusMode) {
    state.focusBlockIndex = hit.blockIndex;
  }
}

function collectSearchHits(state: AppState, query: string, global: boolean): SearchHit[] {
  const book = state.currentBook!;
  const q = query.toLowerCase();
  const hits: SearchHit[] = [];
  const chapterIndexes = global
    ? book.chapters.map((_, index) => index)
    : [state.chapterIndex];
  for (const chapterIndex of chapterIndexes) {
    const chapter = book.chapters[chapterIndex];
    if (!chapter) {
      continue;
    }
    chapter.blocks.forEach((block, blockIndex) => {
      if (block.text.toLowerCase().includes(q)) {
        hits.push({ chapterIndex, blockIndex, lineIndex: 0 });
      }
    });
  }
  return hits;
}

function autoBookmarkLabel(chapterIndex: number, blockOffset: number): string {
  return `Ch.${chapterIndex + 1} §${blockOffset}`;
}

function findBookmarkIdByQuery(state: AppState, query: string): string | null {
  const bookId = state.currentBook?.id;
  if (!bookId) {
    return null;
  }
  const bookmarks = state.storage.listBookmarks(bookId);
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const exactId = bookmarks.find((item) => item.id === query.trim());
  if (exactId) {
    return exactId.id;
  }
  const exactLabel = bookmarks.find((item) => item.label?.toLowerCase() === normalized);
  if (exactLabel) {
    return exactLabel.id;
  }
  const partialLabel = bookmarks.filter((item) => item.label?.toLowerCase().includes(normalized));
  return partialLabel.length === 1 ? partialLabel[0]!.id : null;
}

const handlers: Record<string, CommandHandler> = {
  prev: async (state, parsed) => {
    if (state.currentBook) {
      pushNavHistory(state);
      const count = Math.max(1, Number(parsed.args[0] ?? "1"));
      state.chapterIndex = Math.max(0, state.chapterIndex - count);
      state.blockOffset = 0;
      pushNavHistory(state);
      state.status = `Moved to chapter ${state.chapterIndex + 1}`;
    }
  },

  next: async (state, parsed) => {
    if (state.currentBook) {
      pushNavHistory(state);
      const count = Math.max(1, Number(parsed.args[0] ?? "1"));
      state.chapterIndex = Math.min(state.currentBook.chapters.length - 1, state.chapterIndex + count);
      state.blockOffset = 0;
      pushNavHistory(state);
      state.status = `Moved to chapter ${state.chapterIndex + 1}`;
    }
  },

  chapters: async (state) => {
    state.overlay = "chapters";
    state.overlayCursor = state.chapterIndex;
    state.status = "Opened table of contents";
  },

  mark: async (state, parsed) => {
    if (!state.currentBook) {
      state.status = "No book open.";
      return;
    }
    const label = parsed.args.join(" ").trim();
    const bookmark = state.storage.addBookmark(
      state.currentBook.id,
      state.chapterIndex,
      state.blockOffset,
      label || autoBookmarkLabel(state.chapterIndex, state.blockOffset)
    );
    state.status = `Bookmark saved (${bookmark.id.slice(0, 8)})`;
  },

  marks: async (state) => {
    if (!state.currentBook) {
      state.status = "No book open.";
      return;
    }
    const bookmarks = state.storage.listBookmarks(state.currentBook.id);
    state.overlay = "bookmarks";
    state.overlayCursor = 0;
    state.status = bookmarks.length > 0 ? "Opened bookmarks." : "No bookmarks in this book yet.";
  },

  delmark: async (state, parsed) => {
    if (!state.currentBook) {
      state.status = "No book open.";
      return;
    }
    const query = parsed.args.join(" ").trim();
    if (!query) {
      throw new Error("Use /delmark <id|label>");
    }
    const matchedId = findBookmarkIdByQuery(state, query);
    if (!matchedId) {
      state.status = `No bookmark matched "${query}".`;
      return;
    }
    state.storage.deleteBookmark(matchedId);
    state.status = "Bookmark deleted.";
  },

  changebook: async (state, parsed) => {
    const validSortKeys: LibrarySortKey[] = ["lastOpened", "title", "author", "progress"];
    const sortFlag = parsed.flags.sort as string | undefined;
    if (sortFlag) {
      if (validSortKeys.includes(sortFlag as LibrarySortKey)) {
        state.librarySortKey = sortFlag as LibrarySortKey;
      } else {
        throw new Error(`Invalid sort key "${sortFlag}". Use: lastOpened, title, author, progress`);
      }
    }
    const query = parsed.args.join(" ");
    const books = state.storage.listBooks();
    if (!query.trim()) {
      state.booksTagFilter = null;
      state.booksTagMap = state.storage.listTagsByBookId();
      state.overlay = "books";
      state.overlayCursor = 0;
      state.status = books.length > 0 ? "Opened library picker." : "No books in the library yet.";
      return;
    }
    const selected = findBookByQuery(books, query);
    if (selected) {
      const book = state.storage.getBook(selected.id);
      if (book) {
        await openBook(state, book);
      }
    } else {
      const q = query.trim().toLowerCase();
      const tagsByBookId = state.storage.listTagsByBookId();
      const tagMatches = books.filter((book) => {
        const tags = tagsByBookId.get(book.id) ?? [];
        return tags.some((t) => t.toLowerCase().includes(q));
      });
      if (tagMatches.length === 1) {
        const book = state.storage.getBook(tagMatches[0]!.id);
        if (book) {
          await openBook(state, book);
          return;
        }
      }
      state.overlay = "books";
      state.overlayCursor = 0;
      if (tagMatches.length > 0) {
        state.booksTagFilter = query.trim();
        state.booksTagMap = state.storage.listTagsByBookId();
        state.status = `Filtering by tag "${query.trim()}". ${tagMatches.length} book(s) found.`;
      } else {
        state.booksTagFilter = null;
        state.booksTagMap = state.storage.listTagsByBookId();
        state.status = "No exact match. Opened library picker.";
      }
    }
  },

  colorscheme: async (state, parsed) => {
    if (parsed.flags.list || parsed.args.length === 0) {
      state.overlay = "colorschemes";
      state.overlayCursor = Math.max(0, THEMES.findIndex((item) => item.id === state.colorScheme.id));
      state.status = "Opened colorscheme picker";
      return;
    }
    const colorScheme = THEMES.find((item) => item.id === parsed.args[0]);
    if (!colorScheme) {
      throw new Error(`Unknown colorscheme ${parsed.args[0]}`);
    }
    state.colorScheme = colorScheme;
    state.theme = applyAppearanceTheme(state.colorScheme, state.appearanceTheme);
    state.storage.setSetting("themeId", colorScheme.id);
    state.status = `Colorscheme set to ${colorScheme.label}`;
  },

  theme: async (state, parsed) => {
    if (parsed.flags.list || parsed.args.length === 0) {
      state.overlay = "themes";
      state.overlayCursor = Math.max(0, APPEARANCE_THEMES.findIndex((item) => item.id === state.appearanceTheme.id));
      state.status = "Opened theme picker";
      return;
    }
    const appearanceTheme = APPEARANCE_THEMES.find((item) => item.id === parsed.args[0]);
    if (!appearanceTheme) {
      throw new Error(`Unknown theme ${parsed.args[0]}`);
    }
    state.appearanceTheme = appearanceTheme;
    state.theme = applyAppearanceTheme(state.colorScheme, state.appearanceTheme);
    state.storage.setSetting("appearanceThemeId", appearanceTheme.id);
    state.status = `Theme set to ${appearanceTheme.label}`;
  },

  resume: async (state, parsed) => {
    const targetId = parsed.flags.latest ? state.storage.getLatestBookId() : null;
    if (targetId) {
      const book = state.storage.getBook(targetId);
      if (book) {
        await openBook(state, book);
      }
      return;
    }
    if (parsed.args.length > 0) {
      await executeCommand(state, `/changebook ${parsed.args.join(" ")}`);
    } else {
      const latest = state.storage.getLatestBookId();
      if (!latest) {
        state.status = "No previous book to resume.";
      } else {
        const book = state.storage.getBook(latest);
        if (book) {
          await openBook(state, book);
        }
      }
    }
  },

  add: async (state, parsed) => {
    await refreshDiscoveries(state);
    const force = Boolean(parsed.flags.force);
    if (parsed.flags.cwd || parsed.args.length === 0) {
      openFilePicker(state, state.discoveries, {
        force,
        status: state.discoveries.length > 0
          ? "Opened file picker."
          : "No books detected in the current directory."
      });
      return;
    }

    const target = parsed.args.join(" ");
    const explicitPath = path.resolve(state.cwd, target);
    if (fs.existsSync(explicitPath)) {
      await importAndOpen(state, explicitPath, force);
      return;
    }

    const matches = filterDiscoveries(state.discoveries, target);
    if (matches.length === 1) {
      await importAndOpen(state, matches[0].path, force);
      return;
    }

    openFilePicker(state, matches, {
      force,
      status: matches.length > 0
        ? `Opened file picker for "${target}".`
        : `No books matched "${target}".`
    });
  },

  remove: async (state, parsed) => {
    if (parsed.flags.current && state.currentBook) {
      state.storage.removeBook(state.currentBook.id);
      state.currentBook = null;
      state.searchState = null;
      state.status = "Current book removed from the library.";
      return;
    }
    const query = parsed.args.join(" ");
    const match = state.storage.listBooks().find((book) => book.title.toLowerCase().includes(query.toLowerCase()));
    if (!match) {
      state.status = "No matching book found.";
      return;
    }
    state.storage.removeBook(match.id);
    if (state.currentBook?.id === match.id) {
      state.currentBook = null;
      state.searchState = null;
    }
    state.status = `Removed ${match.title} from the library.`;
  },

  removecurrent: async (state) => {
    if (!state.currentBook) {
      state.status = "No current book to remove.";
      return;
    }
    state.storage.removeBook(state.currentBook.id);
    state.currentBook = null;
    state.searchState = null;
    state.status = "Current book removed from the library.";
  },

  toggleprogress: async (state, parsed) => {
    const values: ProgressVisibility[] = ["book", "both", "chapter", "hidden"];
    if (parsed.args[0] && values.includes(parsed.args[0] as ProgressVisibility)) {
      state.progressVisibility = parsed.args[0] as ProgressVisibility;
    } else {
      const index = values.indexOf(state.progressVisibility);
      state.progressVisibility = values[(index + 1) % values.length];
    }
    state.storage.setSetting("progressVisibility", state.progressVisibility);
    state.status = `Progress mode: ${state.progressVisibility}`;
  },

  mode: async (state, parsed) => {
    const value = parsed.args[0];
    const CODE_LANGUAGES: CodeLanguage[] = ["typescript", "python", "rust"];
    if (value === "plain") {
      state.renderMode = "plain";
      state.storage.setSetting("renderMode", "plain");
      state.status = "Render mode: plain";
    } else if (value === "code") {
      // Legacy: /mode code keeps the current code language
      state.renderMode = "code";
      state.storage.setSetting("renderMode", "code");
      state.status = `Render mode: code (${state.codeLanguage})`;
    } else if ((CODE_LANGUAGES as string[]).includes(value)) {
      state.renderMode = "code";
      state.codeLanguage = value as CodeLanguage;
      state.storage.setSetting("renderMode", "code");
      state.storage.setSetting("codeLanguage", value as CodeLanguage);
      state.status = `Render mode: ${value}`;
    } else {
      throw new Error("Mode must be plain, typescript, python, or rust");
    }
  },

  highlight: async (state, parsed) => {
    const value = parsed.args[0]?.toLowerCase();
    if (parsed.args.length !== 1 || (value !== "on" && value !== "off")) {
      throw new Error("Use /highlight <on|off>");
    }
    const enabled = value === "on";
    state.plainHighlight = enabled;
    state.storage.setSetting("plainHighlight", enabled);
    state.status = `Dialogue highlight: ${enabled ? "on" : "off"}`;
  },

  mouse: async (state, parsed) => {
    const value = parsed.args[0]?.toLowerCase();
    if (!value) {
      state.mouseCapture = !state.mouseCapture;
    } else if (value === "on") {
      state.mouseCapture = true;
    } else if (value === "off") {
      state.mouseCapture = false;
    } else {
      throw new Error("Use /mouse [on|off]");
    }
    state.mouseDrag = null;
    state.status = state.mouseCapture
      ? "Mouse capture on: scrollbar drag enabled; use Shift-drag for terminal selection."
      : "Mouse capture off: native selection enabled; wheel and keyboard scrolling remain active.";
  },

  help: async (state, parsed) => {
    state.overlay = "help";
    state.overlayCursor = 0;
    state.helpCommand = parsed.flags.all ? null : parsed.args[0] ?? null;
    state.status = state.helpCommand ? `Opened help for /${state.helpCommand}` : "Opened command manual";
  },

  keyboardshortcuts: async (state) => {
    state.overlay = "keys";
    state.status = "Opened keyboard shortcuts";
  },

  settings: async (state) => {
    openSettingsPanel(state);
  },

  density: async (state, parsed) => {
    const VALID: CodeDensity[] = [1, 2, 3, 4, 5];
    const arg = parsed.args[0];
    if (!arg) {
      throw new Error("Use /density <1-5>");
    }
    const level = Number(arg) as CodeDensity;
    if (!VALID.includes(level)) {
      throw new Error("Density must be a number between 1 and 5");
    }
    state.codeDensity = level;
    state.storage.setSetting("codeDensity", level);
    state.layoutMetrics = null;
    state.status = `Code density: ${level}`;
  },

  search: async (state, parsed) => {
    if (!state.currentBook) {
      state.status = "No book open.";
      return;
    }
    const query = parsed.args.join(" ").trim();
    if (!query) {
      throw new Error("Use /search [-g|--global] <term>");
    }
    const global = Boolean(parsed.flags.global);
    const hits = collectSearchHits(state, query, global);
    if (hits.length === 0) {
      state.searchState = null;
      state.status = global ? `No matches for "${query}" in this book.` : `No matches for "${query}" in this chapter.`;
      return;
    }
    state.searchState = {
      query,
      global,
      results: hits,
      cursor: 0
    };
    applySearchHit(state, hits[0]!);
    state.status = global
      ? `Search: ${hits.length} match(es) in book for "${query}".`
      : `Search: ${hits.length} match(es) in chapter for "${query}".`;
  },

  goto: async (state, parsed) => {
    if (!state.currentBook) {
      state.status = "No book open.";
      return;
    }
    const raw = parsed.args.join(" ").trim();
    if (!raw) {
      throw new Error("Use /goto <chapter>|<percent>%|…%c>");
    }
    const dims = viewportForCommand(state);
    const book = state.currentBook;
    const lastChapterIndex = book.chapters.length - 1;

    const chapterPercentSuffix = /^(\d+(?:\.\d+)?)%c$/i.exec(raw);
    const plainPercent = /^(\d+(?:\.\d+)?)%$/.exec(raw);
    const chapterNumber = /^(\d+)$/.exec(raw);

    if (chapterPercentSuffix) {
      pushNavHistory(state);
      const p = Number(chapterPercentSuffix[1]);
      if (Number.isNaN(p) || p < 0 || p > 100) {
        state.status = "Percentage must be between 0 and 100.";
        return;
      }
      const maxOff = computeChapterMaxOffset(state, dims.contentWidth, dims.bodyHeight);
      state.blockOffset = Math.min(Math.floor((p / 100) * maxOff), maxOff);
      pushNavHistory(state);
      state.status = `Jumped to ${p}% of chapter ${state.chapterIndex + 1} (offset ${state.blockOffset})`;
      return;
    }

    if (plainPercent) {
      const p = Number(plainPercent[1]);
      if (Number.isNaN(p) || p < 0 || p > 100) {
        state.status = "Percentage must be between 0 and 100.";
        return;
      }
      if (parsed.flags.chapter) {
        pushNavHistory(state);
        const maxOff = computeChapterMaxOffset(state, dims.contentWidth, dims.bodyHeight);
        state.blockOffset = Math.min(Math.floor((p / 100) * maxOff), maxOff);
        pushNavHistory(state);
        state.status = `Jumped to ${p}% of chapter ${state.chapterIndex + 1} (offset ${state.blockOffset})`;
        return;
      }

      const weights = book.chapters.map((chapter) => effectiveWordCount(chapter));
      const totalWords = weights.reduce((sum, value) => sum + value, 0);

      if (p <= 0) {
        pushNavHistory(state);
        state.chapterIndex = 0;
        state.blockOffset = 0;
        pushNavHistory(state);
        state.status = "Jumped to 0% (start of book)";
        return;
      }
      if (p >= 100) {
        pushNavHistory(state);
        state.chapterIndex = lastChapterIndex;
        state.blockOffset = computeChapterMaxOffset(state, dims.contentWidth, dims.bodyHeight);
        pushNavHistory(state);
        state.status = `Jumped to 100% (end of book)`;
        return;
      }

      pushNavHistory(state);
      const targetWord = (p / 100) * totalWords;
      let accumulated = 0;
      let chapterIndex = 0;
      while (chapterIndex < lastChapterIndex && targetWord >= accumulated + weights[chapterIndex]!) {
        accumulated += weights[chapterIndex]!;
        chapterIndex += 1;
      }
      state.chapterIndex = chapterIndex;
      const chapterWeight = weights[chapterIndex]!;
      const local = Math.min(Math.max(0, targetWord - accumulated), chapterWeight);
      const ratio = chapterWeight > 0 ? local / chapterWeight : 0;
      const maxOff = computeChapterMaxOffset(state, dims.contentWidth, dims.bodyHeight);
      state.blockOffset = Math.min(Math.floor(ratio * maxOff), maxOff);
      pushNavHistory(state);
      state.status = `Jumped to ${p}% of book (Ch.${chapterIndex + 1} · offset ${state.blockOffset})`;
      return;
    }

    if (chapterNumber) {
      const n = Number(chapterNumber[1]);
      if (n < 1 || n > book.chapters.length) {
        state.status = `There is no chapter ${n}. This book has ${book.chapters.length} chapter(s).`;
        return;
      }
      pushNavHistory(state);
      state.chapterIndex = n - 1;
      state.blockOffset = 0;
      pushNavHistory(state);
      state.status = `Jumped to chapter ${n}`;
      return;
    }

    state.status = `Could not parse position "${raw}". Try /goto 42%, /goto 30%c, /goto 5, or /goto 10% --chapter.`;
  },

  tag: async (state, parsed) => {
    if (!state.currentBook) {
      state.status = "No book open.";
      return;
    }
    const isDelete = Boolean(parsed.flags.delete);
    const tagArg = parsed.args[0];
    if (isDelete) {
      if (!tagArg) {
        throw new Error("Use /tag -d <tag>");
      }
      state.storage.removeTag(state.currentBook.id, tagArg);
      state.booksTagMap = state.storage.listTagsByBookId();
      state.status = `Tag removed: #${tagArg}`;
    } else if (tagArg) {
      state.storage.addTag(state.currentBook.id, tagArg);
      state.booksTagMap = state.storage.listTagsByBookId();
      state.status = `Tag added: #${tagArg}`;
    } else {
      const tags = state.storage.listTags(state.currentBook.id);
      state.status = tags.length > 0 ? `Tags: ${tags.map((t) => `#${t}`).join("  ")}` : "No tags for this book.";
    }
  },

  tags: async (state) => {
    if (!state.currentBook) {
      state.status = "No book open.";
      return;
    }
    const tags = state.storage.listTags(state.currentBook.id);
    state.status = tags.length > 0 ? `Tags: ${tags.map((t) => `#${t}`).join("  ")}` : "No tags for this book.";
  },

  note: async (state, parsed) => {
    if (!state.currentBook) {
      state.status = "No book open.";
      return;
    }
    const isList = Boolean(parsed.flags.list);
    const isDelete = Boolean(parsed.flags.delete);
    if (isList) {
      const notes = state.storage.listNotes(state.currentBook.id);
      state.overlay = "notes";
      state.overlayCursor = 0;
      state.status = notes.length > 0 ? "Opened notes." : "No notes for this book yet.";
    } else if (isDelete) {
      const id = parsed.args[0];
      if (!id) {
        throw new Error("Use /note -d <id>");
      }
      const notes = state.storage.listNotes(state.currentBook.id);
      const found = notes.find((n) => n.id === id);
      if (!found) {
        state.status = "Note not found in current book.";
        return;
      }
      state.storage.deleteNote(found.id);
      state.status = "Note deleted.";
    } else {
      const content = parsed.args.join(" ").trim();
      if (!content) {
        throw new Error("Use /note <text>");
      }
      const note = state.storage.addNote(state.currentBook.id, content, state.chapterIndex, state.blockOffset);
      state.status = `Note saved (${note.id.slice(0, 8)})`;
    }
  },

  export: async (state, parsed) => {
    const outPath = parsed.args[0]
      ? path.resolve(state.cwd, parsed.args[0])
      : path.join(state.cwd, "stealth-reader-export.json");
    try {
      const data = state.storage.exportAll();
      fs.writeFileSync(outPath, JSON.stringify(data, null, 2), "utf8");
      const bookCount = new Set(data.positions.map((p) => p.bookImportHash)).size;
      const rel = path.relative(state.cwd, outPath) || outPath;
      state.status = `Exported ${bookCount} book(s) — ${data.positions.length} position(s), ${data.bookmarks.length} bookmark(s), ${data.notes.length} note(s), ${data.tags.length} tag(s) → ${rel}`;
    } catch (err) {
      state.status = err instanceof Error ? `Export failed: ${err.message}` : "Export failed.";
    }
  },

  import: async (state, parsed) => {
    const inPath = parsed.args[0]
      ? path.resolve(state.cwd, parsed.args[0])
      : path.join(state.cwd, "stealth-reader-export.json");
    if (!fs.existsSync(inPath)) {
      state.status = `File not found: ${inPath}`;
      return;
    }
    try {
      const raw = fs.readFileSync(inPath, "utf8");
      const data = JSON.parse(raw) as ExportData;
      if (data.version !== 1) {
        state.status = "Unsupported export format version.";
        return;
      }
      if (!Array.isArray(data.positions) || !Array.isArray(data.bookmarks) || !Array.isArray(data.notes) || !Array.isArray(data.tags)) {
        state.status = "Invalid export file: missing required arrays.";
        return;
      }
      const result = state.storage.importMerge(data);
      state.status = `Imported: ${result.positionsUpdated} position(s) updated, ${result.bookmarksAdded} bookmark(s) added, ${result.notesAdded} note(s) added, ${result.tagsAdded} tag(s) added`;
    } catch (err) {
      state.status = err instanceof Error ? `Import failed: ${err.message}` : "Import failed.";
    }
  }
};

export async function executeCommand(state: AppState, raw: string): Promise<void> {
  let focusOriginalOffset: number | null = null;
  try {
    if (state.focusMode && state.currentBook) {
      const { contentWidth } = viewportForCommand(state);
      focusOriginalOffset = state.blockOffset;
      state.blockOffset = mapFocusIndexToBlockOffset(state, contentWidth, state.focusBlockIndex);
    }
    const parsed = parseSlashCommand(raw);
    state.storage.saveCommandHistory(raw, parsed.name);
    const handler = handlers[parsed.name];
    if (!handler) {
      state.status = `Command not implemented: ${parsed.name}`;
      return;
    }
    await handler(state, parsed);
    if (state.focusMode && state.currentBook) {
      const { contentWidth } = viewportForCommand(state);
      state.focusBlockIndex = mapBlockOffsetToFocusIndex(state, contentWidth, state.blockOffset);
    }
  } catch (error) {
    state.status = error instanceof Error ? error.message : "Command failed";
  } finally {
    if (focusOriginalOffset !== null) {
      state.blockOffset = focusOriginalOffset;
    }
  }
}
