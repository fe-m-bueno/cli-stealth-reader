import { commandHelp } from "./commands.js";
import { executeCommand, importAndOpen, openBook } from "./executor.js";
import { handleInput } from "./input.js";
import { bold, fg } from "./color.js";
import { discoverEpubs } from "./discovery.js";
import { KEYBOARD_SHORTCUTS } from "./help.js";
import { renderBlocks } from "./renderers.js";
import {
  clamp,
  computeWindowStart,
  computeChapterMaxOffset,
  computeBookProgress,
  computeChapterProgress,
  formatProgress,
  getViewportLayout,
  renderFrame,
  renderBody,
  renderFooter,
  renderScrollbar,
  renderStatusBar,
  truncate
} from "./screen.js";
import { Storage } from "./storage.js";
import { DEFAULT_THEME, THEMES } from "./themes.js";
import type { AppState } from "./types.js";

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
      lines.push("");
      lines.push("Press Enter to open the file picker.");
    }
    return lines;
  }

  const chapter = state.currentBook.chapters[state.chapterIndex];
  return renderBlocks(chapter.blocks, state.renderMode, width, state.theme);
}

function renderOverlay(state: AppState, width: number, height: number): string[] {
  switch (state.overlay) {
    case "chapters":
      if (!state.currentBook) {
        return ["No book open."];
      }
      const visibleRows = Math.max(1, height - 2);
      const start = computeWindowStart(state.currentBook.chapters.length, visibleRows, state.overlayCursor);
      return state.currentBook.chapters
        .slice(start, start + visibleRows)
        .map((chapter) => {
          const marker = chapter.index === state.overlayCursor ? ">" : " ";
          return `${marker} ${String(chapter.index + 1).padStart(2, "0")} ${truncate(chapter.title, width - 6)}`;
        });
    case "books":
      return state.storage.listBooks().map((book, index) => {
        const marker = index === state.overlayCursor ? ">" : " ";
        return `${marker} ${truncate(`${book.title}  ${book.author}`, width - 2)}`;
      });
    case "themes":
      return THEMES.map((theme, index) => {
        const marker = index === state.overlayCursor ? ">" : " ";
        return `${marker} ${theme.label} (${theme.id})`;
      });
    case "help":
      return commandHelp().slice(0, Math.max(1, height));
    case "keys":
      return KEYBOARD_SHORTCUTS.slice(0, Math.max(1, height)).map((row) => `${row.key.padEnd(14)} ${row.description}`);
    case "diagnostics":
      return state.currentBook?.diagnostics.length
        ? state.currentBook.diagnostics.map((item) => `${item.severity.toUpperCase()} ${item.message}${item.context ? ` (${item.context})` : ""}`)
        : ["No diagnostics for the current book."];
    case "file-picker": {
      if (state.filePickerItems.length === 0) {
        return ["No EPUBs found in this folder."];
      }
      const lines: string[] = [];
      for (let index = 0; index < state.filePickerItems.length; index += 1) {
        const item = state.filePickerItems[index];
        const cursor = index === state.filePickerCursor ? ">" : " ";
        const check = state.filePickerSelected.has(index) ? "[x]" : "[ ]";
        const label = truncate(item.fileName, Math.max(1, width - 6));
        const row = `${cursor} ${check} ${label}`;
        lines.push(index === state.filePickerCursor ? fg(state.theme.accent, row) : fg(state.theme.dim, row));
      }
      return lines;
    }
    default:
      return [];
  }
}

function draw(state: AppState): void {
  const width = process.stdout.columns || 120;
  const height = process.stdout.rows || 40;

  const layout = getViewportLayout(state, width, height);
  const allMainLines = currentLines(state, layout.contentWidth, layout.bodyHeight);
  const maxOffset = computeChapterMaxOffset(state, layout.contentWidth, layout.bodyHeight);
  state.blockOffset = clamp(state.blockOffset, 0, maxOffset);
  const mainLines = allMainLines.slice(state.blockOffset, state.blockOffset + layout.bodyHeight);
  const overlayLines = layout.overlayWidth ? renderOverlay(state, layout.overlayWidth - 2, layout.bodyHeight) : [];
  const scrollbar = state.currentBook
    ? renderScrollbar(allMainLines.length, layout.bodyHeight, state.blockOffset, state.theme)
    : [];
  const footerLines = renderFooter(state, width, formatProgress(state, layout.contentWidth, layout.bodyHeight));
  const body = renderBody(
    mainLines,
    overlayLines,
    layout.bodyHeight,
    layout.mainWidth,
    layout.overlayWidth,
    state.theme,
    scrollbar
  );
  const frameLines = [
    renderStatusBar(state, width),
    ...body.slice(0, -1).split("\n"),
    ...footerLines
  ];
  process.stdout.write(renderFrame(frameLines, width, height));
}

function syncPosition(state: AppState): void {
  if (!state.currentBook) {
    return;
  }
  const width = process.stdout.columns || 120;
  const height = process.stdout.rows || 40;
  const layout = getViewportLayout(state, width, height);
  state.storage.savePosition({
    bookId: state.currentBook.id,
    chapterIndex: state.chapterIndex,
    chapterProgress: computeChapterProgress(state, layout.contentWidth, layout.bodyHeight),
    bookProgress: computeBookProgress(state, layout.contentWidth, layout.bodyHeight),
    blockOffset: state.blockOffset
  });
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
    commandSuggestionIndex: 0,
    status: "Ready",
    overlay: "none",
    overlayCursor: 0,
    discoveries: await discoverEpubs(process.cwd()),
    shouldQuit: false,
    filePickerCursor: 0,
    filePickerItems: [],
    filePickerSelected: new Set(),
    filePickerForce: false,
    mouseDrag: null,
    layoutMetrics: null,
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
  process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1002h\x1b[?1006h");

  const redraw = () => draw(state);
  redraw();

  process.stdin.on("data", async (chunk: string) => {
    await handleInput(chunk, state, redraw, async (cmd) => {
      await executeCommand(state, cmd);
      syncPosition(state);
    }, syncPosition, async (paths, force) => {
      for (const epubPath of paths) {
        await importAndOpen(state, epubPath, force);
      }
      syncPosition(state);
    });
  });
}
