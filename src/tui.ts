import { commandHelp } from "./commands.js";
import { executeCommand, importAndOpen, openBook, persistReadingPace } from "./executor.js";
import { clampFocusBlockIndex, mapFocusIndexToBlockOffset, renderFocusBlock } from "./focus.js";
import { handleInput } from "./input.js";
import { bg, bold, fg } from "./color.js";
import { discoverBooks } from "./discovery.js";
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
import {
  DEFAULT_WPM,
  absoluteWordCursor,
  applySample,
  createEmptyPaceState,
  prepareSample
} from "./reading-pace.js";
import { Storage } from "./storage.js";
import {
  APPEARANCE_THEMES,
  DEFAULT_APPEARANCE_THEME,
  DEFAULT_COLOR_SCHEME,
  THEMES,
  applyAppearanceTheme
} from "./themes.js";
import { renderSettingsPanel } from "./settings-panel.js";
import type { AppState, PaceState } from "./types.js";

function loadGlobalPace(storage: Storage): Pick<PaceState, "globalWpm" | "globalActiveMs"> {
  const wpm = Number(storage.getSetting("globalWpm"));
  const activeMs = Number(storage.getSetting("globalActiveMs"));
  return {
    globalWpm: Number.isFinite(wpm) && wpm > 0 ? wpm : DEFAULT_WPM,
    globalActiveMs: Number.isFinite(activeMs) && activeMs >= 0 ? activeMs : 0
  };
}

let mouseCaptureEnabled = false;

function setMouseCapture(enabled: boolean): void {
  if (mouseCaptureEnabled === enabled) {
    return;
  }
  process.stdout.write(enabled ? "\x1b[?1000h\x1b[?1002h\x1b[?1006h" : "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l");
  mouseCaptureEnabled = enabled;
}

