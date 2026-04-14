import { applyCommandAutocomplete, listCommandSuggestions } from "./commands.js";
import { clearScreen, clamp, MIN_PAGE_LINES } from "./screen.js";
import { THEMES } from "./themes.js";
import type { AppState } from "./types.js";

function moveChapter(state: AppState, delta: number): void {
  if (!state.currentBook) {
    return;
  }
  state.chapterIndex = clamp(state.chapterIndex + delta, 0, state.currentBook.chapters.length - 1);
  state.blockOffset = 0;
}

function isMouseWheelDown(chunk: string): boolean {
  return /\x1b\[<65;\d+;\d+[mM]/.test(chunk);
}

function isMouseWheelUp(chunk: string): boolean {
  return /\x1b\[<64;\d+;\d+[mM]/.test(chunk);
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
    process.stdin.setRawMode?.(false);
    process.stdout.write("\x1b[?1000l\x1b[?1006l");
    clearScreen();
    process.exit(0);
  }

  if (state.commandMode) {
    if (chunk === "\r") {
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
    const maxIndex = Math.max(0, overlayLength - 1);
    if (chunk === "\u001b[B" || chunk === "j") {
      state.overlayCursor = clamp(state.overlayCursor + 1, 0, maxIndex);
    } else if (chunk === "\u001b[A" || chunk === "k") {
      state.overlayCursor = clamp(state.overlayCursor - 1, 0, maxIndex);
    } else if (chunk === "\r") {
      if (state.overlay === "chapters" && state.currentBook) {
        state.chapterIndex = clamp(state.overlayCursor, 0, state.currentBook.chapters.length - 1);
        state.blockOffset = 0;
        state.status = `Moved to chapter ${state.chapterIndex + 1}`;
      } else if (state.overlay === "books") {
        const books = state.storage.listBooks();
        const selected = books[state.overlayCursor];
        if (selected) {
          const book = state.storage.getBook(selected.id);
          if (book) {
            state.currentBook = book;
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
    state.overlay = "none";
    redraw();
    return;
  }

  if (chunk === "\r" && !state.currentBook && state.discoveries.length > 0) {
    await executeCmd("/add");
    redraw();
    return;
  }

  // Navigation
  const pageSize = Math.max(MIN_PAGE_LINES, (process.stdout.rows || 40) - 8);
  if (chunk === "j" || chunk === "\u001b[B" || isMouseWheelDown(chunk)) {
    state.blockOffset += 1;
  } else if (chunk === "k" || chunk === "\u001b[A" || isMouseWheelUp(chunk)) {
    state.blockOffset = clamp(state.blockOffset - 1, 0, Infinity);
  } else if (chunk === " " || chunk === "\u001b[6~") {
    state.blockOffset += pageSize;
  } else if (chunk === "b" || chunk === "\u001b[5~") {
    state.blockOffset = clamp(state.blockOffset - pageSize, 0, Infinity);
  } else if (chunk === "g") {
    state.blockOffset = 0;
  } else if (chunk === "G") {
    state.blockOffset += pageSize * 100;
  } else if (chunk === "\u001b[C") {
    moveChapter(state, 1);
  } else if (chunk === "\u001b[D") {
    moveChapter(state, -1);
  } else if (chunk === "?") {
    state.overlay = "keys";
  } else if (chunk === "q") {
    state.shouldQuit = true;
  }
  syncPos(state);
  redraw();
}
