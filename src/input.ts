import { clearScreen, clamp, MIN_PAGE_LINES } from "./screen.js";
import type { AppState } from "./types.js";

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
    clearScreen();
    process.exit(0);
  }

  if (state.commandMode) {
    if (chunk === "\r") {
      const raw = `/${state.commandBuffer}`;
      state.commandBuffer = "";
      state.commandMode = false;
      await executeCmd(raw);
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
  if (chunk === "j" || chunk === "\u001b[B") {
    state.blockOffset += 1;
  } else if (chunk === "k" || chunk === "\u001b[A") {
    state.blockOffset = clamp(state.blockOffset - 1, 0, Infinity);
  } else if (chunk === " ") {
    state.blockOffset += pageSize;
  } else if (chunk === "b") {
    state.blockOffset = clamp(state.blockOffset - pageSize, 0, Infinity);
  } else if (chunk === "g") {
    state.blockOffset = 0;
  } else if (chunk === "G") {
    state.blockOffset += pageSize * 100;
  } else if (chunk === "?") {
    state.overlay = "keys";
  } else if (chunk === "q") {
    state.shouldQuit = true;
  }
  syncPos(state);
  redraw();
}
