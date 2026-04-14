import fs from "node:fs";
import path from "node:path";
import { COMMANDS, commandHelp, parseSlashCommand } from "./commands.js";
import { bold, fg } from "./color.js";
import { discoverEpubs } from "./discovery.js";
import { KEYBOARD_SHORTCUTS } from "./help.js";
import { importEpub } from "./parser/epub.js";
import { renderBlocks } from "./renderers.js";
import { Storage } from "./storage.js";
import { DEFAULT_THEME, THEMES } from "./themes.js";
import type {
  CanonicalBook,
  FolderDiscovery,
  ProgressVisibility,
  RenderMode,
  ThemePreset
} from "./types.js";

type OverlayKind = "none" | "chapters" | "books" | "themes" | "help" | "keys" | "diagnostics";

interface AppState {
  storage: Storage;
  cwd: string;
  theme: ThemePreset;
  renderMode: RenderMode;
  progressVisibility: ProgressVisibility;
  currentBook: CanonicalBook | null;
  chapterIndex: number;
  blockOffset: number;
  commandBuffer: string;
  commandMode: boolean;
  status: string;
  overlay: OverlayKind;
  discoveries: FolderDiscovery[];
  shouldQuit: boolean;
}

function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[H");
}

function truncate(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
}

function progressBar(value: number, width: number, theme: ThemePreset): string {
  const clamped = Math.max(0, Math.min(1, value));
  const filled = Math.round(clamped * width);
  const empty = Math.max(0, width - filled);
  return fg(theme.accent, "█".repeat(filled)) + fg(theme.border, "░".repeat(empty));
}

function currentLines(state: AppState, width: number, height: number): string[] {
  if (!state.currentBook) {
    const lines = [
      bold(fg(state.theme.accent, "cli-stealth-reader")),
      "",
      "No book is open.",
      "",
      "Use /add to import a book or /resume to reopen the latest one.",
      ""
    ];
    if (state.discoveries.length > 0) {
      lines.push("EPUBs found in this folder:");
      state.discoveries.slice(0, Math.max(3, height - 8)).forEach((item) => {
        lines.push(`  ${item.fileName}`);
      });
    }
    return lines;
  }

  const chapter = state.currentBook.chapters[state.chapterIndex];
  return renderBlocks(chapter.blocks, state.renderMode, width, state.theme);
}

function computeBookProgress(state: AppState): number {
  if (!state.currentBook) {
    return 0;
  }
  if (state.currentBook.chapters.length <= 1) {
    return state.blockOffset > 0 ? Math.min(1, state.blockOffset / Math.max(1, state.currentBook.chapters[0].blocks.length)) : 0;
  }
  return (state.chapterIndex + (state.blockOffset > 0 ? state.blockOffset / Math.max(1, state.currentBook.chapters[state.chapterIndex].blocks.length) : 0)) / state.currentBook.chapters.length;
}

function computeChapterProgress(state: AppState): number {
  if (!state.currentBook) {
    return 0;
  }
  const chapter = state.currentBook.chapters[state.chapterIndex];
  return Math.min(1, state.blockOffset / Math.max(1, chapter.blocks.length));
}

function renderOverlay(state: AppState, width: number, height: number): string[] {
  switch (state.overlay) {
    case "chapters":
      if (!state.currentBook) {
        return ["No book open."];
      }
      return state.currentBook.chapters.slice(0, Math.max(1, height - 2)).map((chapter, index) => {
        const marker = index === state.chapterIndex ? "›" : " ";
        return `${marker} ${String(index + 1).padStart(2, "0")} ${truncate(chapter.title, width - 6)}`;
      });
    case "books":
      return [
        "Library",
        "",
        ...state.storage.listBooks().map((book) => `${book.title}  ${fg(state.theme.dim, book.author)}`),
        "",
        "Current folder",
        ...state.discoveries.map((item) => item.fileName)
      ];
    case "themes":
      return THEMES.map((theme) => `${theme.id === state.theme.id ? "›" : " "} ${theme.label} (${theme.id})`);
    case "help":
      return commandHelp().slice(0, Math.max(1, height));
    case "keys":
      return KEYBOARD_SHORTCUTS.slice(0, Math.max(1, height)).map((row) => `${row.key.padEnd(14)} ${row.description}`);
    case "diagnostics":
      return state.currentBook?.diagnostics.length
        ? state.currentBook.diagnostics.map((item) => `${item.severity.toUpperCase()} ${item.message}${item.context ? ` (${item.context})` : ""}`)
        : ["No diagnostics for the current book."];
    default:
      return [];
  }
}

