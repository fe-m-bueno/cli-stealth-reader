import { commandHelp } from "./commands.js";
import { executeCommand, importAndOpen, openBook } from "./executor.js";
import { clampFocusBlockIndex, mapFocusIndexToBlockOffset, renderFocusBlock } from "./focus.js";
import { handleInput } from "./input.js";
import { bg, bold, fg } from "./color.js";
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
      lines.push("Books found in this folder:");
      state.discoveries.slice(0, Math.max(3, height - 8)).forEach((item) => {
        lines.push(`  ${item.fileName}`);
      });
      lines.push("");
      lines.push("Press Enter to open the file picker.");
    }
    return lines;
  }

  if (state.focusMode) {
    const chapter = state.currentBook.chapters[state.chapterIndex];
    if (!chapter || chapter.blocks.length === 0) {
      return [fg(state.theme.dim, "This chapter has no readable blocks.")];
    }
    state.focusBlockIndex = clampFocusBlockIndex(state, state.focusBlockIndex);
    const focusedBlockLines = renderFocusBlock(state, width);
    const topPadding = Math.max(0, Math.floor((height - focusedBlockLines.length) / 2));
    return [...Array.from({ length: topPadding }, () => ""), ...focusedBlockLines];
  }

  const chapter = state.currentBook.chapters[state.chapterIndex];
  return renderBlocks(
    chapter.blocks,
    state.renderMode,
    width,
    state.theme,
    state.codeLanguage,
    state.codeDensity,
    state.searchState?.query,
    state.plainHighlight
  );
}

function chapterTransitionLine(state: AppState, width: number): string | null {
  if (!state.chapterTransition || !state.currentBook) {
    return null;
  }

  if (state.chapterTransition.targetChapterIndex < 0 || state.chapterTransition.targetChapterIndex >= state.currentBook.chapters.length) {
    return null;
  }

  const label = state.status || state.chapterTransition.message;
  const padded = `  ${label}  `;
  return bg(state.theme.accent, fg(state.theme.background, padded.padEnd(width, " ")));
}

