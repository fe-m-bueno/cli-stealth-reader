import { fg, inverse } from "./color.js";
import { listCommandSuggestions } from "./commands.js";
import { renderBlocks } from "./renderers.js";
import type { AppState, CommandSuggestion, ThemePreset } from "./types.js";

// Layout constants
export const OVERLAY_MAX_WIDTH = 42;
export const MIN_MAIN_WIDTH = 24;
export const PROGRESS_BAR_WIDTH = 12;
export const MIN_PAGE_LINES = 5;

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

function ensureLayoutMetrics(state: AppState, mainWidth: number, bodyHeight: number) {
  if (!state.currentBook) {
    return null;
  }
  const cached = state.layoutMetrics;
  if (
    cached
    && cached.bookId === state.currentBook.id
    && cached.renderMode === state.renderMode
    && cached.width === mainWidth
    && cached.bodyHeight === bodyHeight
  ) {
    return cached;
  }

  const chapterLineCounts = state.currentBook.chapters.map((chapter) => (
    renderBlocks(chapter.blocks, state.renderMode, mainWidth, state.theme).length
  ));
  const chapterViewCounts = chapterLineCounts.map((lineCount) => Math.max(1, Math.max(0, lineCount - bodyHeight) + 1));
  state.layoutMetrics = {
    bookId: state.currentBook.id,
    renderMode: state.renderMode,
    width: mainWidth,
    bodyHeight,
    chapterLineCounts,
    chapterViewCounts
  };
  return state.layoutMetrics;
}

export function computeBookProgress(state: AppState, mainWidth: number, bodyHeight: number): number {
  const metrics = ensureLayoutMetrics(state, mainWidth, bodyHeight);
  if (!state.currentBook || !metrics) {
    return 0;
  }

  const totalViews = metrics.chapterViewCounts.reduce((sum, count) => sum + count, 0);
  if (totalViews <= 1) {
    return 0;
  }

  const previousViews = metrics.chapterViewCounts
    .slice(0, state.chapterIndex)
    .reduce((sum, count) => sum + count, 0);
  const chapterLineCount = metrics.chapterLineCounts[state.chapterIndex] ?? 0;
  const chapterMaxOffset = Math.max(0, chapterLineCount - bodyHeight);
  const offset = clamp(state.blockOffset, 0, chapterMaxOffset);
  return clamp((previousViews + offset) / (totalViews - 1), 0, 1);
}

export function computeChapterProgress(state: AppState, mainWidth: number, bodyHeight: number): number {
  const metrics = ensureLayoutMetrics(state, mainWidth, bodyHeight);
  if (!state.currentBook || !metrics) {
    return 0;
  }

  const chapterLineCount = metrics.chapterLineCounts[state.chapterIndex] ?? 0;
  const chapterMaxOffset = Math.max(0, chapterLineCount - bodyHeight);
  if (chapterMaxOffset === 0) {
    return 0;
  }
  return clamp(state.blockOffset / chapterMaxOffset, 0, 1);
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

export function formatProgress(state: AppState, mainWidth: number, bodyHeight: number): string {
  if (!state.currentBook || state.progressVisibility === "hidden") {
    return "";
  }

  const parts: string[] = [];
  if (state.progressVisibility === "book" || state.progressVisibility === "both") {
    const bookProg = computeBookProgress(state, mainWidth, bodyHeight);
    parts.push(`book ${progressBar(bookProg, PROGRESS_BAR_WIDTH, state.theme)} ${Math.round(bookProg * 100)}%`);
  }
  if (state.progressVisibility === "chapter" || state.progressVisibility === "both") {
    const chapterProg = computeChapterProgress(state, mainWidth, bodyHeight);
    parts.push(`ch ${progressBar(chapterProg, PROGRESS_BAR_WIDTH, state.theme)} ${Math.round(chapterProg * 100)}%`);
  }
  return parts.join(` ${fg(state.theme.border, "·")} `);
}

function renderBottomRight(text: string, width: number, theme: ThemePreset): string {
  const visible = stripAnsi(text);
  const padding = Math.max(0, width - visible.length);
  return `${" ".repeat(padding)}${text}`;
}

function renderCommandSuggestions(suggestions: CommandSuggestion[], width: number, theme: ThemePreset, selectedIndex: number): string[] {
  const limit = Math.max(1, Math.min(7, suggestions.length));
  return suggestions.slice(0, limit).map((suggestion, index) => {
    const marker = index === selectedIndex ? fg(theme.accent, ">") : " ";
    const usage = index === selectedIndex
      ? fg(theme.accent, suggestion.usage)
      : suggestion.usage;
    return `${marker} ${padAnsi(truncate(usage, Math.max(1, width - 26)), Math.max(1, width - 26))} ${fg(theme.dim, truncate(suggestion.description, 22))}`;
  });
}

function renderCommandBox(state: AppState, width: number): string[] {
  const border = (s: string) => fg(state.theme.border, s);
  const innerWidth = Math.max(1, width - 4);
  const suggestions = listCommandSuggestions(state.commandBuffer);
  const selectedIndex = suggestions.length === 0 ? 0 : clamp(state.commandSuggestionIndex, 0, suggestions.length - 1);
  const promptText = `/${state.commandBuffer}`;
  const prompt = fg(state.theme.accent, "/") + state.commandBuffer + inverse(" ");
  const promptLine = padAnsi(truncate(prompt, innerWidth), innerWidth);
  const lines = [
    border(`╭${"─".repeat(innerWidth + 2)}╮`),
    `${border("│")} ${promptLine} ${border("│")}`,
    border(`╰${"─".repeat(innerWidth + 2)}╯`)
  ];

  if (!promptText.trim() || suggestions.length > 0) {
    lines.push(...renderCommandSuggestions(suggestions, width, state.theme, selectedIndex));
  }
  return lines;
}

// Footer rendering
export function renderFooter(state: AppState, width: number, progress = ""): string[] {
  const theme = state.theme;
  const border = (s: string) => fg(theme.border, s);
  const prefix = "╰─ ";
  const suffix = " ─╯";
  const minFill = 3;

  if (state.commandMode) {
    const lines = renderCommandBox(state, width);
    const status = fg(theme.dim, state.status || "Ready");
    const statusPlain = stripAnsi(status);
    const fixedLen = prefix.length + statusPlain.length + suffix.length;
    const fill = "─".repeat(Math.max(minFill, width - fixedLen));
    return progress
      ? [...lines, border(prefix) + status + border(fill + suffix), renderBottomRight(progress, width, theme)]
      : [...lines, border(prefix) + status + border(fill + suffix)];
  }

  const status = fg(theme.dim, state.status || "Ready");
  const right = fg(theme.dim, "/ commands  ? shortcuts  q quit");
  const sep = " ─";
  const statusPlain = stripAnsi(status);
  const rightPlain = stripAnsi(right);
  const available = width - prefix.length - sep.length - rightPlain.length - suffix.length - minFill;
  const left = statusPlain.length > available ? truncate(status, available) : status;
  const fixedLen = prefix.length + stripAnsi(left).length + sep.length + rightPlain.length + suffix.length;
  const fill = "─".repeat(Math.max(minFill, width - fixedLen));
  const footer = border(prefix) + left + border(sep) + border(fill) + right + border(suffix);
  return progress ? [footer, renderBottomRight(progress, width, theme)] : [footer];
}

export function footerHeight(state: AppState, width: number): number {
  const baseHeight = state.commandMode ? renderCommandBox(state, width).length + 1 : 1;
  const hasProgress = Boolean(state.currentBook) && state.progressVisibility !== "hidden";
  return baseHeight + (hasProgress ? 1 : 0);
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