function draw(state: AppState): void {
  const width = process.stdout.columns || 120;
  const height = process.stdout.rows || 40;
  clearScreen();

  const top = [
    bold(fg(state.theme.accent, "stealth-reader")),
    fg(state.theme.dim, state.currentBook ? `${state.currentBook.title} · ${state.currentBook.author}` : "idle"),
    fg(state.theme.dim, `mode:${state.renderMode}`),
    fg(state.theme.dim, `theme:${state.theme.id}`)
  ].join(fg(state.theme.border, "  │  "));

  process.stdout.write(`${top}\n`);
  process.stdout.write(`${fg(state.theme.border, "─".repeat(width))}\n`);

  const bodyHeight = height - 6;
  const overlayWidth = state.overlay === "none" ? 0 : Math.min(42, Math.floor(width * 0.32));
  const mainWidth = Math.max(24, width - overlayWidth - (overlayWidth ? 3 : 0));
  const lines = currentLines(state, mainWidth - 2, bodyHeight);
  const visibleLines = lines.slice(state.blockOffset, state.blockOffset + bodyHeight);
  const overlayLines = overlayWidth ? renderOverlay(state, overlayWidth - 2, bodyHeight) : [];

  for (let row = 0; row < bodyHeight; row += 1) {
    const left = truncate(visibleLines[row] ?? "", mainWidth - 1).padEnd(mainWidth, " ");
    if (overlayWidth) {
      const right = truncate(overlayLines[row] ?? "", overlayWidth - 1).padEnd(overlayWidth, " ");
      process.stdout.write(`${left} ${fg(state.theme.border, "│")} ${right}\n`);
    } else {
      process.stdout.write(`${left}\n`);
    }
  }

  const bookProgress = computeBookProgress(state);
  const chapterProgress = computeChapterProgress(state);
  const progressParts: string[] = [];
  if (state.progressVisibility === "book" || state.progressVisibility === "both") {
    progressParts.push(`book ${Math.round(bookProgress * 100)}% ${progressBar(bookProgress, 12, state.theme)}`);
  }
  if (state.progressVisibility === "chapter" || state.progressVisibility === "both") {
    progressParts.push(`chapter ${Math.round(chapterProgress * 100)}% ${progressBar(chapterProgress, 12, state.theme)}`);
  }
  process.stdout.write(`${fg(state.theme.border, "─".repeat(width))}\n`);
  process.stdout.write(`${truncate(progressParts.join("  "), width)}\n`);
  const prompt = state.commandMode ? `${fg(state.theme.accent, "/")}${state.commandBuffer}` : fg(state.theme.dim, "Press / for commands, ? for shortcuts, q to quit");
  const status = state.status ? `  ${fg(state.theme.dim, state.status)}` : "";
  process.stdout.write(`${truncate(prompt + status, width)}\n`);
}

async function openBook(state: AppState, book: CanonicalBook): Promise<void> {
  state.currentBook = book;
  const existing = state.storage.getPosition(book.id);
  state.chapterIndex = existing?.chapterIndex ?? 0;
  state.blockOffset = existing?.blockOffset ?? 0;
  state.status = `Opened ${book.title}`;
}

async function importAndOpen(state: AppState, epubPath: string, force = false): Promise<void> {
  if (!force && !fs.existsSync(epubPath)) {
    state.status = `File not found: ${epubPath}`;
    return;
  }
  const book = await importEpub(epubPath);
  state.storage.saveBook(book, state.renderMode);
  await openBook(state, book);
}

