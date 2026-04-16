import { fg, inverse, paintBackground } from "./color.js";
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

export function padFrameLine(text: string, width: number): string {
  return padAnsi(truncate(text, width), width);
}

export function clearScreen(): void {
  process.stdout.write(screenResetSequence(true));
}

export function screenResetSequence(fullClear = false): string {
  return fullClear ? "\x1b[2J\x1b[H" : "\x1b[H";
}

export function resetViewport(): void {
  process.stdout.write(screenResetSequence(false));
}

export function getViewportLayout(state: AppState, width: number, height: number) {
  const reservedFooterHeight = footerHeight(state, width);
  const bodyHeight = Math.max(1, height - reservedFooterHeight - 2);
  const overlayWidth = state.overlay === "none" || state.overlay === "help" || state.overlay === "settings"
    ? 0
    : Math.min(OVERLAY_MAX_WIDTH, Math.floor(width * 0.32));
  const mainWidth = Math.max(MIN_MAIN_WIDTH, width - overlayWidth - (overlayWidth ? 3 : 0));
  const scrollbarWidth = state.currentBook && state.overlay !== "settings" ? 1 : 0;
  const contentWidth = Math.max(1, mainWidth - 2 - scrollbarWidth);
  return {
    reservedFooterHeight,
    bodyHeight,
    overlayWidth,
    mainWidth,
    scrollbarWidth,
    contentWidth
  };
}

export function computeWindowStart(length: number, visibleCount: number, cursor: number): number {
  return Math.max(
    0,
    Math.min(
      cursor - Math.floor(visibleCount / 2),
      Math.max(0, length - visibleCount)
    )
  );
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
    && cached.codeLanguage === state.codeLanguage
    && cached.codeDensity === state.codeDensity
    && cached.width === mainWidth
    && cached.bodyHeight === bodyHeight
  ) {
    return cached;
  }

  const chapterLineCounts = state.currentBook.chapters.map((chapter) => (
    renderBlocks(chapter.blocks, state.renderMode, mainWidth, state.theme, state.codeLanguage, state.codeDensity).length
  ));
  const chapterViewCounts = chapterLineCounts.map((lineCount) => Math.max(1, Math.max(0, lineCount - bodyHeight) + 1));
  state.layoutMetrics = {
    bookId: state.currentBook.id,
    renderMode: state.renderMode,
    codeLanguage: state.codeLanguage,
    codeDensity: state.codeDensity,
    width: mainWidth,
    bodyHeight,
    chapterLineCounts,
    chapterViewCounts
  };
  return state.layoutMetrics;
}

export function computeChapterMaxOffset(state: AppState, mainWidth: number, bodyHeight: number): number {
  const metrics = ensureLayoutMetrics(state, mainWidth, bodyHeight);
  if (!state.currentBook || !metrics) {
    return 0;
  }
  const chapterLineCount = metrics.chapterLineCounts[state.chapterIndex] ?? 0;
  return Math.max(0, chapterLineCount - bodyHeight);
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
  const chapterMaxOffset = computeChapterMaxOffset(state, mainWidth, bodyHeight);
  const offset = clamp(state.blockOffset, 0, chapterMaxOffset);
  return clamp((previousViews + offset) / (totalViews - 1), 0, 1);
}