function formatRelativeTime(timestamp: number): string {
  const elapsedMs = Math.max(0, Date.now() - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (elapsedMs < minute) {
    return "agora";
  }
  if (elapsedMs < hour) {
    const minutes = Math.floor(elapsedMs / minute);
    return `há ${minutes} min`;
  }
  if (elapsedMs < day) {
    const hours = Math.floor(elapsedMs / hour);
    return `há ${hours} h`;
  }
  const days = Math.floor(elapsedMs / day);
  return `há ${days} dia${days > 1 ? "s" : ""}`;
}

export function renderOverlay(state: AppState, width: number, height: number): string[] {
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
    case "books": {
      const books = state.storage.listBooksWithProgress(state.librarySortKey, state.librarySortDir, state.booksTagFilter ?? undefined);
      const tagsByBookId = state.booksTagMap;
      const sortKeyLabels: Record<string, string> = {
        lastOpened: "Last Opened",
        title: "Title",
        author: "Author",
        progress: "Progress"
      };
      const dirArrow = state.librarySortDir === "asc" ? "↑" : "↓";
      const filterNote = state.booksTagFilter ? `  [tag: #${state.booksTagFilter}]` : "";
      const header = truncate(
        `  Sort: ${sortKeyLabels[state.librarySortKey]} ${dirArrow}   (Press s to change, r to reverse)${filterNote}`,
        width
      );
      return [
        header,
        ...books.map((book, index) => {
          const marker = index === state.overlayCursor ? ">" : " ";
          const progressTag = book.bookProgress !== null
            ? `[Ch.${(book.chapterIndex ?? 0) + 1} · ${Math.round(book.bookProgress * 100)}%]`
            : "[not started]";
          const tags = tagsByBookId.get(book.id) ?? [];
          const tagsStr = tags.length > 0 ? `  ${tags.map((t) => `#${t}`).join(" ")}` : "";
          const right = `  ${progressTag}${tagsStr}`;
          const titleAuthor = truncate(`${book.title}  —  ${book.author}`, Math.max(1, width - 2 - right.length));
          return `${marker} ${titleAuthor}${right}`;
        })
      ];
    }
    case "bookmarks": {
      if (!state.currentBook) {
        return ["No book open."];
      }
      const bookmarks = state.storage.listBookmarks(state.currentBook.id);
      return bookmarks.map((bookmark, index) => {
        const marker = index === state.overlayCursor ? ">" : " ";
        const location = `Ch.${bookmark.chapterIndex + 1} §${bookmark.blockOffset}`;
        const label = bookmark.label ? ` — "${bookmark.label}"` : "";
        const age = `[${formatRelativeTime(bookmark.createdAt)}]`;
        const left = truncate(`${location}${label}`, Math.max(1, width - age.length - 1));
        return `${marker} ${left} ${age}`;
      });
    }
    case "notes": {
      if (!state.currentBook) {
        return ["No book open."];
      }
      const notes = state.storage.listNotes(state.currentBook.id);
      if (notes.length === 0) {
        return ["No notes for this book yet."];
      }
      return notes.map((note, index) => {
        const marker = index === state.overlayCursor ? ">" : " ";
        const location = note.chapterIndex !== null
          ? `Ch.${note.chapterIndex + 1} §${note.blockOffset ?? 0}`
          : "Book";
        const age = `[${formatRelativeTime(note.createdAt)}]`;
        const left = truncate(`${location}  "${note.content}"`, Math.max(1, width - age.length - 1));
        return `${marker} ${left} ${age}`;
      });
    }
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
        return ["No books found in this folder."];
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
  const maxOffset = state.focusMode
    ? 0
    : computeChapterMaxOffset(state, layout.contentWidth, layout.bodyHeight);
  if (!state.focusMode) {
    state.blockOffset = clamp(state.blockOffset, 0, maxOffset);
  }
  const mainLines = state.focusMode
    ? allMainLines.slice(0, layout.bodyHeight)
    : allMainLines.slice(state.blockOffset, state.blockOffset + layout.bodyHeight);
  const transitionLine = chapterTransitionLine(state, layout.contentWidth);
  if (transitionLine) {
    const transitionRow = Math.min(mainLines.length, layout.bodyHeight - 1);
    const nextLines = [...mainLines];
    while (nextLines.length < transitionRow) {
      nextLines.push("");
    }
    nextLines.splice(transitionRow, 0, transitionLine);
    mainLines.splice(0, mainLines.length, ...nextLines.slice(0, layout.bodyHeight));
  }
  const overlayLines = layout.overlayWidth ? renderOverlay(state, layout.overlayWidth - 2, layout.bodyHeight) : [];
  const effectiveOffset = state.focusMode
    ? mapFocusIndexToBlockOffset(state, layout.contentWidth, state.focusBlockIndex)
    : state.blockOffset;
  const scrollbar = state.currentBook
    ? renderScrollbar(allMainLines.length, layout.bodyHeight, effectiveOffset, state.theme, state.focusMode)
    : [];
  const originalOffset = state.blockOffset;
  state.blockOffset = effectiveOffset;
  const progress = formatProgress(state, layout.contentWidth, layout.bodyHeight);
  state.blockOffset = originalOffset;
  const chapterBlockCount = state.currentBook?.chapters[state.chapterIndex]?.blocks.length ?? 0;
  const focusProgress = state.focusMode && chapterBlockCount > 0
    ? `§ ${state.focusBlockIndex + 1} / ${chapterBlockCount}`
    : "";
  const footerProgress = [progress, focusProgress].filter(Boolean).join(` ${fg(state.theme.border, "·")} `);
  const footerLines = renderFooter(state, width, footerProgress);
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
  const originalOffset = state.blockOffset;
  if (state.focusMode) {
    state.focusBlockIndex = clampFocusBlockIndex(state, state.focusBlockIndex);
    state.blockOffset = mapFocusIndexToBlockOffset(state, layout.contentWidth, state.focusBlockIndex);
  }
  state.storage.savePosition({
    bookId: state.currentBook.id,
    chapterIndex: state.chapterIndex,
    chapterProgress: computeChapterProgress(state, layout.contentWidth, layout.bodyHeight),
    bookProgress: computeBookProgress(state, layout.contentWidth, layout.bodyHeight),
    blockOffset: state.blockOffset
  });
  if (state.focusMode) {
    state.blockOffset = originalOffset;
  }
}


export async function runTui(options?: { resume?: boolean }): Promise<void> {
  const storage = new Storage();
  const settings = storage.getSettings();
  const state: AppState = {
    storage,
    cwd: process.cwd(),
    theme: THEMES.find((item) => item.id === settings.themeId) ?? DEFAULT_THEME,
    renderMode: settings.renderMode,
    codeLanguage: settings.codeLanguage,
    codeDensity: settings.codeDensity,
    plainHighlight: settings.plainHighlight,
    progressVisibility: settings.progressVisibility,
    currentBook: null,
    chapterIndex: 0,
    blockOffset: 0,
    focusMode: false,
    focusBlockIndex: 0,
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
    chapterTransition: null,
    mouseDrag: null,
    layoutMetrics: null,
    searchState: null,
    navHistory: [],
    navHistoryCursor: -1,
    librarySortKey: "lastOpened",
    librarySortDir: "desc",
    booksTagFilter: null,
    booksTagMap: new Map()
  };

  if (options?.resume) {
    const latest = storage.getLatestBookId();
    if (latest) {
      const latestBook = storage.getBook(latest);
      if (latestBook) {
        await openBook(state, latestBook);
      }
    }
  } else {
    const books = storage.listBooks();
    if (books.length > 0) {
      state.overlay = "books";
      state.overlayCursor = 0;
      state.booksTagMap = storage.listTagsByBookId();
      state.status = "Select a book to open. Press Enter to open, Esc to dismiss.";
    }
  }

  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdout.write("\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h");

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
