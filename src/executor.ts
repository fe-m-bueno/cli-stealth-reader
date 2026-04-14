import fs from "node:fs";
import path from "node:path";
import { commandHelp, parseSlashCommand } from "./commands.js";
import { discoverEpubs } from "./discovery.js";
import { EPUB_PARSER_VERSION, importEpub } from "./parser/epub.js";
import { THEMES } from "./themes.js";
import type {
  AppState,
  CanonicalBook,
  CodeDensity,
  CodeLanguage,
  FolderDiscovery,
  LibraryEntry,
  ParsedCommandResult,
  ProgressVisibility
} from "./types.js";

function findBookByQuery(books: LibraryEntry[], query: string): LibraryEntry | undefined {
  const q = query.toLowerCase();
  return books.find((book) => book.title.toLowerCase().includes(q) || book.author.toLowerCase().includes(q));
}

export async function openBook(state: AppState, book: CanonicalBook): Promise<void> {
  if ((book.parserVersion ?? 1) < EPUB_PARSER_VERSION && fs.existsSync(book.sourcePath)) {
    const refreshed = await importEpub(book.sourcePath);
    state.storage.saveBook(refreshed, state.renderMode);
    book = refreshed;
  }
  state.currentBook = book;
  const existing = state.storage.getPosition(book.id);
  state.chapterIndex = existing?.chapterIndex ?? 0;
  state.blockOffset = existing?.blockOffset ?? 0;
  state.status = `Opened ${book.title}`;
}

export async function importAndOpen(state: AppState, epubPath: string, force = false): Promise<void> {
  if (!force && !fs.existsSync(epubPath)) {
    state.status = `File not found: ${epubPath}`;
    return;
  }
  const book = await importEpub(epubPath);
  state.storage.saveBook(book, state.renderMode);
  await openBook(state, book);
}

async function refreshDiscoveries(state: AppState): Promise<void> {
  state.cwd = process.cwd();
  state.discoveries = await discoverEpubs(state.cwd);
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
  state.status = options?.status ?? (items.length > 0 ? "Opened file picker." : "No EPUBs found in this folder.");
}

type CommandHandler = (state: AppState, parsed: ParsedCommandResult) => Promise<void>;

const handlers: Record<string, CommandHandler> = {
  prev: async (state, parsed) => {
    if (state.currentBook) {
      const count = Math.max(1, Number(parsed.args[0] ?? "1"));
      state.chapterIndex = Math.max(0, state.chapterIndex - count);
      state.blockOffset = 0;
      state.status = `Moved to chapter ${state.chapterIndex + 1}`;
    }
  },

  next: async (state, parsed) => {
    if (state.currentBook) {
      const count = Math.max(1, Number(parsed.args[0] ?? "1"));
      state.chapterIndex = Math.min(state.currentBook.chapters.length - 1, state.chapterIndex + count);
      state.blockOffset = 0;
      state.status = `Moved to chapter ${state.chapterIndex + 1}`;
    }
  },

  chapters: async (state) => {
    state.overlay = "chapters";
    state.overlayCursor = state.chapterIndex;
    state.status = "Opened table of contents";
  },

  changebook: async (state, parsed) => {
    const query = parsed.args.join(" ");
    const books = state.storage.listBooks();
    if (!query.trim()) {
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
      state.overlay = "books";
      state.overlayCursor = 0;
      state.status = "No exact match. Opened library picker.";
    }
  },

  colorscheme: async (state, parsed) => {
    if (parsed.flags.list || parsed.args.length === 0) {
      state.overlay = "themes";
      state.overlayCursor = Math.max(0, THEMES.findIndex((item) => item.id === state.theme.id));
      state.status = "Opened colorscheme picker";
      return;
    }
    const theme = THEMES.find((item) => item.id === parsed.args[0]);
    if (!theme) {
      throw new Error(`Unknown theme ${parsed.args[0]}`);
    }
    state.theme = theme;
    state.storage.setSetting("themeId", theme.id);
    state.status = `Theme set to ${theme.label}`;
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
          : "No EPUBs detected in the current directory."
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
        : `No EPUBs matched "${target}".`
    });
  },

  remove: async (state, parsed) => {
    if (parsed.flags.current && state.currentBook) {
      state.storage.removeBook(state.currentBook.id);
      state.currentBook = null;
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

  help: async (state, parsed) => {
    state.overlay = "help";
    state.status = parsed.args[0] ? commandHelp(parsed.args[0])[0] : "Opened help";
  },

  keyboardshortcuts: async (state) => {
    state.overlay = "keys";
    state.status = "Opened keyboard shortcuts";
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
};

export async function executeCommand(state: AppState, raw: string): Promise<void> {
  try {
    const parsed = parseSlashCommand(raw);
    state.storage.saveCommandHistory(raw, parsed.name);
    const handler = handlers[parsed.name];
    if (!handler) {
      state.status = `Command not implemented: ${parsed.name}`;
      return;
    }
    await handler(state, parsed);
  } catch (error) {
    state.status = error instanceof Error ? error.message : "Command failed";
  }
}
