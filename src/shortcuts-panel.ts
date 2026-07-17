import { bold, fg, paintBackground } from "./color.js";
import { KEYBOARD_SHORTCUTS } from "./help.js";
import { clamp, stripAnsi, truncate } from "./screen.js";
import {
  composeModal,
  modalGeometry,
  modalHitTest,
  padAnsi,
  renderModalFrame,
  type ModalGeometry,
  type ModalHit
} from "./modal.js";
import type { AppState } from "./types.js";

const CATEGORY_META = [
  { id: "essentials", label: "Essentials" },
  { id: "navigation", label: "Navigation" },
  { id: "commands", label: "Commands" },
  { id: "view", label: "View" }
] as const;

const DEFAULT_COLLAPSED_CATEGORIES = ["navigation", "commands", "view"];
const ESSENTIAL_KEYS = new Set(["/", "Enter", "Esc", "? / Ctrl+. / Ctrl+X", "Shift+S", "q"]);

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

export type ShortcutModalGeometry = ModalGeometry;
export type ShortcutModalHit = ModalHit;

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
  return modalGeometry(width, height);
}

function renderRow(state: AppState, row: ShortcutPanelRow, contentWidth: number, selected: boolean): string {
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
  return selected
    ? paintBackground(state.theme.border, fg(state.theme.foreground, plain))
    : row.kind === "header"
      ? fg(state.theme.foreground, plain)
      : fg(state.theme.dim, plain);
}

export function renderShortcutPanel(state: AppState, width: number, height: number): string[] {
  const rows = shortcutPanelRows(state);
  state.overlayCursor = clamp(state.overlayCursor, 0, Math.max(0, rows.length - 1));
  return renderModalFrame({
    theme: state.theme,
    title: "Keyboard Shortcuts",
    search: {
      buffer: state.shortcutSearchBuffer ?? "",
      active: Boolean(state.shortcutSearchMode),
      placeholder: "/ to search"
    },
    rowCount: rows.length,
    cursor: state.overlayCursor,
    renderRow: (index, contentWidth, selected) => renderRow(state, rows[index]!, contentWidth, selected),
    footerHints: state.shortcutSearchMode
      ? [
          { key: "Esc", label: "exit search" },
          { key: "Esc again", label: "close" }
        ]
      : [
          { key: "↑/↓", label: "nav" },
          { key: "Enter/Space", label: "expand" },
          { key: "Esc", label: "close" }
        ]
  }, width, height);
}

export function composeShortcutPanel(
  state: AppState,
  backgroundLines: string[],
  width: number,
  height: number
): string[] {
  return composeModal(state.theme, renderShortcutPanel(state, width, height), backgroundLines, width, height);
}

export function shortcutModalHitTest(
  state: AppState,
  width: number,
  height: number,
  x: number,
  y: number
): ShortcutModalHit {
  return modalHitTest(width, height, shortcutPanelRows(state).length, state.overlayCursor, x, y);
}