function syncPosition(state: AppState): void {
  if (!state.currentBook) {
    return;
  }
  state.storage.savePosition({
    bookId: state.currentBook.id,
    chapterIndex: state.chapterIndex,
    chapterProgress: computeChapterProgress(state),
    bookProgress: computeBookProgress(state),
    blockOffset: state.blockOffset
  });
}

async function executeCommand(state: AppState, raw: string): Promise<void> {
  try {
    const parsed = parseSlashCommand(raw);
    state.storage.saveCommandHistory(raw, parsed.name);
    switch (parsed.name) {
      case "prev": {
        if (state.currentBook) {
          const count = Math.max(1, Number(parsed.args[0] ?? "1"));
          state.chapterIndex = Math.max(0, state.chapterIndex - count);
          state.blockOffset = 0;
          state.status = `Moved to chapter ${state.chapterIndex + 1}`;
        }
        break;
      }
      case "next": {
        if (state.currentBook) {
          const count = Math.max(1, Number(parsed.args[0] ?? "1"));
          state.chapterIndex = Math.min(state.currentBook.chapters.length - 1, state.chapterIndex + count);
          state.blockOffset = 0;
          state.status = `Moved to chapter ${state.chapterIndex + 1}`;
        }
        break;
      }
      case "chapters":
        state.overlay = "chapters";
        state.status = "Opened table of contents";
        break;
      case "changebook": {
        const query = parsed.args.join(" ").toLowerCase();
        const books = state.storage.listBooks();
        const selected = books.find((book) => book.title.toLowerCase().includes(query) || book.author.toLowerCase().includes(query));
        if (selected) {
          const book = state.storage.getBook(selected.id);
          if (book) {
            await openBook(state, book);
          }
        } else {
          state.overlay = "books";
          state.status = "No exact match. Opened library picker.";
        }
        break;
      }
      case "colorscheme": {
        if (parsed.flags.list || parsed.args.length === 0) {
          state.overlay = "themes";
          state.status = "Opened colorscheme picker";
          break;
        }
        const theme = THEMES.find((item) => item.id === parsed.args[0]);
        if (!theme) {
          throw new Error(`Unknown theme ${parsed.args[0]}`);
        }
        state.theme = theme;
        state.storage.setSetting("themeId", theme.id);
        state.status = `Theme set to ${theme.label}`;
        break;
      }
      case "resume": {
        const targetId = parsed.flags.latest ? state.storage.getLatestBookId() : null;
        if (targetId) {
          const book = state.storage.getBook(targetId);
          if (book) {
            await openBook(state, book);
          }
          break;
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
        break;
      }
      case "add": {
        if (parsed.flags.cwd || parsed.args.length === 0) {
          const candidate = state.discoveries[0];
          if (!candidate) {
            state.status = "No EPUBs detected in the current directory.";
            break;
          }
          await importAndOpen(state, candidate.path, Boolean(parsed.flags.force));
          break;
        }
        const target = parsed.args.join(" ");
        await importAndOpen(state, path.resolve(state.cwd, target), Boolean(parsed.flags.force));
        break;
      }
      case "remove": {
        if (parsed.flags.current && state.currentBook) {
          state.storage.removeBook(state.currentBook.id);
          state.currentBook = null;
          state.status = "Current book removed from the library.";
          break;
        }
        const query = parsed.args.join(" ").toLowerCase();
        const match = state.storage.listBooks().find((book) => book.title.toLowerCase().includes(query));
        if (!match) {
          state.status = "No matching book found.";
          break;
        }
        state.storage.removeBook(match.id);
        if (state.currentBook?.id === match.id) {
          state.currentBook = null;
        }
        state.status = `Removed ${match.title} from the library.`;
        break;
      }
      case "removecurrent":
        if (!state.currentBook) {
          state.status = "No current book to remove.";
          break;
        }
        state.storage.removeBook(state.currentBook.id);
        state.currentBook = null;
        state.status = "Current book removed from the library.";
        break;
      case "toggleprogress": {
        const values: ProgressVisibility[] = ["book", "both", "chapter", "hidden"];
        if (parsed.args[0] && values.includes(parsed.args[0] as ProgressVisibility)) {
          state.progressVisibility = parsed.args[0] as ProgressVisibility;
        } else {
          const index = values.indexOf(state.progressVisibility);
          state.progressVisibility = values[(index + 1) % values.length];
        }
        state.storage.setSetting("progressVisibility", state.progressVisibility);
        state.status = `Progress mode: ${state.progressVisibility}`;
        break;
      }
      case "mode": {
        const value = parsed.args[0];
        if (value !== "code" && value !== "plain") {
          throw new Error("Mode must be code or plain");
        }
        state.renderMode = value;
        state.storage.setSetting("renderMode", value);
        state.status = `Render mode: ${value}`;
        break;
      }
      case "help":
        state.overlay = "help";
        state.status = parsed.args[0] ? commandHelp(parsed.args[0])[0] : "Opened help";
        break;
      case "keyboardshortcuts":
        state.overlay = "keys";
        state.status = "Opened keyboard shortcuts";
        break;
      default:
        state.status = `Command not implemented: ${parsed.name}`;
    }
    syncPosition(state);
  } catch (error) {
    state.status = error instanceof Error ? error.message : "Command failed";
  }
}

function handleNavigation(state: AppState, key: string): void {
  const pageSize = Math.max(5, (process.stdout.rows || 40) - 8);
  if (key === "j" || key === "\u001b[B") {
    state.blockOffset += 1;
  } else if (key === "k" || key === "\u001b[A") {
    state.blockOffset = Math.max(0, state.blockOffset - 1);
  } else if (key === " ") {
    state.blockOffset += pageSize;
  } else if (key === "b") {
    state.blockOffset = Math.max(0, state.blockOffset - pageSize);
  } else if (key === "g") {
    state.blockOffset = 0;
  } else if (key === "G") {
    state.blockOffset += pageSize * 100;
  } else if (key === "?") {
    state.overlay = "keys";
  } else if (key === "q") {
    state.shouldQuit = true;
  }
  syncPosition(state);
}

export async function runTui(): Promise<void> {
  const storage = new Storage();
  const settings = storage.getSettings();
  const state: AppState = {
    storage,
    cwd: process.cwd(),
    theme: THEMES.find((item) => item.id === settings.themeId) ?? DEFAULT_THEME,
    renderMode: settings.renderMode,
    progressVisibility: settings.progressVisibility,
    currentBook: null,
    chapterIndex: 0,
    blockOffset: 0,
    commandBuffer: "",
    commandMode: false,
    status: "Ready",
    overlay: "none",
    discoveries: await discoverEpubs(process.cwd()),
    shouldQuit: false
  };

  const latest = storage.getLatestBookId();
  if (latest) {
    const latestBook = storage.getBook(latest);
    if (latestBook) {
      await openBook(state, latestBook);
    }
  }

  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  const redraw = () => draw(state);
  redraw();

  process.stdin.on("data", async (chunk: string) => {
    if (chunk === "\u0003") {
      state.shouldQuit = true;
    }
    if (state.shouldQuit) {
      process.stdin.setRawMode?.(false);
      clearScreen();
      process.exit(0);
    }
    if (state.commandMode) {
      if (chunk === "\r") {
        const raw = `/${state.commandBuffer}`;
        state.commandBuffer = "";
        state.commandMode = false;
        await executeCommand(state, raw);
      } else if (chunk === "\u001b") {
        state.commandMode = false;
      } else if (chunk === "\u007f") {
        state.commandBuffer = state.commandBuffer.slice(0, -1);
      } else {
        state.commandBuffer += chunk;
      }
      redraw();
      return;
    }
    if (chunk === "/") {
      state.commandMode = true;
      state.commandBuffer = "";
      redraw();
      return;
    }
    if (chunk === "\u001b") {
      state.overlay = "none";
      redraw();
      return;
    }
    handleNavigation(state, chunk);
    redraw();
  });
}
