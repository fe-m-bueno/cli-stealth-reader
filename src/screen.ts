import { fg } from "./color.js";
import type { AppState, CanonicalBook, CanonicalChapter, ThemePreset } from "./types.js";

// Layout constants
export const OVERLAY_MAX_WIDTH = 42;
export const MIN_MAIN_WIDTH = 24;
export const PROGRESS_BAR_WIDTH = 12;
export const MIN_PAGE_LINES = 5;
export const BODY_OVERHEAD = 4; // lines used by statusbar + footer + margin

// Utility functions
export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

export function truncate(text: string, width: number): string {
  if (width <= 0) {
    return "";
  }
  if (stripAnsi(text).length <= width) {
    return text;
  }

  const target = Math.max(0, width - 1);
  let visible = 0;
  let index = 0;
  let output = "";

  while (index < text.length && visible < target) {
    if (text[index] === "\x1b") {
      const match = /\x1b\[[0-9;]*m/.exec(text.slice(index));
      if (match) {
        output += match[0];
        index += match[0].length;
        continue;
      }
    }
    output += text[index];
    visible += 1;
    index += 1;
  }

  return `${output}…\x1b[0m`;
}

function padAnsi(text: string, width: number): string {
  const padding = Math.max(0, width - stripAnsi(text).length);
  return text + " ".repeat(padding);
}

export function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[H");
}

// Progress computation
export function computeBookProgress(book: CanonicalBook, chapterIndex: number, blockOffset: number): number {
  if (book.chapters.length <= 1) {
    return blockOffset > 0 ? clamp(blockOffset / Math.max(1, book.chapters[0].blocks.length), 0, 1) : 0;
  }
  return (chapterIndex + (blockOffset > 0 ? blockOffset / Math.max(1, book.chapters[chapterIndex].blocks.length) : 0)) / book.chapters.length;
}

export function computeChapterProgress(chapter: CanonicalChapter, blockOffset: number): number {
  return clamp(blockOffset / Math.max(1, chapter.blocks.length), 0, 1);
}

export function progressBar(value: number, width: number, theme: ThemePreset): string {
  const clamped = clamp(value, 0, 1);
  const filled = Math.round(clamped * width);
  const empty = Math.max(0, width - filled);
  return fg(theme.accent, "█".repeat(filled)) + fg(theme.border, "░".repeat(empty));
}

// Status bar rendering
export function renderStatusBar(state: AppState, width: number): string {
  const theme = state.theme;
  const border = (s: string) => fg(theme.border, s);

  // Left content
  let left: string;
  if (!state.currentBook) {
    left = "cli-stealth-reader";
  } else {
    const book = state.currentBook;
    const totalChapters = book.chapters.length;
    left = `${truncate(book.title, 40)} · Ch ${state.chapterIndex + 1}/${totalChapters}`;

    if (state.progressVisibility === "book" || state.progressVisibility === "both") {
      const bookProg = computeBookProgress(book, state.chapterIndex, state.blockOffset);
      const pct = Math.round(bookProg * 100);
      left += ` · ${progressBar(bookProg, PROGRESS_BAR_WIDTH, theme)} ${pct}%`;
    }
    if (state.progressVisibility === "chapter" || state.progressVisibility === "both") {
      const chapter = book.chapters[state.chapterIndex];
      const chProg = computeChapterProgress(chapter, state.blockOffset);
      const pct = Math.round(chProg * 100);
      left += ` · ch ${progressBar(chProg, PROGRESS_BAR_WIDTH, theme)} ${pct}%`;
    }
  }

  // Right content
  const right = `${state.renderMode} · ${theme.label}`;

  // Calculate plain text lengths (strip ANSI for width calculation)
  const prefix = "╭─ ";
  const suffix = " ─╮";
  const sep = " ─";
  const rightPlain = stripAnsi(right);
  const prefixLen = prefix.length;
  const suffixLen = suffix.length;
  const sepLen = sep.length;
  const minFill = 3;

  // Truncate left content if it would overflow the terminal width
  const available = width - prefixLen - sepLen - rightPlain.length - suffixLen - minFill;
  if (stripAnsi(left).length > available) {
    left = truncate(stripAnsi(left), available);
  }

  const leftPlain = stripAnsi(left);
  // Total fixed: prefix + left + sep + right + suffix
  const fixedLen = prefixLen + leftPlain.length + sepLen + rightPlain.length + suffixLen;
  const fillCount = Math.max(minFill, width - fixedLen);
  const fill = "─".repeat(fillCount);

  return (
    border("╭─ ") +
    left +
    border(sep) +
    border(fill) +
    right +
    border(" ─╮")
  );
}

// Footer rendering
export function renderFooter(state: AppState, width: number): string {
  const theme = state.theme;
  const border = (s: string) => fg(theme.border, s);
  const prefix = "╰─ ";
  const suffix = " ─╯";
  const minFill = 3;

  if (state.commandMode) {
    // Full-width command input line — like a chat prompt at the bottom
    const prompt = fg(theme.accent, "/") + state.commandBuffer;
    const promptPlain = "/" + state.commandBuffer;
    const fixedLen = prefix.length + promptPlain.length + suffix.length;
    const fill = "─".repeat(Math.max(minFill, width - fixedLen));
    return border(prefix) + prompt + border(fill + suffix);
  }

  // Normal mode: status left, hints right
  let left = state.status ? fg(theme.dim, state.status) : "";
  const right = fg(theme.dim, "/ commands  ? shortcuts  q quit");
  const sep = " ─";
  const rightPlain = stripAnsi(right);
  const available = width - prefix.length - sep.length - rightPlain.length - suffix.length - minFill;
  if (stripAnsi(left).length > available) {
    left = truncate(stripAnsi(left), available);
  }
  const fixedLen = prefix.length + stripAnsi(left).length + sep.length + rightPlain.length + suffix.length;
  const fill = "─".repeat(Math.max(minFill, width - fixedLen));
  return border(prefix) + left + border(sep) + border(fill) + right + border(suffix);
}

// Body rendering
export function renderBody(
  mainLines: string[],
  overlayLines: string[],
  bodyHeight: number,
  mainWidth: number,
  overlayWidth: number,
  theme: ThemePreset
): string {
  let output = "";
  for (let row = 0; row < bodyHeight; row += 1) {
    const left = padAnsi(truncate(mainLines[row] ?? "", mainWidth - 1), mainWidth);
    if (overlayWidth) {
      const right = padAnsi(truncate(overlayLines[row] ?? "", overlayWidth - 1), overlayWidth);
      output += `${left} ${fg(theme.border, "│")} ${right}\n`;
    } else {
      output += `${left}\n`;
    }
  }
  return output;
}
