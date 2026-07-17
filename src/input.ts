import { applyCommandAutocomplete, commandAutocompleteIndex, commandHelp, listCommandSuggestions } from "./commands.js";
import { applySearchHit, pushNavHistory } from "./executor.js";
import { clampFocusBlockIndex, getChapterBlockCount, mapBlockOffsetToFocusIndex, mapFocusIndexToBlockOffset } from "./focus.js";
import {
  filePickerModalHitTest,
  filteredLibraryItems,
  filteredPickerItems,
  libraryModalHitTest,
  resetOverlaySearch
} from "./library-modal.js";
import { modalGeometry } from "./modal.js";
import {
  clamp,
  computeChapterMaxOffset,
  footerHeight,
  getScrollbarMetrics,
  getViewportLayout,
  MIN_PAGE_LINES,
  renderFooter,
  stripAnsi,
  scrollbarOffsetFromThumb
} from "./screen.js";
import {
  applySettingsDraft,
  closeSettingsPanel,
  cycleSelectedSetting,
  filteredSettingsItems,
  moveSettingsTab,
  openSettingsPanel
} from "./settings-panel.js";
import { APPEARANCE_THEMES, THEMES, applyAppearanceTheme } from "./themes.js";
import {
  CTRL_DOT_SEQUENCES,
  CTRL_X_SEQUENCES,
  isShortcutHelpKey,
  openShortcutHelp,
  shortcutModalGeometry,
  shortcutModalHitTest,
  shortcutPanelRows,
  toggleShortcutCategory
} from "./shortcuts-panel.js";
import type { AppState, LibrarySortKey } from "./types.js";

function moveChapter(state: AppState, delta: number): void {
  if (!state.currentBook) {
    return;
  }
  pushNavHistory(state);
  state.chapterIndex = clamp(state.chapterIndex + delta, 0, state.currentBook.chapters.length - 1);
  state.blockOffset = 0;
  state.focusBlockIndex = 0;
  pushNavHistory(state);
}

function moveToNextChapterFromScroll(state: AppState, redraw: () => void, syncPos: (state: AppState) => void): boolean {
  if (!state.currentBook) {
    return false;
  }

  const nextChapter = state.currentBook.chapters[state.chapterIndex + 1];
  if (!nextChapter) {
    state.status = "End of book";
    return false;
  }

  showChapterTransition(state, redraw, syncPos, `Chapter ${nextChapter.index + 1}: ${nextChapter.title}`, nextChapter.index);
  return true;
}

function showChapterTransition(
  state: AppState,
  redraw: () => void,
  syncPos: (state: AppState) => void,
  message: string,
  targetChapterIndex: number,
  requiredStage = 3
): void {
  const previousStage = state.chapterTransition?.targetChapterIndex === targetChapterIndex
    ? state.chapterTransition.stage
    : 0;
  const stage = Math.min(requiredStage, previousStage + 1);
  if (stage === requiredStage) {
    pushNavHistory(state);
    state.chapterIndex = targetChapterIndex;
    state.blockOffset = 0;
    state.focusBlockIndex = 0;
    pushNavHistory(state);
    state.chapterTransition = null;
    state.status = `Moved to chapter ${state.chapterIndex + 1}`;
    syncPos(state);
    redraw();
    return;
  }

  state.chapterTransition = {
    message,
    targetChapterIndex,
    stage
  };
  const remaining = requiredStage - stage;
  if (requiredStage > 3) {
    state.status = remaining === 1
      ? `Pull once more · Release to open ${message}`
      : `Pull ${remaining} more · ${message}`;
  } else {
    state.status = stage === 1
      ? `Scroll again for ${message}`
      : `One more scroll to confirm ${message}`;
  }
  redraw();
}

function clearChapterTransition(state: AppState): void {
  state.chapterTransition = null;
  if (state.status.startsWith("Scroll again for") || state.status.startsWith("One more scroll to confirm")) {
    state.status = "Ready";
  }
}

