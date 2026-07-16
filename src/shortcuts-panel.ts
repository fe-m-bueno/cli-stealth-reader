import { bold, fg, paintBackground } from "./color.js";
import { KEYBOARD_SHORTCUTS } from "./help.js";
import { clamp, computeWindowStart, getScrollbarMetrics, stripAnsi, truncate } from "./screen.js";
import type { AppState } from "./types.js";

const CATEGORY_META = [
  { id: "essentials", label: "Essentials" },
  { id: "navigation", label: "Navigation" },
  { id: "commands", label: "Commands" },
  { id: "view", label: "View" }
] as const;

const DEFAULT_COLLAPSED_CATEGORIES = ["navigation", "commands", "view"];
const ESSENTIAL_KEYS = new Set(["/", "Enter", "Esc", "? / Ctrl+. / Ctrl+X", "q"]);

export const CTRL_DOT_SEQUENCES = ["\x1b[46;5u", "\x1b[27;5;46~"] as const;
export const CTRL_X_SEQUENCES = ["\x18", "\x1b[120;5u"] as const;

export interface ShortcutPanelRow {
  kind: "header" | "shortcut";
  category: string;
  label: string;
  key?: string;
  count?: number;
  collapsed?: boolean;
}

export interface ShortcutModalGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  visibleRows: number;
  entriesY: number;
}

export type ShortcutModalHit =
  | { kind: "close" }
  | { kind: "search" }
  | { kind: "row"; index: number }
  | null;

export function isShortcutHelpKey(chunk: string): boolean {
  return chunk === "?"
    || CTRL_X_SEQUENCES.some((sequence) => chunk === sequence)
    || CTRL_DOT_SEQUENCES.some((sequence) => chunk === sequence);
}

export function openShortcutHelp(state: AppState): void {
  state.commandMode = false;
  state.overlay = "keys";
  state.overlayCursor = 0;
  state.shortcutSearchBuffer = "";
  state.shortcutSearchMode = false;
  state.shortcutCollapsedCategories = new Set(DEFAULT_COLLAPSED_CATEGORIES);
  state.status = "Opened keyboard shortcuts";
}

function collapsedCategories(state: AppState): Set<string> {
  if (!state.shortcutCollapsedCategories) {
    state.shortcutCollapsedCategories = new Set(DEFAULT_COLLAPSED_CATEGORIES);
  }
  return state.shortcutCollapsedCategories;
}

export function shortcutPanelRows(state: AppState): ShortcutPanelRow[] {
  const query = (state.shortcutSearchBuffer ?? "").trim().toLowerCase();
  const collapsed = collapsedCategories(state);
  const rows: ShortcutPanelRow[] = [];

  for (const category of CATEGORY_META) {
    const entries = KEYBOARD_SHORTCUTS.filter((shortcut) => category.id === "essentials"
      ? ESSENTIAL_KEYS.has(shortcut.key)
      : shortcut.category === category.id && !ESSENTIAL_KEYS.has(shortcut.key));
    const matches = query
      ? entries.filter((shortcut) => `${shortcut.key} ${shortcut.description}`.toLowerCase().includes(query))
      : entries;
    if (query && matches.length === 0) {
      continue;
    }

    const isCollapsed = !query && collapsed.has(category.id);
    rows.push({
      kind: "header",
      category: category.id,
      label: category.label,
      count: entries.length,
      collapsed: isCollapsed
    });
    if (!isCollapsed) {
      rows.push(...matches.map((shortcut) => ({
        kind: "shortcut" as const,
        category: category.id,
        label: shortcut.description,
        key: shortcut.key
      })));
    }
  }

  return rows;
}

export function toggleShortcutCategory(state: AppState, category: string): void {
  const collapsed = collapsedCategories(state);
  if (!collapsed.delete(category)) {
    collapsed.add(category);
  }
}

