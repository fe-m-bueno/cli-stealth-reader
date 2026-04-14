import { commandHelp } from "./commands.js";
import { executeCommand, openBook } from "./executor.js";
import { handleInput } from "./input.js";
import { bold, fg } from "./color.js";
import { discoverEpubs } from "./discovery.js";
import { KEYBOARD_SHORTCUTS } from "./help.js";
import { renderBlocks } from "./renderers.js";
import {
  BODY_OVERHEAD,
  MIN_MAIN_WIDTH,
  OVERLAY_MAX_WIDTH,
  clearScreen,
  computeBookProgress,
  computeChapterProgress,
  renderBody,
  renderFooter,
  renderStatusBar,
  truncate
} from "./screen.js";
import { Storage } from "./storage.js";
import { DEFAULT_THEME, THEMES } from "./themes.js";
import type { AppState } from "./types.js";

export type { AppState };

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

  const bodyHeight = height - BODY_OVERHEAD;
  const overlayWidth = state.overlay === "none" ? 0 : Math.min(OVERLAY_MAX_WIDTH, Math.floor(width * 0.32));
  const mainWidth = Math.max(MIN_MAIN_WIDTH, width - overlayWidth - (overlayWidth ? 3 : 0));
  const mainLines = currentLines(state, mainWidth - 2, bodyHeight);
  const overlayLines = overlayWidth ? renderOverlay(state, overlayWidth - 2, bodyHeight) : [];

  process.stdout.write(renderStatusBar(state, width) + "\n");
  process.stdout.write(renderBody(mainLines, overlayLines, bodyHeight, mainWidth, overlayWidth, state.theme));
  process.stdout.write(renderFooter(state, width) + "\n");
}

function syncPosition(state: AppState): void {
  if (!state.currentBook) {
    return;
  }
  const chapter = state.currentBook.chapters[state.chapterIndex];
  state.storage.savePosition({
    bookId: state.currentBook.id,
    chapterIndex: state.chapterIndex,
    chapterProgress: computeChapterProgress(chapter, state.blockOffset),
    bookProgress: computeBookProgress(state.currentBook, state.chapterIndex, state.blockOffset),
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
    await handleInput(chunk, state, redraw, async (cmd) => {
      await executeCommand(state, cmd);
      syncPosition(state);
    }, syncPosition);
  });
}