export function currentLines(state: AppState, width: number, height: number): string[] {
  if (state.overlay === "help") {
    return commandHelp(state.helpCommand ?? undefined, width, state.theme);
  }

  if (state.overlay === "settings") {
    return renderSettingsPanel(state, width, height);
  }

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
    const focusHeader = fg(
      state.theme.dim,
      truncate(
        `FOCUS · Ch ${state.chapterIndex + 1}/${state.currentBook.chapters.length} ${chapter.title} · § ${state.focusBlockIndex + 1}/${chapter.blocks.length} · j/k next · Esc exit`,
        width
      )
    );
    const focusLines = [focusHeader, "", ...focusedBlockLines];
    const topPadding = Math.max(0, Math.floor((height - focusLines.length) / 2));
    return [...Array.from({ length: topPadding }, () => ""), ...focusLines];
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
    state.plainHighlight,
    0,
    true,
    state.lineSpacing
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
      const latestBookId = state.storage.getLatestBookId();
      const tagsByBookId = state.booksTagMap;
      const sortKeyLabels: Record<string, string> = {
        lastOpened: "Last Opened",
        title: "Title",
        author: "Author",
        progress: "Progress"
      };
      const dirArrow = state.librarySortDir === "asc" ? "↑" : "↓";
      const filterNote = state.booksTagFilter ? `  Filter: #${state.booksTagFilter} (Esc clears)` : "";
      const header = truncate(
        `  Library · Sort: ${sortKeyLabels[state.librarySortKey]} ${dirArrow}${filterNote}`,
        width
      );
      const continueAction = latestBookId
        ? state.booksTagFilter
          ? "Enter continue/open"
          : "Enter continues selected book"
        : "Enter open";
      const resumeHint = state.booksTagFilter ? "/resume latest" : "/resume opens latest";
      const actionHint = truncate(
        `  ${continueAction} · ${resumeHint} · b bookmarks · n notes · /book search`,
        width
      );
      return [
        header,
        actionHint,
        ...books.map((book, index) => {
          const marker = index === state.overlayCursor ? ">" : " ";
          const isLatest = book.id === latestBookId;
          const progressTag = book.bookProgress !== null
            ? `[Ch.${(book.chapterIndex ?? 0) + 1} · ${Math.round(book.bookProgress * 100)}%]`
            : "[not started]";
          const latestTag = isLatest ? "[continue] " : "";
          const tags = tagsByBookId.get(book.id) ?? [];
          const tagsStr = tags.length > 0 ? `  ${tags.map((t) => `#${t}`).join(" ")}` : "";
          const right = `  ${latestTag}${progressTag}${tagsStr}`;
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
    case "colorschemes":
      return THEMES.map((theme, index) => {
        const marker = index === state.overlayCursor ? ">" : " ";
        return `${marker} ${theme.label} (${theme.id})`;
      });
    case "themes":
      return APPEARANCE_THEMES.map((theme, index) => {
        const marker = index === state.overlayCursor ? ">" : " ";
        return `${marker} ${theme.label} (${theme.id})`;
      });
    case "help":
      return commandHelp().slice(0, Math.max(1, height));
    case "keys":
      return KEYBOARD_SHORTCUTS.slice(0, Math.max(1, height)).map((row) => `${row.key.padEnd(14)} ${row.description}`);
    case "diagnostics":
      if (state.integrationLines?.length) {
        return state.integrationLines.slice(0, Math.max(1, height));
      }
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
  setMouseCapture(state.mouseCapture);

  const width = process.stdout.columns || 120;
  const height = process.stdout.rows || 40;

  const layout = getViewportLayout(state, width, height);
  const allMainLines = currentLines(state, layout.contentWidth, layout.bodyHeight);
  const helpMaxOffset = state.overlay === "help"
    ? Math.max(0, allMainLines.length - layout.bodyHeight)
    : 0;
  if (state.overlay === "help") {
    state.overlayCursor = clamp(state.overlayCursor, 0, helpMaxOffset);
  }
  const maxOffset = state.overlay === "help"
    ? helpMaxOffset
    : state.overlay === "settings"
    ? 0
    : state.focusMode
    ? 0
    : computeChapterMaxOffset(state, layout.contentWidth, layout.bodyHeight);
  if (state.overlay !== "help" && !state.focusMode) {
    state.blockOffset = clamp(state.blockOffset, 0, maxOffset);
  }
  const mainLines = state.overlay === "help"
    ? allMainLines.slice(state.overlayCursor, state.overlayCursor + layout.bodyHeight)
    : state.overlay === "settings"
    ? allMainLines.slice(0, layout.bodyHeight)
    : state.focusMode
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
  const effectiveOffset = state.overlay === "help"
    ? state.overlayCursor
    : state.focusMode
    ? mapFocusIndexToBlockOffset(state, layout.contentWidth, state.focusBlockIndex)
    : state.blockOffset;
  const scrollbar = state.currentBook && state.overlay !== "settings"
    ? renderScrollbar(allMainLines.length, layout.bodyHeight, effectiveOffset, state.theme, state.overlay === "help" ? false : state.focusMode)
    : state.overlay === "help"
      ? renderScrollbar(allMainLines.length, layout.bodyHeight, effectiveOffset, state.theme, false)
    : [];
  const originalOffset = state.blockOffset;
  const progress = state.overlay === "help" || state.overlay === "settings"
    ? ""
    : (() => {
        state.blockOffset = effectiveOffset;
        const renderedProgress = formatProgress(state, layout.contentWidth, layout.bodyHeight);
        state.blockOffset = originalOffset;
        return renderedProgress;
      })();
  const chapterBlockCount = state.currentBook?.chapters[state.chapterIndex]?.blocks.length ?? 0;
  const focusProgress = state.focusMode && chapterBlockCount > 0
    ? `§ ${state.focusBlockIndex + 1} / ${chapterBlockCount}`
    : "";
  const footerProgress = [progress, focusProgress].filter(Boolean).join(` ${fg(state.theme.border, "·")} `);
  const footerLines = renderFooter(state, width, footerProgress);
  const body = renderBody(
    layout.contentPadding > 0
      ? mainLines.map((line) => `${" ".repeat(layout.contentPadding)}${line}`)
      : mainLines,
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
  const shouldPaintFrameBackground = state.appearanceTheme.id.startsWith("light");
  process.stdout.write(
    renderFrame(
      frameLines,
      width,
      height,
      shouldPaintFrameBackground ? state.theme.background : undefined,
      shouldPaintFrameBackground ? state.theme.foreground : undefined
    )
  );
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

  const chapterProgress = computeChapterProgress(state, layout.contentWidth, layout.bodyHeight);
  const bookProgress = computeBookProgress(state, layout.contentWidth, layout.bodyHeight);

  const chapters = state.currentBook.chapters.map((chapter) => ({ wordCount: chapter.wordCount }));
  const wordCursor = absoluteWordCursor(chapters, state.chapterIndex, chapterProgress);
  const readingActive = state.overlay === "none" && !state.commandMode;
  const now = Date.now();
  const { sample, nextMeta } = prepareSample({
    state: state.readingPace,
    now,
    wordCursor,
    readingActive
  });
  let pace = { ...state.readingPace, ...nextMeta };
  if (sample) {
    pace = { ...applySample(pace, sample), ...nextMeta };
  }
  state.readingPace = pace;
  persistReadingPace(state);

  state.storage.savePosition({
    bookId: state.currentBook.id,
    chapterIndex: state.chapterIndex,
    chapterProgress,
    bookProgress,
    blockOffset: state.blockOffset
  });
  if (state.focusMode) {
    state.blockOffset = originalOffset;
  }
}


export async function runTui(options?: { resume?: boolean }): Promise<void> {
  const storage = new Storage();
  const settings = storage.getSettings();
  const colorScheme = THEMES.find((item) => item.id === settings.themeId) ?? DEFAULT_COLOR_SCHEME;
  const appearanceTheme = APPEARANCE_THEMES.find((item) => item.id === settings.appearanceThemeId) ?? DEFAULT_APPEARANCE_THEME;
  const state: AppState = {
    storage,
    cwd: process.cwd(),
    colorScheme,
    appearanceTheme,
    theme: applyAppearanceTheme(colorScheme, appearanceTheme),
    renderMode: settings.renderMode,
    codeLanguage: settings.codeLanguage,
    codeDensity: settings.codeDensity,
    plainHighlight: settings.plainHighlight,
    fontScale: settings.fontScale,
    marginSize: settings.marginSize,
    lineSpacing: settings.lineSpacing,
    progressVisibility: settings.progressVisibility,
    readingPace: createEmptyPaceState(loadGlobalPace(storage)),
    currentBook: null,
    chapterIndex: 0,
    blockOffset: 0,
    focusMode: false,
    focusBlockIndex: 0,
    commandBuffer: "",
    commandCursor: 0,
    commandMode: false,
    commandSuggestionIndex: 0,
    status: "Ready",
    overlay: "none",
    overlayCursor: 0,
    discoveries: await discoverBooks(process.cwd()),
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
    booksTagMap: new Map(),
    helpCommand: null,
    mouseCapture: settings.mouseCapture,
    settingsDraft: null,
    settingsSearchBuffer: "",
    settingsSearchMode: false
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
  process.stdout.write("\x1b[?1007h\x1b[?1049h\x1b[?25l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l");

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