export function shortcutModalGeometry(width: number, height: number): ShortcutModalGeometry {
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

function padAnsi(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - stripAnsi(text).length))}`;
}

function modalTop(width: number): string {
  const innerWidth = Math.max(1, width - 2);
  const left = "─ Keyboard Shortcuts ";
  const right = " [×]─";
  return `╭${left}${"─".repeat(Math.max(0, innerWidth - left.length - right.length))}${right}╮`;
}

function hint(theme: AppState["theme"], key: string, label: string): string {
  return `${bold(fg(theme.foreground, key))}${fg(theme.dim, `:${label}`)}`;
}

function renderRow(state: AppState, row: ShortcutPanelRow, width: number, selected: boolean, scrollbar = ""): string {
  const contentWidth = Math.max(1, width - 2);
  let content: string;
  if (row.kind === "header") {
    const disclosure = row.collapsed ? "›" : "◆";
    const suffix = row.collapsed ? ` (${row.count ?? 0})` : "";
    content = bold(`${disclosure} ${row.label}${suffix}`);
  } else {
    const key = row.key ?? "";
    const keyWidth = Math.min(24, key.length);
    const labelWidth = Math.max(1, contentWidth - keyWidth - 4);
    const label = truncate(row.label, labelWidth);
    const gap = " ".repeat(Math.max(1, contentWidth - stripAnsi(label).length - keyWidth - 2));
    content = `  ${label}${gap}${bold(key)}`;
  }

  const plain = padAnsi(truncate(content, contentWidth), contentWidth);
  const styled = selected
    ? paintBackground(state.theme.border, fg(state.theme.foreground, plain))
    : row.kind === "header"
      ? fg(state.theme.foreground, plain)
      : fg(state.theme.dim, plain);
  return `${styled} ${fg(scrollbar === "█" ? state.theme.foreground : state.theme.border, scrollbar || " ")}`;
}

export function renderShortcutPanel(state: AppState, width: number, height: number): string[] {
  const geometry = shortcutModalGeometry(width, height);
  const rows = shortcutPanelRows(state);
  state.overlayCursor = clamp(state.overlayCursor, 0, Math.max(0, rows.length - 1));
  const start = computeWindowStart(rows.length, geometry.visibleRows, state.overlayCursor);
  const metrics = getScrollbarMetrics(rows.length, geometry.visibleRows, start);
  const innerContentWidth = Math.max(1, geometry.width - 4);
  const border = (value: string) => fg(state.theme.border, value);
  const output = Array.from({ length: height }, () => "");
  const prefix = " ".repeat(geometry.x);

  const setLine = (row: number, value: string) => {
    if (row >= 0 && row < output.length) {
      output[row] = `${prefix}${value}`;
    }
  };

  setLine(geometry.y, border(modalTop(geometry.width)));
  const search = state.shortcutSearchMode || state.shortcutSearchBuffer
    ? `${fg(state.theme.accent, "/")} ${state.shortcutSearchBuffer ?? ""}${state.shortcutSearchMode ? "▏" : ""}`
    : fg(state.theme.subtle, "/ to search");
  setLine(geometry.y + 1, `${border("│")} ${padAnsi(search, innerContentWidth)} ${border("│")}`);
  setLine(geometry.y + 2, border(`├${"─".repeat(Math.max(1, geometry.width - 2))}┤`));

  for (let visibleIndex = 0; visibleIndex < geometry.visibleRows; visibleIndex += 1) {
    const rowIndex = start + visibleIndex;
    const row = rows[rowIndex];
    const scrollbar = rows.length > geometry.visibleRows
      ? visibleIndex >= metrics.thumbOffset && visibleIndex < metrics.thumbOffset + metrics.thumbHeight ? "█" : "│"
      : " ";
    const content = row
      ? renderRow(state, row, innerContentWidth, rowIndex === state.overlayCursor, scrollbar)
      : " ".repeat(innerContentWidth);
    setLine(geometry.entriesY + visibleIndex, `${border("│")} ${content} ${border("│")}`);
  }

  const footerDividerY = geometry.y + geometry.height - 3;
  setLine(footerDividerY, border(`├${"─".repeat(Math.max(1, geometry.width - 2))}┤`));
  const footer = [
    hint(state.theme, "↑/↓", "nav"),
    hint(state.theme, "Enter/Space", "expand"),
    hint(state.theme, "Esc", "close")
  ].join(fg(state.theme.border, "  │  "));
  setLine(footerDividerY + 1, `${border("│")} ${padAnsi(truncate(footer, innerContentWidth), innerContentWidth)} ${border("│")}`);
  setLine(footerDividerY + 2, border(`╰${"─".repeat(Math.max(1, geometry.width - 2))}╯`));
  return output;
}

export function shortcutModalHitTest(
  state: AppState,
  width: number,
  height: number,
  x: number,
  y: number
): ShortcutModalHit {
  const geometry = shortcutModalGeometry(width, height);
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
  const rows = shortcutPanelRows(state);
  const start = computeWindowStart(rows.length, geometry.visibleRows, state.overlayCursor);
  const index = start + (y - geometry.entriesY);
  return index < rows.length ? { kind: "row", index } : null;
}