function isMouseWheelDown(chunk: string): boolean {
  return /\x1b\[<65;\d+;\d+[mM]/.test(chunk);
}

function isMouseWheelUp(chunk: string): boolean {
  return /\x1b\[<64;\d+;\d+[mM]/.test(chunk);
}

const UP_KEYS = ["\u001b[A", "\u001bOA"];
const DOWN_KEYS = ["\u001b[B", "\u001bOB"];
const RIGHT_KEYS = ["\u001b[C", "\u001bOC"];
const LEFT_KEYS = ["\u001b[D", "\u001bOD"];
const PAGE_UP_KEYS = ["\u001b[5~"];
const PAGE_DOWN_KEYS = ["\u001b[6~"];
const BUFFERED_NAV_KEYS = [
  "j",
  "k",
  ...PAGE_DOWN_KEYS,
  ...PAGE_UP_KEYS,
  ...RIGHT_KEYS,
  ...LEFT_KEYS,
  ...DOWN_KEYS,
  ...UP_KEYS
].sort((left, right) => right.length - left.length);

function isOneOf(chunk: string, keys: string[]): boolean {
  return keys.includes(chunk);
}

function isUpKey(chunk: string): boolean {
  return isOneOf(chunk, UP_KEYS);
}

function isDownKey(chunk: string): boolean {
  return isOneOf(chunk, DOWN_KEYS);
}

function isRightKey(chunk: string): boolean {
  return isOneOf(chunk, RIGHT_KEYS);
}

function isLeftKey(chunk: string): boolean {
  return isOneOf(chunk, LEFT_KEYS);
}

function isPageUpKey(chunk: string): boolean {
  return isOneOf(chunk, PAGE_UP_KEYS);
}

function isPageDownKey(chunk: string): boolean {
  return isOneOf(chunk, PAGE_DOWN_KEYS);
}

function splitBufferedNavigationInput(chunk: string): string[] | null {
  const parts: string[] = [];
  let offset = 0;

  while (offset < chunk.length) {
    const next = BUFFERED_NAV_KEYS.find((key) => chunk.startsWith(key, offset));
    if (!next) {
      return null;
    }
    parts.push(next);
    offset += next.length;
  }

  return parts.length > 1 ? parts : null;
}

type MouseEventKind = "press" | "release" | "drag";

interface ParsedMouseEvent {
  code: number;
  button: number;
  x: number;
  y: number;
  kind: MouseEventKind;
}

function parseMouseEvent(chunk: string): ParsedMouseEvent | null {
  const match = /^\x1b\[<(\d+);(\d+);(\d+)([mM])$/.exec(chunk);
  if (!match) {
    return null;
  }

  const code = Number(match[1]);
  const x = Number(match[2]);
  const y = Number(match[3]);
  const suffix = match[4];
  const kind = suffix === "m"
    ? "release"
    : (code & 32) !== 0
      ? "drag"
      : "press";

  return {
    code,
    button: code & 3,
    x,
    y,
    kind
  };
}

function applyUiPointer(state: AppState, mouse: ParsedMouseEvent): boolean {
  if (mouse.kind !== "press" || mouse.button !== 0 || (mouse.code & 64) !== 0) {
    return false;
  }

  const width = process.stdout.columns || 120;
  const height = process.stdout.rows || 40;
  const layout = getViewportLayout(state, width, height);

  if (state.overlay === "keys") {
    const hit = shortcutModalHitTest(state, layout.contentWidth, layout.bodyHeight, mouse.x - 1, mouse.y - 2);
    if (!hit) {
      return false;
    }
    if (hit.kind === "close") {
      state.overlay = "none";
      state.overlayCursor = 0;
    } else if (hit.kind === "search") {
      state.shortcutSearchMode = true;
    } else {
      state.overlayCursor = hit.index;
      const row = shortcutPanelRows(state)[hit.index];
      if (row?.kind === "header") {
        toggleShortcutCategory(state, row.category);
      }
    }
    return true;
  }

  if (state.overlay === "books" || state.overlay === "file-picker") {
    const isPicker = state.overlay === "file-picker";
    const hit = isPicker
      ? filePickerModalHitTest(state, layout.contentWidth, layout.bodyHeight, mouse.x - 1, mouse.y - 2)
      : libraryModalHitTest(state, layout.contentWidth, layout.bodyHeight, mouse.x - 1, mouse.y - 2);
    if (!hit) {
      return false;
    }
    if (hit.kind === "close") {
      state.overlay = "none";
      state.overlayCursor = 0;
      state.booksTagFilter = null;
      resetOverlaySearch(state);
    } else if (hit.kind === "search") {
      state.overlaySearchMode = true;
    } else if (isPicker) {
      state.filePickerCursor = hit.index;
    } else {
      state.overlayCursor = hit.index;
    }
    return true;
  }

  if (state.commandMode) {
    return false;
  }

  const footerRow = height - footerHeight(state, width);
  if (mouse.y !== footerRow) {
    return false;
  }
  const footer = stripAnsi(renderFooter(state, width)[0] ?? "");
  const token = "Ctrl+.:shortcuts";
  const tokenStart = footer.indexOf(token);
  if (tokenStart < 0 || mouse.x < tokenStart + 1 || mouse.x > tokenStart + token.length) {
    return false;
  }
  openShortcutHelp(state);
  return true;
}

function isHomeKey(chunk: string): boolean {
  return chunk === "\u001b[H" || chunk === "\u001b[1~" || chunk === "\u001bOH";
}

function isEndKey(chunk: string): boolean {
  return chunk === "\u001b[F" || chunk === "\u001b[4~" || chunk === "\u001bOF";
}

function interactiveOverlayLength(state: AppState): number {
  switch (state.overlay) {
    case "chapters":
      return state.currentBook?.chapters.length ?? 0;
    case "bookmarks":
      return state.currentBook ? state.storage.listBookmarks(state.currentBook.id).length : 0;
    case "notes":
      return state.currentBook ? state.storage.listNotes(state.currentBook.id).length : 0;
    case "colorschemes":
      return THEMES.length;
    case "themes":
      return APPEARANCE_THEMES.length;
    case "settings":
      return filteredSettingsItems(state).length;
    default:
      return 0;
  }
}

function exitTui(): never {
  process.stdin.setRawMode?.(false);
  process.stdout.write("\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1007l\x1b[<u\x1b[?25h\x1b[?1049l");
  process.exit(0);
}

function applyScrollbarPointer(state: AppState, mouse: ParsedMouseEvent): boolean {
  if (!state.currentBook || state.focusMode) {
    return false;
  }

  const layout = getViewportLayout(state, process.stdout.columns || 120, process.stdout.rows || 40);
  if (layout.bodyHeight <= 0) {
    return false;
  }

  const bodyTop = 2;
  const bodyBottom = bodyTop + layout.bodyHeight - 1;
  const scrollbarColumn = layout.mainWidth;
  if (mouse.x !== scrollbarColumn || mouse.y < bodyTop || mouse.y > bodyBottom) {
    if (mouse.kind === "release") {
      state.mouseDrag = null;
    }
    return false;
  }

  const chapterMaxOffset = computeChapterMaxOffset(state, layout.contentWidth, layout.bodyHeight);
  if (chapterMaxOffset === 0) {
    if (mouse.kind === "release") {
      state.mouseDrag = null;
    }
    return false;
  }

  const chapterLineCount = chapterMaxOffset + layout.bodyHeight;
  const row = mouse.y - bodyTop;
  const { thumbHeight, thumbOffset } = getScrollbarMetrics(chapterLineCount, layout.bodyHeight, state.blockOffset);

  if (mouse.kind === "release") {
    state.mouseDrag = null;
    return true;
  }

  if (mouse.kind === "press" && mouse.button === 0) {
    const insideThumb = row >= thumbOffset && row < thumbOffset + thumbHeight;
    if (insideThumb) {
      state.mouseDrag = {
        kind: "scrollbar",
        thumbGrabOffset: row - thumbOffset
      };
    } else {
      state.blockOffset = scrollbarOffsetFromThumb(chapterLineCount, layout.bodyHeight, row - Math.floor(thumbHeight / 2));
      state.mouseDrag = {
        kind: "scrollbar",
        thumbGrabOffset: Math.floor(thumbHeight / 2)
      };
    }
    return true;
  }

  if (mouse.kind === "drag" && mouse.button === 0 && state.mouseDrag?.kind === "scrollbar") {
    state.blockOffset = scrollbarOffsetFromThumb(
      chapterLineCount,
      layout.bodyHeight,
      row - state.mouseDrag.thumbGrabOffset
    );
    return true;
  }

  return false;
}

function enterFocusMode(state: AppState, contentWidth: number): void {
  state.focusBlockIndex = mapBlockOffsetToFocusIndex(state, contentWidth, state.blockOffset);
  state.focusMode = true;
  state.status = "Focus mode enabled";
}

function exitFocusMode(state: AppState, contentWidth: number): void {
  state.focusBlockIndex = clampFocusBlockIndex(state, state.focusBlockIndex);
  state.blockOffset = mapFocusIndexToBlockOffset(state, contentWidth, state.focusBlockIndex);
  state.focusMode = false;
  clearChapterTransition(state);
  state.status = "Focus mode disabled";
}

function currentCommandSuggestions(state: AppState) {
  const cursor = clamp(state.commandCursor ?? state.commandBuffer.length, 0, state.commandBuffer.length);
  return listCommandSuggestions(state.commandBuffer, state.storage, cursor);
}

export async function handleInput(
  chunk: string,
  state: AppState,
  redraw: () => void,
  executeCmd: (cmd: string) => Promise<void>,
  syncPos: (state: AppState) => void,
  confirmPicker: (paths: string[], force: boolean) => Promise<void>
): Promise<void> {
  const normalizedChunk = normalizeTerminalKey(chunk);
  if (normalizedChunk === null) {
    return;
  }
  chunk = normalizedChunk;
  if (chunk === "\u0003" || chunk === "\u0004") {
    state.shouldQuit = true;
  }
  if (state.shouldQuit) {
    exitTui();
  }

  const embeddedShortcut = [...CTRL_X_SEQUENCES, ...CTRL_DOT_SEQUENCES].find((sequence) => chunk !== sequence && chunk.includes(sequence));
  if (embeddedShortcut) {
    const index = chunk.indexOf(embeddedShortcut);
    const parts = [chunk.slice(0, index), embeddedShortcut, chunk.slice(index + embeddedShortcut.length)].filter(Boolean);
    for (const part of parts) {
      await handleInput(part, state, redraw, executeCmd, syncPos, confirmPicker);
    }
    return;
  }

  const bufferedNavigation = splitBufferedNavigationInput(chunk);
  if (bufferedNavigation) {
    for (const key of bufferedNavigation) {
      await handleInput(key, state, redraw, executeCmd, syncPos, confirmPicker);
    }
    return;
  }

  const mouseEvent = parseMouseEvent(chunk);
  if (mouseEvent && applyScrollbarPointer(state, mouseEvent)) {
    syncPos(state);
    redraw();
    return;
  }
  if (mouseEvent && applyUiPointer(state, mouseEvent)) {
    redraw();
    return;
  }

  if (isShortcutHelpKey(chunk) && (chunk !== "?" || !state.commandMode)) {
    if (state.overlay === "keys") {
      state.overlay = "none";
      state.overlayCursor = 0;
    } else {
      openShortcutHelp(state);
    }
    redraw();
    return;
  }

  if (state.commandMode) {
    if (chunk === "\r") {
      const suggestions = currentCommandSuggestions(state);
      if (suggestions.length > 0) {
        const suggestion = suggestions[clamp(state.commandSuggestionIndex, 0, suggestions.length - 1)];
        state.commandBuffer = applyCommandAutocomplete(state.commandBuffer, suggestion);
      }
      const raw = `/${state.commandBuffer}`;
      state.commandBuffer = "";
      state.commandCursor = 0;
      state.commandMode = false;
      state.commandSuggestionIndex = 0;
      await executeCmd(raw);
    } else if (chunk === "\u001b") {
      state.commandMode = false;
      state.commandSuggestionIndex = 0;
    } else if (chunk === "\u007f") {
      const cursor = Math.max(0, Math.min(state.commandCursor ?? state.commandBuffer.length, state.commandBuffer.length));
      if (cursor > 0) {
        state.commandBuffer = `${state.commandBuffer.slice(0, cursor - 1)}${state.commandBuffer.slice(cursor)}`;
        state.commandCursor = cursor - 1;
      }
      state.commandSuggestionIndex = 0;
    } else if (chunk === "\t") {
      const suggestions = currentCommandSuggestions(state);
      if (suggestions.length > 0) {
        const cursor = clamp(state.commandCursor ?? state.commandBuffer.length, 0, state.commandBuffer.length);
        const appliedIndex = commandAutocompleteIndex(state.commandBuffer.slice(0, cursor), state.commandSuggestionIndex, suggestions);
        const suggestion = suggestions[clamp(appliedIndex, 0, suggestions.length - 1)];
        state.commandBuffer = applyCommandAutocomplete(state.commandBuffer, suggestion);
        state.commandCursor = suggestion.completion !== undefined && suggestion.completionStart !== undefined
          ? suggestion.completionStart + suggestion.completion.length
          : state.commandBuffer.length;
        state.commandSuggestionIndex = appliedIndex;
      }
    } else if (isLeftKey(chunk)) {
      state.commandCursor = Math.max(0, (state.commandCursor ?? state.commandBuffer.length) - 1);
    } else if (isRightKey(chunk)) {
      state.commandCursor = Math.min(state.commandBuffer.length, (state.commandCursor ?? state.commandBuffer.length) + 1);
    } else if (isDownKey(chunk) || isMouseWheelDown(chunk)) {
      const suggestions = currentCommandSuggestions(state);
      if (suggestions.length > 0) {
        state.commandSuggestionIndex = clamp(state.commandSuggestionIndex + 1, 0, suggestions.length - 1);
      }
    } else if (isUpKey(chunk) || isMouseWheelUp(chunk)) {
      const suggestions = currentCommandSuggestions(state);
      if (suggestions.length > 0) {
        state.commandSuggestionIndex = clamp(state.commandSuggestionIndex - 1, 0, suggestions.length - 1);
      }
    } else if (isPageDownKey(chunk)) {
      const suggestions = currentCommandSuggestions(state);
      state.commandSuggestionIndex = clamp(state.commandSuggestionIndex + 7, 0, Math.max(0, suggestions.length - 1));
    } else if (isPageUpKey(chunk)) {
      state.commandSuggestionIndex = clamp(state.commandSuggestionIndex - 7, 0, Number.MAX_SAFE_INTEGER);
    } else {
      const cursor = Math.max(0, Math.min(state.commandCursor ?? state.commandBuffer.length, state.commandBuffer.length));
      state.commandBuffer = `${state.commandBuffer.slice(0, cursor)}${chunk}${state.commandBuffer.slice(cursor)}`;
      state.commandCursor = cursor + chunk.length;
      state.commandSuggestionIndex = 0;
    }
    redraw();
    return;
  }

  if (state.overlay === "settings") {
    const items = filteredSettingsItems(state);
    const maxIndex = Math.max(0, items.length - 1);
    state.overlayCursor = clamp(state.overlayCursor, 0, maxIndex);

    if (isRightKey(chunk) || (chunk === "l" && !state.settingsSearchMode)) {
      moveSettingsTab(state, 1);
    } else if (isLeftKey(chunk) || (chunk === "h" && !state.settingsSearchMode)) {
      moveSettingsTab(state, -1);
    } else if (chunk === "\u001b") {
      closeSettingsPanel(state);
      state.status = "Settings cancelled.";
    } else if (chunk === "\r") {
      applySettingsDraft(state);
    } else if (isDownKey(chunk) || chunk === "j") {
      state.overlayCursor = clamp(state.overlayCursor + 1, 0, maxIndex);
      state.settingsSearchMode = false;
    } else if (isUpKey(chunk) || chunk === "k") {
      state.overlayCursor = clamp(state.overlayCursor - 1, 0, maxIndex);
      state.settingsSearchMode = false;
    } else if (chunk === " ") {
      cycleSelectedSetting(state);
    } else if (chunk === "/") {
      state.settingsSearchMode = true;
      state.status = "Settings search.";
    } else if (chunk === "\u007f" && state.settingsSearchMode) {
      state.settingsSearchBuffer = (state.settingsSearchBuffer ?? "").slice(0, -1);
      state.overlayCursor = 0;
    } else if (state.settingsSearchMode && chunk.length === 1 && chunk >= " ") {
      state.settingsSearchBuffer = `${state.settingsSearchBuffer ?? ""}${chunk}`;
      state.overlayCursor = 0;
    }
    redraw();
    return;
  }

  if (state.overlay === "keys") {
    const rows = shortcutPanelRows(state);
    const maxIndex = Math.max(0, rows.length - 1);
    state.overlayCursor = clamp(state.overlayCursor, 0, maxIndex);
    const layout = getViewportLayout(state, process.stdout.columns || 120, process.stdout.rows || 40);
    const pageSize = shortcutModalGeometry(layout.contentWidth, layout.bodyHeight).visibleRows;

    if (state.shortcutSearchMode) {
      if (chunk === "\u001b") {
        state.shortcutSearchMode = false;
        state.shortcutSearchBuffer = "";
        state.overlayCursor = 0;
      } else if (chunk === "\r") {
        state.shortcutSearchMode = false;
      } else if (chunk === "\u007f") {
        state.shortcutSearchBuffer = (state.shortcutSearchBuffer ?? "").slice(0, -1);
        state.overlayCursor = 0;
      } else if (chunk.length === 1 && chunk >= " ") {
        state.shortcutSearchBuffer = `${state.shortcutSearchBuffer ?? ""}${chunk}`;
        state.overlayCursor = 0;
      }
    } else if (chunk === "\u001b") {
      state.overlay = "none";
      state.overlayCursor = 0;
    } else if (chunk === "/") {
      state.shortcutSearchMode = true;
    } else if (isDownKey(chunk) || chunk === "j" || isMouseWheelDown(chunk)) {
      state.overlayCursor = clamp(state.overlayCursor + 1, 0, maxIndex);
    } else if (isUpKey(chunk) || chunk === "k" || isMouseWheelUp(chunk)) {
      state.overlayCursor = clamp(state.overlayCursor - 1, 0, maxIndex);
    } else if (isPageDownKey(chunk)) {
      state.overlayCursor = clamp(state.overlayCursor + pageSize, 0, maxIndex);
    } else if (isPageUpKey(chunk)) {
      state.overlayCursor = clamp(state.overlayCursor - pageSize, 0, maxIndex);
    } else if (isHomeKey(chunk)) {
      state.overlayCursor = 0;
    } else if (isEndKey(chunk)) {
      state.overlayCursor = maxIndex;
    } else if (chunk === "\r" || chunk === " ") {
      const selected = rows[state.overlayCursor];
      if (selected?.kind === "header") {
        toggleShortcutCategory(state, selected.category);
      }
    }
    redraw();
    return;
  }

  if (state.overlay === "books") {
    const items = filteredLibraryItems(state);
    const maxIndex = Math.max(0, items.length - 1);
    state.overlayCursor = clamp(state.overlayCursor, 0, maxIndex);
    const layout = getViewportLayout(state, process.stdout.columns || 120, process.stdout.rows || 40);
    const pageSize = modalGeometry(layout.contentWidth, layout.bodyHeight).visibleRows;

    if (state.overlaySearchMode) {
      if (chunk === "\u001b") {
        state.overlaySearchMode = false;
        state.overlaySearchBuffer = "";
        state.overlayCursor = 0;
      } else if (chunk === "\r") {
        state.overlaySearchMode = false;
      } else if (chunk === "\u007f") {
        state.overlaySearchBuffer = (state.overlaySearchBuffer ?? "").slice(0, -1);
        state.overlayCursor = 0;
      } else if (chunk.length === 1 && chunk >= " ") {
        state.overlaySearchBuffer = `${state.overlaySearchBuffer ?? ""}${chunk}`;
        state.overlayCursor = 0;
      }
    } else if (chunk === "\u001b") {
      state.overlay = "none";
      state.overlayCursor = 0;
      state.booksTagFilter = null;
      resetOverlaySearch(state);
    } else if (chunk === "/") {
      state.overlaySearchMode = true;
    } else if (isDownKey(chunk) || chunk === "j" || isMouseWheelDown(chunk)) {
      state.overlayCursor = clamp(state.overlayCursor + 1, 0, maxIndex);
    } else if (isUpKey(chunk) || chunk === "k" || isMouseWheelUp(chunk)) {
      state.overlayCursor = clamp(state.overlayCursor - 1, 0, maxIndex);
    } else if (isPageDownKey(chunk)) {
      state.overlayCursor = clamp(state.overlayCursor + pageSize, 0, maxIndex);
    } else if (isPageUpKey(chunk)) {
      state.overlayCursor = clamp(state.overlayCursor - pageSize, 0, maxIndex);
    } else if (isHomeKey(chunk)) {
      state.overlayCursor = 0;
    } else if (isEndKey(chunk)) {
      state.overlayCursor = maxIndex;
    } else if (chunk === "\r") {
      const selected = items[state.overlayCursor];
      if (selected?.kind === "discovered") {
        state.overlay = "none";
        state.booksTagFilter = null;
        resetOverlaySearch(state);
        await confirmPicker([selected.discovery.path], false);
      } else if (selected) {
        const book = state.storage.getBook(selected.book.id);
        if (book) {
          state.currentBook = book;
          state.searchState = null;
          const existing = state.storage.getPosition(book.id);
          state.chapterIndex = existing?.chapterIndex ?? 0;
          state.blockOffset = existing?.blockOffset ?? 0;
          state.status = `Opened ${book.title}`;
        }
        state.overlay = "none";
        state.booksTagFilter = null;
        resetOverlaySearch(state);
      } else {
        state.overlay = "none";
        state.booksTagFilter = null;
        resetOverlaySearch(state);
      }
    } else if (chunk === "b" || chunk === "n") {
      const selected = items[state.overlayCursor];
      const book = selected?.kind === "stored" ? state.storage.getBook(selected.book.id) : null;
      if (book) {
        state.currentBook = book;
        state.searchState = null;
        const existing = state.storage.getPosition(book.id);
        state.chapterIndex = existing?.chapterIndex ?? 0;
        state.blockOffset = existing?.blockOffset ?? 0;
        state.overlay = chunk === "b" ? "bookmarks" : "notes";
        state.overlayCursor = 0;
        state.booksTagFilter = null;
        resetOverlaySearch(state);
        state.status = chunk === "b"
          ? `Opened bookmarks for ${book.title}.`
          : `Opened notes for ${book.title}.`;
      }
    } else if (chunk === "s") {
      const cycle: LibrarySortKey[] = ["lastOpened", "title", "author", "progress"];
      const current = cycle.indexOf(state.librarySortKey);
      state.librarySortKey = cycle[(current + 1) % cycle.length]!;
      state.overlayCursor = 0;
      state.status = `Library sort: ${state.librarySortKey}.`;
    } else if (chunk === "r") {
      state.librarySortDir = state.librarySortDir === "asc" ? "desc" : "asc";
      state.overlayCursor = 0;
      state.status = `Library sort direction: ${state.librarySortDir}.`;
    }
    redraw();
    return;
  }

  if (state.overlay === "file-picker") {
    const items = filteredPickerItems(state);
    const maxIndex = Math.max(0, items.length - 1);
    state.filePickerCursor = clamp(state.filePickerCursor, 0, maxIndex);
    const layout = getViewportLayout(state, process.stdout.columns || 120, process.stdout.rows || 40);
    const pageSize = modalGeometry(layout.contentWidth, layout.bodyHeight).visibleRows;

    if (state.overlaySearchMode) {
      if (chunk === "\u001b") {
        state.overlaySearchMode = false;
        state.overlaySearchBuffer = "";
        state.filePickerCursor = 0;
      } else if (chunk === "\r") {
        state.overlaySearchMode = false;
      } else if (chunk === "\u007f") {
        state.overlaySearchBuffer = (state.overlaySearchBuffer ?? "").slice(0, -1);
        state.filePickerCursor = 0;
      } else if (chunk.length === 1 && chunk >= " ") {
        state.overlaySearchBuffer = `${state.overlaySearchBuffer ?? ""}${chunk}`;
        state.filePickerCursor = 0;
      }
    } else if (chunk === "\u001b") {
      state.overlay = "none";
      resetOverlaySearch(state);
    } else if (chunk === "/") {
      state.overlaySearchMode = true;
    } else if (isDownKey(chunk) || isRightKey(chunk) || chunk === "j" || isMouseWheelDown(chunk)) {
      state.filePickerCursor = clamp(state.filePickerCursor + 1, 0, maxIndex);
    } else if (isUpKey(chunk) || isLeftKey(chunk) || chunk === "k" || isMouseWheelUp(chunk)) {
      state.filePickerCursor = clamp(state.filePickerCursor - 1, 0, maxIndex);
    } else if (isPageDownKey(chunk)) {
      state.filePickerCursor = clamp(state.filePickerCursor + pageSize, 0, maxIndex);
    } else if (isPageUpKey(chunk)) {
      state.filePickerCursor = clamp(state.filePickerCursor - pageSize, 0, maxIndex);
    } else if (isHomeKey(chunk)) {
      state.filePickerCursor = 0;
    } else if (isEndKey(chunk)) {
      state.filePickerCursor = maxIndex;
    } else if (chunk === " ") {
      const entry = items[state.filePickerCursor];
      if (entry) {
        if (state.filePickerSelected.has(entry.index)) {
          state.filePickerSelected.delete(entry.index);
        } else {
          state.filePickerSelected.add(entry.index);
        }
      }
    } else if (chunk === "\r") {
      if (items.length > 0) {
        const selectedIndexes = state.filePickerSelected.size > 0
          ? Array.from(state.filePickerSelected).sort((a, b) => a - b)
          : [items[state.filePickerCursor]!.index];
        const paths = selectedIndexes
          .map((index) => state.filePickerItems[index]?.path)
          .filter((value): value is string => Boolean(value));
        state.overlay = "none";
        resetOverlaySearch(state);
        await confirmPicker(paths, state.filePickerForce);
      } else {
        state.overlay = "none";
        resetOverlaySearch(state);
      }
    }
    redraw();
    return;
  }

  if (chunk === "/") {
    // Command entry is not active reading. Break the current timing window so
    // time spent typing (including navigation commands) cannot enter a sample.
    state.readingPace.lastSampleAt = null;
    state.commandMode = true;
    state.commandBuffer = "";
    state.commandCursor = 0;
    state.commandSuggestionIndex = 0;
    redraw();
    return;
  }

  const overlayLength = interactiveOverlayLength(state);
  if (overlayLength > 0) {
    state.mouseDrag = null;
    const maxIndex = Math.max(0, overlayLength - 1);
    if (isDownKey(chunk) || chunk === "j") {
      state.overlayCursor = clamp(state.overlayCursor + 1, 0, maxIndex);
    } else if (isUpKey(chunk) || chunk === "k") {
      state.overlayCursor = clamp(state.overlayCursor - 1, 0, maxIndex);
    } else if (chunk === "\r") {
      if (state.overlay === "chapters" && state.currentBook) {
        pushNavHistory(state);
        state.chapterIndex = clamp(state.overlayCursor, 0, state.currentBook.chapters.length - 1);
        state.blockOffset = 0;
        pushNavHistory(state);
        state.status = `Moved to chapter ${state.chapterIndex + 1}`;
      } else if (state.overlay === "colorschemes") {
        const colorScheme = THEMES[state.overlayCursor];
        if (colorScheme) {
          state.colorScheme = colorScheme;
          state.theme = applyAppearanceTheme(state.colorScheme, state.appearanceTheme);
          state.storage.setSetting("themeId", colorScheme.id);
          state.status = `Colorscheme set to ${colorScheme.label}`;
        }
      } else if (state.overlay === "themes") {
        const appearanceTheme = APPEARANCE_THEMES[state.overlayCursor];
        if (appearanceTheme) {
          state.appearanceTheme = appearanceTheme;
          state.theme = applyAppearanceTheme(state.colorScheme, state.appearanceTheme);
          state.storage.setSetting("appearanceThemeId", appearanceTheme.id);
          state.status = `Theme set to ${appearanceTheme.label}`;
        }
      } else if (state.overlay === "bookmarks" && state.currentBook) {
        const bookmarks = state.storage.listBookmarks(state.currentBook.id);
        const selected = bookmarks[state.overlayCursor];
        if (selected) {
          pushNavHistory(state);
          state.chapterIndex = selected.chapterIndex;
          state.blockOffset = selected.blockOffset;
          pushNavHistory(state);
          state.status = selected.label
            ? `Jumped to bookmark "${selected.label}".`
            : `Jumped to bookmark Ch.${selected.chapterIndex + 1} §${selected.blockOffset}.`;
        }
      } else if (state.overlay === "notes" && state.currentBook) {
        const notes = state.storage.listNotes(state.currentBook.id);
        const selected = notes[state.overlayCursor];
        if (selected && selected.chapterIndex !== null) {
          pushNavHistory(state);
          state.chapterIndex = selected.chapterIndex;
          state.blockOffset = selected.blockOffset ?? 0;
          pushNavHistory(state);
          state.status = `Jumped to note at Ch.${selected.chapterIndex + 1} §${selected.blockOffset ?? 0}.`;
        }
      }
      state.overlay = "none";
      state.booksTagFilter = null;
    } else if (chunk === "\u001b") {
      state.overlay = "none";
      state.booksTagFilter = null;
    } else if (chunk === "d" && state.overlay === "bookmarks" && state.currentBook) {
      const bookmarks = state.storage.listBookmarks(state.currentBook.id);
      const selected = bookmarks[state.overlayCursor];
      if (selected) {
        state.storage.deleteBookmark(selected.id);
        const remaining = state.storage.listBookmarks(state.currentBook.id).length;
        if (remaining === 0) {
          state.overlay = "none";
          state.overlayCursor = 0;
          state.status = "Bookmark deleted. No bookmarks remaining.";
        } else {
          state.overlayCursor = clamp(state.overlayCursor, 0, remaining - 1);
          state.status = "Bookmark deleted.";
        }
      }
    } else if (chunk === "d" && state.overlay === "notes" && state.currentBook) {
      const notes = state.storage.listNotes(state.currentBook.id);
      const selected = notes[state.overlayCursor];
      if (selected) {
        state.storage.deleteNote(selected.id);
        const remaining = state.storage.listNotes(state.currentBook.id).length;
        if (remaining === 0) {
          state.overlay = "none";
          state.overlayCursor = 0;
          state.status = "Note deleted. No notes remaining.";
        } else {
          state.overlayCursor = clamp(state.overlayCursor, 0, remaining - 1);
          state.status = "Note deleted.";
        }
      }
    }
    redraw();
    return;
  }

  if (chunk === "\u001b") {
    if (state.overlay !== "none") {
      state.overlay = "none";
      state.helpCommand = null;
      state.overlayCursor = 0;
      state.booksTagFilter = null;
      redraw();
      return;
    }
    state.mouseDrag = null;
    state.overlay = "none";
    state.searchState = null;
    if (state.focusMode && state.currentBook) {
      const escLayout = getViewportLayout(state, process.stdout.columns || 120, process.stdout.rows || 40);
      exitFocusMode(state, escLayout.contentWidth);
    }
    redraw();
    return;
  }

  if (chunk === "[") {
    if (state.navHistoryCursor <= 0) {
      state.status = "No history to go back";
    } else {
      state.navHistoryCursor -= 1;
      const target = state.navHistory[state.navHistoryCursor];
      if (target) {
        state.chapterIndex = target.chapterIndex;
        state.blockOffset = target.blockOffset;
      }
    }
    syncPos(state);
    redraw();
    return;
  }

  if (chunk === "]") {
    if (state.navHistoryCursor >= state.navHistory.length - 1) {
      state.status = "No history to go forward";
    } else {
      state.navHistoryCursor += 1;
      const target = state.navHistory[state.navHistoryCursor];
      if (target) {
        state.chapterIndex = target.chapterIndex;
        state.blockOffset = target.blockOffset;
      }
    }
    syncPos(state);
    redraw();
    return;
  }

  if (chunk === "\r" && !state.currentBook && state.discoveries.length > 0) {
    await executeCmd("/add");
    redraw();
    return;
  }

  // Navigation
  const layout = getViewportLayout(state, process.stdout.columns || 120, process.stdout.rows || 40);
  const pageSize = Math.max(MIN_PAGE_LINES, layout.bodyHeight);
  const chapterMaxOffset = computeChapterMaxOffset(state, layout.contentWidth, layout.bodyHeight);

  if (chunk === "S") {
    openSettingsPanel(state);
    redraw();
    return;
  }

  if (state.overlay === "help") {
    const lines = commandHelp(state.helpCommand ?? undefined, layout.contentWidth);
    const maxOffset = Math.max(0, lines.length - layout.bodyHeight);
    if (chunk === "j" || isDownKey(chunk) || isMouseWheelDown(chunk)) {
      state.overlayCursor = clamp(state.overlayCursor + 1, 0, maxOffset);
    } else if (chunk === "k" || isUpKey(chunk) || isMouseWheelUp(chunk)) {
      state.overlayCursor = clamp(state.overlayCursor - 1, 0, maxOffset);
    } else if (chunk === " " || isPageDownKey(chunk)) {
      state.overlayCursor = clamp(state.overlayCursor + pageSize, 0, maxOffset);
    } else if (chunk === "b" || isPageUpKey(chunk)) {
      state.overlayCursor = clamp(state.overlayCursor - pageSize, 0, maxOffset);
    } else if (chunk === "g" || isHomeKey(chunk)) {
      state.overlayCursor = 0;
    } else if (chunk === "G" || isEndKey(chunk)) {
      state.overlayCursor = maxOffset;
    } else if (chunk === "\u001b") {
      state.overlay = "none";
      state.helpCommand = null;
      state.overlayCursor = 0;
    } else if (chunk === "q") {
      state.shouldQuit = true;
      exitTui();
    }
    redraw();
    return;
  }

  if (state.searchState && state.currentBook && (chunk === "n" || chunk === "N")) {
    const { results, cursor } = state.searchState;
    if (results.length > 0) {
      const next = chunk === "n"
        ? (cursor + 1) % results.length
        : (cursor - 1 + results.length) % results.length;
      state.searchState = { ...state.searchState, cursor: next };
      applySearchHit(state, results[next]!);
    }
    syncPos(state);
    redraw();
    return;
  }
  if (chunk === "f") {
    if (!state.currentBook) {
      state.status = "No book open.";
    } else if (state.focusMode) {
      exitFocusMode(state, layout.contentWidth);
    } else {
      enterFocusMode(state, layout.contentWidth);
    }
    syncPos(state);
    redraw();
    return;
  }

  if (state.focusMode && state.currentBook) {
    const blockCount = getChapterBlockCount(state);
    if (blockCount <= 0) {
      state.status = "This chapter has no readable blocks.";
      syncPos(state);
      redraw();
      return;
    }

    const atFocusEnd = state.focusBlockIndex >= blockCount - 1;
    const focusForwardIntent =
      chunk === "k"
      || chunk === " "
      || isDownKey(chunk)
      || isPageDownKey(chunk)
      || isMouseWheelDown(chunk);

    if (atFocusEnd && focusForwardIntent) {
      const nextChapter = state.currentBook.chapters[state.chapterIndex + 1];
      if (!nextChapter) {
        state.status = "End of book";
        redraw();
        return;
      }
      const requiredStage = isMouseWheelDown(chunk) ? 4 : 3;
      if (!state.chapterTransition || state.chapterTransition.targetChapterIndex !== nextChapter.index) {
        showChapterTransition(state, redraw, syncPos, `Chapter ${nextChapter.index + 1}: ${nextChapter.title}`, nextChapter.index, requiredStage);
        return;
      }
      showChapterTransition(state, redraw, syncPos, state.chapterTransition.message, state.chapterTransition.targetChapterIndex, requiredStage);
      return;
    }

    clearChapterTransition(state);
    if (focusForwardIntent) {
      state.focusBlockIndex = clampFocusBlockIndex(state, state.focusBlockIndex + 1);
    } else if (chunk === "j" || isUpKey(chunk) || isMouseWheelUp(chunk)) {
      state.focusBlockIndex = clampFocusBlockIndex(state, state.focusBlockIndex - 1);
    } else if (chunk === "g" || isHomeKey(chunk)) {
      state.focusBlockIndex = 0;
    } else if (chunk === "G" || isEndKey(chunk)) {
      state.focusBlockIndex = blockCount - 1;
    } else if (isRightKey(chunk)) {
      moveChapter(state, 1);
    } else if (isLeftKey(chunk)) {
      moveChapter(state, -1);
    } else if (chunk === "T") {
      state.overlay = "chapters";
      state.overlayCursor = state.chapterIndex;
    } else if (chunk === "B") {
      const bookmarks = state.storage.listBookmarks(state.currentBook.id);
      state.overlay = "bookmarks";
      state.overlayCursor = 0;
      state.status = bookmarks.length > 0 ? "Opened bookmarks." : "No bookmarks in this book yet.";
    } else if (chunk === "m") {
      const nextMode = state.renderMode === "plain" ? "typescript"
        : state.codeLanguage === "typescript" ? "python"
        : state.codeLanguage === "python" ? "rust"
        : "plain";
      await executeCmd(`/mode ${nextMode}`);
    } else if (chunk === "d" && state.renderMode === "code") {
      const cycle = [1, 3, 5] as const;
      const current = cycle.indexOf(state.codeDensity as 1 | 3 | 5);
      const next = cycle[current < 0 ? 0 : (current + 1) % cycle.length];
      await executeCmd(`/density ${next}`);
    } else if (chunk === "c") {
      await executeCmd("/colorscheme");
    } else if (chunk === "C") {
      await executeCmd("/theme");
    } else if (chunk === "p") {
      await executeCmd("/toggleprogress");
    } else if (chunk === "q") {
      state.shouldQuit = true;
      exitTui();
    }
    syncPos(state);
    redraw();
    return;
  }

  const atChapterEnd = state.currentBook && state.blockOffset >= chapterMaxOffset;
  const cancelChapterTransition = () => {
    if (state.chapterTransition) {
      clearChapterTransition(state);
    }
  };
  const isForwardScrollIntent =
    chunk === "k"
    || isDownKey(chunk)
    || isMouseWheelDown(chunk);

  if (state.currentBook && atChapterEnd && isForwardScrollIntent) {
    const nextChapter = state.currentBook.chapters[state.chapterIndex + 1];
    if (!nextChapter) {
      state.status = "End of book";
      redraw();
      return;
    }

    const requiredStage = isMouseWheelDown(chunk) ? 4 : 3;
    if (!state.chapterTransition || state.chapterTransition.targetChapterIndex !== nextChapter.index) {
      showChapterTransition(state, redraw, syncPos, `Chapter ${nextChapter.index + 1}: ${nextChapter.title}`, nextChapter.index, requiredStage);
      return;
    }

    showChapterTransition(state, redraw, syncPos, state.chapterTransition.message, state.chapterTransition.targetChapterIndex, requiredStage);
    return;
  } else if (chunk === "k" || isDownKey(chunk) || isMouseWheelDown(chunk)) {
    cancelChapterTransition();
    state.blockOffset += 1;
  } else if (chunk === "j" || isUpKey(chunk) || isMouseWheelUp(chunk)) {
    cancelChapterTransition();
    state.blockOffset = clamp(state.blockOffset - 1, 0, Infinity);
  } else if (chunk === " " || isPageDownKey(chunk)) {
    cancelChapterTransition();
    state.blockOffset += pageSize;
  } else if (chunk === "b" || isPageUpKey(chunk)) {
    cancelChapterTransition();
    state.blockOffset = clamp(state.blockOffset - pageSize, 0, Infinity);
  } else if (chunk === "g") {
    cancelChapterTransition();
    state.blockOffset = 0;
  } else if (chunk === "G") {
    cancelChapterTransition();
    state.blockOffset += pageSize * 100;
  } else if (isHomeKey(chunk)) {
    cancelChapterTransition();
    state.blockOffset = 0;
  } else if (isEndKey(chunk)) {
    cancelChapterTransition();
    state.blockOffset = computeChapterMaxOffset(state, layout.contentWidth, layout.bodyHeight);
  } else if (isRightKey(chunk)) {
    cancelChapterTransition();
    moveChapter(state, 1);
  } else if (isLeftKey(chunk)) {
    cancelChapterTransition();
    moveChapter(state, -1);
  } else if (chunk === "T") {
    cancelChapterTransition();
    state.overlay = "chapters";
    state.overlayCursor = state.chapterIndex;
  } else if (chunk === "B") {
    cancelChapterTransition();
    if (!state.currentBook) {
      state.status = "No book open.";
    } else {
      const bookmarks = state.storage.listBookmarks(state.currentBook.id);
      state.overlay = "bookmarks";
      state.overlayCursor = 0;
      state.status = bookmarks.length > 0 ? "Opened bookmarks." : "No bookmarks in this book yet.";
    }
  } else if (chunk === "m") {
    const nextMode = state.renderMode === "plain" ? "typescript"
      : state.codeLanguage === "typescript" ? "python"
      : state.codeLanguage === "python" ? "rust"
      : "plain";
    await executeCmd(`/mode ${nextMode}`);
  } else if (chunk === "d" && state.renderMode === "code") {
    const cycle = [1, 3, 5] as const;
    const current = cycle.indexOf(state.codeDensity as 1 | 3 | 5);
    const next = cycle[current < 0 ? 0 : (current + 1) % cycle.length];
    await executeCmd(`/density ${next}`);
  } else if (chunk === "c") {
    await executeCmd("/colorscheme");
  } else if (chunk === "C") {
    await executeCmd("/theme");
  } else if (chunk === "p") {
    await executeCmd("/toggleprogress");
  } else if (chunk === "q") {
    state.shouldQuit = true;
    exitTui();
  }
  if (state.chapterTransition && state.currentBook && atChapterEnd && isForwardScrollIntent) {
    const nextChapter = state.currentBook.chapters[state.chapterTransition.targetChapterIndex];
    if (nextChapter && state.chapterTransition.stage < 4 && state.chapterTransition.targetChapterIndex === state.chapterIndex + 1) {
      showChapterTransition(
        state,
        redraw,
        syncPos,
        `Chapter ${nextChapter.index + 1}: ${nextChapter.title}`,
        nextChapter.index,
        isMouseWheelDown(chunk) ? 4 : 3
      );
      return;
    }
  }
  syncPos(state);
  redraw();
}

export function normalizeTerminalKey(chunk: string): string | null {
  const kittyArrowMatch = chunk.match(/^\x1b\[1;\d+(?::(\d+))?([ABCD])$/);
  if (kittyArrowMatch) {
    const eventType = Number(kittyArrowMatch[1] ?? 1);
    return eventType === 3 ? null : `\u001b[${kittyArrowMatch[2]}`;
  }

  const kittyMatch = chunk.match(/^\x1b\[([\d:]+)(?:;(\d+)(?::(\d+))?)?(?:;[\d:]*)?u$/);
  if (!kittyMatch) {
    return chunk;
  }

  const keyCodes = kittyMatch[1]!
    .split(":")
    .filter(Boolean)
    .map(Number);
  const modifiers = Number(kittyMatch[2] ?? 1);
  const eventType = Number(kittyMatch[3] ?? 1);
  if (eventType === 3) {
    return null;
  }
  const modifierBits = Math.max(0, modifiers - 1);
  const nonLockModifierBits = modifierBits & 0b11_1111;
  if (keyCodes.includes(27) && nonLockModifierBits === 0) {
    return "\u001b";
  }
  if ((modifierBits & 0b100) === 0) {
    return chunk;
  }

  if (keyCodes.includes(46)) {
    return CTRL_DOT_SEQUENCES[0];
  }
  if (keyCodes.includes(99)) {
    return "\u0003";
  }
  if (keyCodes.includes(100)) {
    return "\u0004";
  }
  if (keyCodes.includes(120)) {
    return CTRL_X_SEQUENCES[0];
  }
  return chunk;
}
