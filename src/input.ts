import { applyCommandAutocomplete, listCommandSuggestions } from "./commands.js";
import { applySearchHit, pushNavHistory } from "./executor.js";
import {
  clamp,
  computeChapterMaxOffset,
  getScrollbarMetrics,
  getViewportLayout,
  MIN_PAGE_LINES,
  scrollbarOffsetFromThumb
} from "./screen.js";
import { THEMES } from "./themes.js";
import type { AppState } from "./types.js";

function moveChapter(state: AppState, delta: number): void {
  if (!state.currentBook) {
    return;
  }
  pushNavHistory(state);
  state.chapterIndex = clamp(state.chapterIndex + delta, 0, state.currentBook.chapters.length - 1);
  state.blockOffset = 0;
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
  targetChapterIndex: number
): void {
  const previousStage = state.chapterTransition?.targetChapterIndex === targetChapterIndex
    ? state.chapterTransition.stage
    : 0;
  const stage = Math.min(3, previousStage + 1);
  if (stage === 3) {
    pushNavHistory(state);
    state.chapterIndex = targetChapterIndex;
    state.blockOffset = 0;
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
  state.status = stage === 1
    ? `Scroll again for ${message}`
    : `One more scroll to confirm ${message}`;
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

type MouseEventKind = "press" | "release" | "drag";

interface ParsedMouseEvent {
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
    button: code & 3,
    x,
    y,
    kind
  };
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
    case "books":
      return state.storage.listBooks().length;
    case "themes":
      return THEMES.length;
    default:
      return 0;
  }
}

function exitTui(): never {
  process.stdin.setRawMode?.(false);
  process.stdout.write("\x1b[?1000l\x1b[?1006l\x1b[?25h\x1b[?1049l");
  process.exit(0);
}

