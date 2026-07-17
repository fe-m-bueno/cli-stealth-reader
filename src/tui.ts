import { commandHelp } from "./commands.js";
import { executeCommand, importAndOpen, openBook, persistReadingPace } from "./executor.js";
import { clampFocusBlockIndex, mapFocusIndexToBlockOffset, renderFocusBlock } from "./focus.js";
import { handleInput } from "./input.js";
import { composeFilePickerModal, composeLibraryModal } from "./library-modal.js";
import { composeListOverlayModal, isListModalOverlay } from "./overlay-modals.js";
import { bg, bold, fg } from "./color.js";
import { discoverBooks } from "./discovery.js";
import { renderBlocks } from "./renderers.js";
import { TOGGL_REFRESH_INTERVAL_MS, refreshCurrentTogglEntry } from "./toggl.js";
import {
  clamp,
  computeChapterMaxOffset,
  computeBookProgress,
  computeChapterProgress,
  formatProgress,
  getViewportLayout,
  isModalOverlay,
  renderFrame,
  resetRenderCache,
  renderBody,
  renderFooter,
  renderScrollbar,
  renderStatusBar,
  selectMainViewportLines,
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
import { composeShortcutPanel } from "./shortcuts-panel.js";
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

  if (state.overlay === "keys") {
    const backgroundState = { ...state, overlay: "none" } as AppState;
    const backgroundLines = currentLines(backgroundState, width, height);
    return composeShortcutPanel(state, backgroundLines, width, height);
  }

  if (state.overlay === "books") {
    const backgroundState = { ...state, overlay: "none" } as AppState;
    const backgroundLines = currentLines(backgroundState, width, height);
    return composeLibraryModal(state, backgroundLines, width, height);
  }

  if (state.overlay === "file-picker") {
    const backgroundState = { ...state, overlay: "none" } as AppState;
    const backgroundLines = currentLines(backgroundState, width, height);
    return composeFilePickerModal(state, backgroundLines, width, height);
  }

  if (isListModalOverlay(state.overlay)) {
    const backgroundState = { ...state, overlay: "none" } as AppState;
    const backgroundLines = currentLines(backgroundState, width, height);
    return composeListOverlayModal(state, backgroundLines, width, height);
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

  return renderChapterLines(state, width);
}

function renderChapterLines(state: AppState, width: number): string[] {
  const book = state.currentBook!;
  const searchQuery = state.searchState?.query;
  const cached = state.chapterRenderCache;
  if (
    cached
    && cached.bookId === book.id
    && cached.chapterIndex === state.chapterIndex
    && cached.renderMode === state.renderMode
    && cached.width === width
    && cached.theme === state.theme
    && cached.codeLanguage === state.codeLanguage
    && cached.codeDensity === state.codeDensity
    && cached.searchQuery === searchQuery
    && cached.plainHighlight === state.plainHighlight
    && cached.lineSpacing === state.lineSpacing
  ) {
    return cached.lines;
  }

  const chapter = book.chapters[state.chapterIndex];
  const lines = renderBlocks(
    chapter.blocks,
    state.renderMode,
    width,
    state.theme,
    state.codeLanguage,
    state.codeDensity,
    searchQuery,
    state.plainHighlight,
    0,
    true,
    state.lineSpacing
  );
  state.chapterRenderCache = {
    bookId: book.id,
    chapterIndex: state.chapterIndex,
    renderMode: state.renderMode,
    width,
    theme: state.theme,
    codeLanguage: state.codeLanguage,
    codeDensity: state.codeDensity,
    searchQuery,
    plainHighlight: state.plainHighlight,
    lineSpacing: state.lineSpacing,
    lines
  };
  return lines;
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

export function renderOverlay(state: AppState, width: number, height: number): string[] {
  switch (state.overlay) {
    case "help":
      return commandHelp().slice(0, Math.max(1, height));
    case "diagnostics":
      if (state.integrationLines?.length) {
        return state.integrationLines.slice(0, Math.max(1, height));
      }
      return state.currentBook?.diagnostics.length
        ? state.currentBook.diagnostics.map((item) => `${item.severity.toUpperCase()} ${item.message}${item.context ? ` (${item.context})` : ""}`)
        : ["No diagnostics for the current book."];
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
  const fixedOverlay = isModalOverlay(state.overlay);
  const maxOffset = state.overlay === "help"
    ? helpMaxOffset
    : fixedOverlay
    ? 0
    : state.focusMode
    ? 0
    : computeChapterMaxOffset(state, layout.contentWidth, layout.bodyHeight);
  if (state.overlay !== "help" && !fixedOverlay && !state.focusMode) {
    state.blockOffset = clamp(state.blockOffset, 0, maxOffset);
  }
  const mainLines = selectMainViewportLines(state, allMainLines, layout.bodyHeight);
  const transitionLine = state.overlay === "none" ? chapterTransitionLine(state, layout.contentWidth) : null;
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
  const scrollbar = state.currentBook && !isModalOverlay(state.overlay)
    ? renderScrollbar(allMainLines.length, layout.bodyHeight, effectiveOffset, state.theme, state.overlay === "help" ? false : state.focusMode)
    : state.overlay === "help"
      ? renderScrollbar(allMainLines.length, layout.bodyHeight, effectiveOffset, state.theme, false)
    : [];
  const originalOffset = state.blockOffset;
  const progress = state.overlay === "help" || isModalOverlay(state.overlay)
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
    chapterRenderCache: null,
    focusLineMetrics: null,
    searchState: null,
    navHistory: [],
    navHistoryCursor: -1,
    librarySortKey: "lastOpened",
    librarySortDir: "desc",
    booksTagFilter: null,
    booksTagMap: new Map(),
    helpCommand: null,
    mouseCapture: settings.mouseCapture,
    shortcutCollapsedCategories: new Set(["navigation", "commands", "view"]),
    shortcutSearchBuffer: "",
    shortcutSearchMode: false,
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
  process.stdout.write("\x1b[?1007h\x1b[?1049h\x1b[>1u\x1b[?25l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l");
  resetRenderCache();

  const redraw = () => draw(state);
  redraw();

  if (process.stdout.isTTY) {
    process.stdout.on("resize", () => {
      state.layoutMetrics = null;
      state.chapterRenderCache = null;
      state.focusLineMetrics = null;
      resetRenderCache();
      redraw();
    });
  }

  let togglRefreshInFlight = false;
  const refreshTogglTimer = async () => {
    if (togglRefreshInFlight || !storage.getSetting("togglApiToken")) {
      return;
    }
    togglRefreshInFlight = true;
    try {
      await refreshCurrentTogglEntry(storage);
      redraw();
    } catch {
      // Reading remains available while Toggl is offline; explicit commands surface API errors.
    } finally {
      togglRefreshInFlight = false;
    }
  };
  void refreshTogglTimer();
  setInterval(() => void refreshTogglTimer(), TOGGL_REFRESH_INTERVAL_MS).unref();

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
