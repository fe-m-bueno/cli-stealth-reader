import { bold, fg } from "./color.js";
import { clamp, computeWindowStart, getScrollbarMetrics, stripAnsi, truncate } from "./screen.js";
import type { ThemePreset } from "./types.js";

export interface ModalGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  visibleRows: number;
  entriesY: number;
}

export type ModalHit =
  | { kind: "close" }
  | { kind: "search" }
  | { kind: "row"; index: number }
  | null;

export interface ModalSearchState {
  buffer: string;
  active: boolean;
  placeholder: string;
}

export interface ModalFrameOptions {
  theme: ThemePreset;
  title: string;
  search: ModalSearchState | null;
  rowCount: number;
  cursor: number;
  renderRow: (index: number, contentWidth: number, selected: boolean) => string;
  footerHints: Array<{ key: string; label: string }>;
}

export function modalGeometry(width: number, height: number): ModalGeometry {
  const maxWidth = Math.max(20, width - 2);
  const maxHeight = Math.max(8, height - 2);
  const modalWidth = clamp(Math.floor(width * 0.7), Math.min(44, maxWidth), Math.min(80, maxWidth));
  const modalHeight = clamp(Math.floor(height * 0.76), Math.min(16, maxHeight), maxHeight);
  return {
    x: Math.max(0, Math.floor((width - modalWidth) / 2)),
    y: Math.max(0, Math.floor((height - modalHeight) / 2)),
    width: modalWidth,
    height: modalHeight,
    visibleRows: Math.max(1, modalHeight - 6),
    entriesY: Math.max(0, Math.floor((height - modalHeight) / 2)) + 3
  };
}

export function padAnsi(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - stripAnsi(text).length))}`;
}

function modalTop(title: string, width: number): string {
  const innerWidth = Math.max(1, width - 2);
  const left = `─ ${title} `;
  const right = " [×]─";
  return `╭${left}${"─".repeat(Math.max(0, innerWidth - left.length - right.length))}${right}╮`;
}

function hint(theme: ThemePreset, key: string, label: string): string {
  return `${bold(fg(theme.foreground, key))}${fg(theme.dim, `:${label}`)}`;
}

export function renderModalFrame(options: ModalFrameOptions, width: number, height: number): string[] {
  const geometry = modalGeometry(width, height);
  const theme = options.theme;
  const cursor = clamp(options.cursor, 0, Math.max(0, options.rowCount - 1));
  const start = computeWindowStart(options.rowCount, geometry.visibleRows, cursor);
  const metrics = getScrollbarMetrics(options.rowCount, geometry.visibleRows, start);
  const innerContentWidth = Math.max(1, geometry.width - 4);
  const border = (value: string) => fg(theme.border, value);
  const output = Array.from({ length: height }, () => "");
  const prefix = " ".repeat(geometry.x);

  const setLine = (row: number, value: string) => {
    if (row >= 0 && row < output.length) {
      output[row] = `${prefix}${value}`;
    }
  };

  setLine(geometry.y, border(modalTop(options.title, geometry.width)));
  if (options.search) {
    const search = options.search.active || options.search.buffer
      ? `${fg(theme.accent, "/")} ${options.search.buffer}${options.search.active ? "▏" : ""}`
      : fg(theme.subtle, options.search.placeholder);
    setLine(geometry.y + 1, `${border("│")} ${padAnsi(search, innerContentWidth)} ${border("│")}`);
  } else {
    setLine(geometry.y + 1, `${border("│")} ${" ".repeat(innerContentWidth)} ${border("│")}`);
  }
  setLine(geometry.y + 2, border(`├${"─".repeat(Math.max(1, geometry.width - 2))}┤`));

  for (let visibleIndex = 0; visibleIndex < geometry.visibleRows; visibleIndex += 1) {
    const rowIndex = start + visibleIndex;
    const scrollbar = options.rowCount > geometry.visibleRows
      ? visibleIndex >= metrics.thumbOffset && visibleIndex < metrics.thumbOffset + metrics.thumbHeight ? "█" : "│"
      : " ";
    const content = rowIndex < options.rowCount
      ? `${padAnsi(truncate(options.renderRow(rowIndex, innerContentWidth - 2, rowIndex === cursor), innerContentWidth - 2), innerContentWidth - 2)} ${fg(scrollbar === "█" ? theme.foreground : theme.border, scrollbar)}`
      : " ".repeat(innerContentWidth);
    setLine(geometry.entriesY + visibleIndex, `${border("│")} ${content} ${border("│")}`);
  }

  const footerDividerY = geometry.y + geometry.height - 3;
  setLine(footerDividerY, border(`├${"─".repeat(Math.max(1, geometry.width - 2))}┤`));
  const footer = options.footerHints
    .map((item) => hint(theme, item.key, item.label))
    .join(fg(theme.border, "  │  "));
  setLine(footerDividerY + 1, `${border("│")} ${padAnsi(truncate(footer, innerContentWidth), innerContentWidth)} ${border("│")}`);
  setLine(footerDividerY + 2, border(`╰${"─".repeat(Math.max(1, geometry.width - 2))}╯`));
  return output;
}

export function composeModal(
  theme: ThemePreset,
  modalLines: string[],
  backgroundLines: string[],
  width: number,
  height: number
): string[] {
  const geometry = modalGeometry(width, height);
  return Array.from({ length: height }, (_, row) => {
    const background = stripAnsi(backgroundLines[row] ?? "").padEnd(width).slice(0, width);
    const modalLine = modalLines[row] ?? "";
    if (!modalLine || row < geometry.y || row >= geometry.y + geometry.height) {
      return fg(theme.subtle, background);
    }

    const modal = modalLine.slice(geometry.x);
    const before = fg(theme.subtle, background.slice(0, geometry.x));
    const after = fg(theme.subtle, background.slice(geometry.x + geometry.width));
    return `${before}${modal}${after}`;
  });
}

export function modalHitTest(
  width: number,
  height: number,
  rowCount: number,
  cursor: number,
  x: number,
  y: number
): ModalHit {
  const geometry = modalGeometry(width, height);
  if (y === geometry.y && x >= geometry.x + geometry.width - 6 && x <= geometry.x + geometry.width) {
    return { kind: "close" };
  }
  if (y === geometry.y + 1 && x > geometry.x && x < geometry.x + geometry.width) {
    return { kind: "search" };
  }
  if (y < geometry.entriesY || y >= geometry.entriesY + geometry.visibleRows) {
    return null;
  }
  if (x <= geometry.x || x >= geometry.x + geometry.width - 1) {
    return null;
  }
  const clamped = clamp(cursor, 0, Math.max(0, rowCount - 1));
  const start = computeWindowStart(rowCount, geometry.visibleRows, clamped);
  const index = start + (y - geometry.entriesY);
  return index < rowCount ? { kind: "row", index } : null;
}