function applyScrollbarPointer(state: AppState, mouse: ParsedMouseEvent): boolean {
  if (!state.currentBook) {
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

export async function handleInput(
  chunk: string,
  state: AppState,
  redraw: () => void,
  executeCmd: (cmd: string) => Promise<void>,
  syncPos: (state: AppState) => void,
  confirmPicker: (paths: string[], force: boolean) => Promise<void>
): Promise<void> {
  if (chunk === "\u0003") {
    state.shouldQuit = true;
  }
  if (state.shouldQuit) {
    exitTui();
  }

  const mouseEvent = parseMouseEvent(chunk);
  if (mouseEvent && applyScrollbarPointer(state, mouseEvent)) {
    syncPos(state);
    redraw();
    return;
  }

  if (state.commandMode) {
    if (chunk === "\r") {
      const suggestions = listCommandSuggestions(state.commandBuffer);
      if (suggestions.length > 0) {
        const suggestion = suggestions[clamp(state.commandSuggestionIndex, 0, suggestions.length - 1)];
        state.commandBuffer = applyCommandAutocomplete(state.commandBuffer, suggestion);
      }
      const raw = `/${state.commandBuffer}`;
      state.commandBuffer = "";
      state.commandMode = false;
      state.commandSuggestionIndex = 0;
      await executeCmd(raw);
    } else if (chunk === "\u001b") {
      state.commandMode = false;
      state.commandSuggestionIndex = 0;
    } else if (chunk === "\u007f") {
      state.commandBuffer = state.commandBuffer.slice(0, -1);
      state.commandSuggestionIndex = 0;
    } else if (chunk === "\t") {
      const suggestions = listCommandSuggestions(state.commandBuffer);
      if (suggestions.length > 0) {
        const nextIndex = state.commandSuggestionIndex >= suggestions.length - 1
          ? 0
          : state.commandSuggestionIndex + 1;
        const appliedIndex = state.commandBuffer.trim().length === 0
          ? state.commandSuggestionIndex
          : nextIndex;
        const suggestion = suggestions[clamp(appliedIndex, 0, suggestions.length - 1)];
        state.commandBuffer = applyCommandAutocomplete(state.commandBuffer, suggestion);
        state.commandSuggestionIndex = appliedIndex;
      }
    } else if (chunk === "\u001b[B") {
      const suggestions = listCommandSuggestions(state.commandBuffer);
      if (suggestions.length > 0) {
        state.commandSuggestionIndex = clamp(state.commandSuggestionIndex + 1, 0, suggestions.length - 1);
      }
    } else if (chunk === "\u001b[A") {
      const suggestions = listCommandSuggestions(state.commandBuffer);
      if (suggestions.length > 0) {
        state.commandSuggestionIndex = clamp(state.commandSuggestionIndex - 1, 0, suggestions.length - 1);
      }
    } else {
      state.commandBuffer += chunk;
      state.commandSuggestionIndex = 0;
    }
    redraw();
    return;
  }

  if (chunk === "/") {
    state.commandMode = true;
    state.commandBuffer = "";
    state.commandSuggestionIndex = 0;
    redraw();
    return;
  }

  const pickerItems = state.filePickerItems;
  if (state.overlay === "file-picker") {
    const maxIndex = Math.max(0, pickerItems.length - 1);
    if (chunk === "\u001b[B" || chunk === "j") {
      state.filePickerCursor = clamp(state.filePickerCursor + 1, 0, maxIndex);
    } else if (chunk === "\u001b[A" || chunk === "k") {
      state.filePickerCursor = clamp(state.filePickerCursor - 1, 0, maxIndex);
    } else if (chunk === " ") {
      if (pickerItems.length > 0) {
        if (state.filePickerSelected.has(state.filePickerCursor)) {
          state.filePickerSelected.delete(state.filePickerCursor);
        } else {
          state.filePickerSelected.add(state.filePickerCursor);
        }
      }
    } else if (chunk === "\r") {
      if (pickerItems.length > 0) {
        const selectedIndexes = state.filePickerSelected.size > 0
          ? Array.from(state.filePickerSelected).sort((a, b) => a - b)
          : [state.filePickerCursor];
        const paths = selectedIndexes
          .map((index) => pickerItems[index]?.path)
          .filter((value): value is string => Boolean(value));
        state.overlay = "none";
        await confirmPicker(paths, state.filePickerForce);
      } else {
        state.overlay = "none";
      }
    } else if (chunk === "\u001b") {
      state.overlay = "none";
    }
    redraw();
    return;
  }

  const overlayLength = interactiveOverlayLength(state);
  if (overlayLength > 0) {
    state.mouseDrag = null;
    const maxIndex = Math.max(0, overlayLength - 1);
    if (chunk === "\u001b[B" || chunk === "j") {
      state.overlayCursor = clamp(state.overlayCursor + 1, 0, maxIndex);
    } else if (chunk === "\u001b[A" || chunk === "k") {
      state.overlayCursor = clamp(state.overlayCursor - 1, 0, maxIndex);
    } else if (chunk === "\r") {
      if (state.overlay === "chapters" && state.currentBook) {
        pushNavHistory(state);
        state.chapterIndex = clamp(state.overlayCursor, 0, state.currentBook.chapters.length - 1);
        state.blockOffset = 0;
        pushNavHistory(state);
        state.status = `Moved to chapter ${state.chapterIndex + 1}`;
      } else if (state.overlay === "books") {
        const books = state.storage.listBooks();
        const selected = books[state.overlayCursor];
        if (selected) {
          const book = state.storage.getBook(selected.id);
          if (book) {
            state.currentBook = book;
            state.searchState = null;
            const existing = state.storage.getPosition(book.id);
            state.chapterIndex = existing?.chapterIndex ?? 0;
            state.blockOffset = existing?.blockOffset ?? 0;
            state.status = `Opened ${book.title}`;
          }
        }
      } else if (state.overlay === "themes") {
        const theme = THEMES[state.overlayCursor];
        if (theme) {
          state.theme = theme;
          state.storage.setSetting("themeId", theme.id);
          state.status = `Theme set to ${theme.label}`;
        }
      }
      state.overlay = "none";
    } else if (chunk === "\u001b") {
      state.overlay = "none";
    }
    redraw();
    return;
  }

  if (chunk === "\u001b") {
    state.mouseDrag = null;
    state.overlay = "none";
    state.searchState = null;
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
  const atChapterEnd = state.currentBook && state.blockOffset >= chapterMaxOffset;
  const cancelChapterTransition = () => {
    if (state.chapterTransition) {
      clearChapterTransition(state);
    }
  };
  const isForwardScrollIntent =
    chunk === "j"
    || chunk === "\u001b[B"
    || isMouseWheelDown(chunk);

  if (state.currentBook && atChapterEnd && isForwardScrollIntent) {
    const nextChapter = state.currentBook.chapters[state.chapterIndex + 1];
    if (!nextChapter) {
      state.status = "End of book";
      redraw();
      return;
    }

    if (!state.chapterTransition || state.chapterTransition.targetChapterIndex !== nextChapter.index) {
      showChapterTransition(state, redraw, syncPos, `Chapter ${nextChapter.index + 1}: ${nextChapter.title}`, nextChapter.index);
      return;
    }

    showChapterTransition(state, redraw, syncPos, state.chapterTransition.message, state.chapterTransition.targetChapterIndex);
    return;
  } else if (chunk === "j" || chunk === "\u001b[B" || isMouseWheelDown(chunk)) {
    cancelChapterTransition();
    state.blockOffset += 1;
  } else if (chunk === "k" || chunk === "\u001b[A" || isMouseWheelUp(chunk)) {
    cancelChapterTransition();
    state.blockOffset = clamp(state.blockOffset - 1, 0, Infinity);
  } else if (chunk === " " || chunk === "\u001b[6~") {
    cancelChapterTransition();
    state.blockOffset += pageSize;
  } else if (chunk === "b" || chunk === "\u001b[5~") {
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
  } else if (chunk === "\u001b[C") {
    cancelChapterTransition();
    moveChapter(state, 1);
  } else if (chunk === "\u001b[D") {
    cancelChapterTransition();
    moveChapter(state, -1);
  } else if (chunk === "T") {
    cancelChapterTransition();
    state.overlay = "chapters";
    state.overlayCursor = state.chapterIndex;
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
  } else if (chunk === "p") {
    await executeCmd("/toggleprogress");
  } else if (chunk === "?") {
    state.overlay = "keys";
  } else if (chunk === "q") {
    state.shouldQuit = true;
    exitTui();
  }
  if (state.chapterTransition && state.currentBook && atChapterEnd && isForwardScrollIntent) {
    const nextChapter = state.currentBook.chapters[state.chapterTransition.targetChapterIndex];
    if (nextChapter && state.chapterTransition.stage < 3 && state.chapterTransition.targetChapterIndex === state.chapterIndex + 1) {
      showChapterTransition(
        state,
        redraw,
        syncPos,
        `Chapter ${nextChapter.index + 1}: ${nextChapter.title}`,
        nextChapter.index
      );
      return;
    }
  }
  syncPos(state);
  redraw();
}