export function computeChapterProgress(state: AppState, mainWidth: number, bodyHeight: number): number {
  const chapterMaxOffset = computeChapterMaxOffset(state, mainWidth, bodyHeight);
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
    const searchTag = state.searchState
      ? ` · [${state.searchState.cursor + 1}/${state.searchState.results.length}] "${state.searchState.query}"`
      : "";
    left = `${truncate(book.title, 40)} · Ch ${state.chapterIndex + 1}/${totalChapters}${searchTag}`;
  }

  // Right content
  const modeLabel = state.renderMode === "plain" ? "plain" : state.codeLanguage;
  const densityLabel = state.renderMode === "code" ? ` · density:${state.codeDensity}` : "";
  const focusLabel = state.focusMode ? " [FOCUS]" : "";
  const right = `${modeLabel}${densityLabel}${focusLabel} · ${theme.label}`;

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
  const start = clamp(selectedIndex - Math.floor(limit / 2), 0, Math.max(0, suggestions.length - limit));
  return suggestions.slice(start, start + limit).map((suggestion, index) => {
    const actualIndex = start + index;
    const marker = actualIndex === selectedIndex ? fg(theme.accent, ">") : " ";
    const usage = actualIndex === selectedIndex
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
  const shortcuts = state.overlay && state.overlay !== "none"
    ? "Esc close  / commands  ? shortcuts  q quit"
    : state.focusMode
    ? "Esc exit focus  / commands  ? shortcuts  q quit"
    : "/ commands  ? shortcuts  q quit";
  const right = fg(theme.dim, shortcuts);
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

export function getScrollbarMetrics(totalLines: number, bodyHeight: number, blockOffset: number) {
  if (bodyHeight <= 0) {
    return {
      maxOffset: 0,
      thumbHeight: 0,
      thumbOffset: 0
    };
  }

  const maxOffset = Math.max(0, totalLines - bodyHeight);
  if (totalLines <= bodyHeight) {
    return {
      maxOffset,
      thumbHeight: bodyHeight,
      thumbOffset: 0
    };
  }

  const thumbHeight = clamp(Math.round((bodyHeight * bodyHeight) / totalLines), 1, bodyHeight);
  const thumbOffset = maxOffset === 0
    ? 0
    : Math.round((clamp(blockOffset, 0, maxOffset) / maxOffset) * (bodyHeight - thumbHeight));
  return {
    maxOffset,
    thumbHeight,
    thumbOffset
  };
}

export function scrollbarOffsetFromThumb(
  totalLines: number,
  bodyHeight: number,
  thumbTopRow: number
): number {
  const { maxOffset, thumbHeight } = getScrollbarMetrics(totalLines, bodyHeight, 0);
  if (maxOffset === 0 || bodyHeight <= thumbHeight) {
    return 0;
  }
  const clampedThumbTop = clamp(thumbTopRow, 0, bodyHeight - thumbHeight);
  return Math.round((clampedThumbTop / (bodyHeight - thumbHeight)) * maxOffset);
}

export function renderScrollbar(
  totalLines: number,
  bodyHeight: number,
  blockOffset: number,
  theme: ThemePreset,
  focusMode = false
): string[] {
  if (focusMode || bodyHeight <= 0) {
    return [];
  }

  const thumb = fg(theme.accentMuted, "█");
  const { thumbHeight, thumbOffset } = getScrollbarMetrics(totalLines, bodyHeight, blockOffset);
  if (totalLines <= bodyHeight) {
    return Array.from({ length: bodyHeight }, () => thumb);
  }

  const track = fg(theme.border, "│");

  return Array.from({ length: bodyHeight }, (_, row) => (
    row >= thumbOffset && row < thumbOffset + thumbHeight ? thumb : track
  ));
}

// Body rendering
export function renderBody(
  mainLines: string[],
  overlayLines: string[],
  bodyHeight: number,
  mainWidth: number,
  overlayWidth: number,
  theme: ThemePreset,
  scrollbar: string[] = []
): string {
  const textWidth = Math.max(1, mainWidth - (scrollbar.length > 0 ? 1 : 0));
  let output = "";
  for (let row = 0; row < bodyHeight; row += 1) {
    const left = padAnsi(truncate(mainLines[row] ?? "", textWidth - 1), textWidth);
    const scrollbarCell = scrollbar[row] ?? "";
    if (overlayWidth) {
      const right = padAnsi(truncate(overlayLines[row] ?? "", overlayWidth - 1), overlayWidth);
      output += `${left}${scrollbarCell} ${fg(theme.border, "│")} ${right}\n`;
    } else {
      output += `${left}${scrollbarCell}\n`;
    }
  }
  return output;
}

export function renderFrame(
  lines: string[],
  width: number,
  height: number,
  background?: string,
  foreground?: string
): string {
  const frameLines = Array.from({ length: height }, (_, index) => padFrameLine(lines[index] ?? "", width));
  const paintedLines = background
    ? frameLines.map((line) => paintBackground(background, line, foreground))
    : frameLines;
  return `${screenResetSequence(false)}${paintedLines.join("\n")}`;
}
