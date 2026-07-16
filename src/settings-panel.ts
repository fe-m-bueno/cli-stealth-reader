import { fg, inverse } from "./color.js";
import { stripAnsi, truncate } from "./screen.js";
import { FONT_SCALES, LINE_SPACINGS, MARGIN_SIZES } from "./settings-values.js";
import { APPEARANCE_THEMES, THEMES, applyAppearanceTheme } from "./themes.js";
import type { AppSettings, AppState, CodeDensity, LineSpacing, SettingsTab, ThemePreset } from "./types.js";

export const SETTINGS_TABS: ReadonlyArray<{ id: SettingsTab; label: string }> = [
  { id: "themes", label: "Themes" },
  { id: "reading", label: "Reading" },
  { id: "layout", label: "Layout" },
  { id: "more", label: "More" }
];

type SettingsItemKey =
  | "readingMode"
  | "fontScale"
  | "marginSize"
  | "lineSpacing"
  | "codeDensity"
  | "plainHighlight"
  | "progressVisibility"
  | "appearanceThemeId"
  | "themeId"
  | "mouseCapture";

interface SettingsItem {
  key: SettingsItemKey;
  tab: SettingsTab;
  label: string;
  description: string;
  value: (draft: AppSettings) => string;
  cycle: (draft: AppSettings) => AppSettings;
}

const CODE_DENSITIES: CodeDensity[] = [1, 2, 3, 4, 5];
const PROGRESS_VALUES: AppSettings["progressVisibility"][] = [
  "time-chapter",
  "time-book",
  "book",
  "both",
  "chapter",
  "hidden"
];

type ReadingMode = "plain" | "typescript" | "python" | "rust";

function currentReadingMode(draft: AppSettings): ReadingMode {
  return draft.renderMode === "plain" ? "plain" : draft.codeLanguage;
}

function cycleValue<T>(values: readonly T[], current: T): T {
  const index = values.indexOf(current);
  return values[index < 0 ? 0 : (index + 1) % values.length]!;
}

function readingModeLabel(mode: ReadingMode): string {
  switch (mode) {
    case "plain":
      return "Plain";
    case "typescript":
      return "TypeScript stealth";
    case "python":
      return "Python stealth";
    case "rust":
      return "Rust stealth";
  }
}

function progressLabel(value: AppSettings["progressVisibility"]): string {
  switch (value) {
    case "time-chapter":
      return "Time left in chapter";
    case "time-book":
      return "Time left in book";
    case "book":
      return "Book %";
    case "both":
      return "Book + chapter %";
    case "chapter":
      return "Chapter %";
    case "hidden":
      return "Hidden";
  }
}

function boolLabel(value: boolean): string {
  return value ? "true" : "false";
}

function fontScaleLabel(value: number): string {
  if (value === 1) return "Standard";
  if (value === 1.15) return "Medium";
  if (value === 1.3) return "Large";
  return "Extra large";
}

function marginLabel(value: number): string {
  return value === 0 ? "None" : `${value} columns`;
}

function lineSpacingLabel(value: LineSpacing): string {
  return value[0]!.toUpperCase() + value.slice(1);
}

export const SETTINGS_ITEMS: SettingsItem[] = [
  {
    key: "readingMode",
    tab: "reading",
    label: "Reading mode",
    description: "Plain reading or code-like stealth rendering.",
    value: (draft) => readingModeLabel(currentReadingMode(draft)),
    cycle: (draft) => {
      const next = cycleValue(["plain", "typescript", "python", "rust"] as const, currentReadingMode(draft));
      return next === "plain"
        ? { ...draft, renderMode: "plain" }
        : { ...draft, renderMode: "code", codeLanguage: next };
    }
  },
  {
    key: "fontScale",
    tab: "layout",
    label: "Text size",
    description: "Wrap text earlier to simulate a larger terminal font.",
    value: (draft) => fontScaleLabel(draft.fontScale),
    cycle: (draft) => ({ ...draft, fontScale: cycleValue(FONT_SCALES, draft.fontScale) })
  },
  {
    key: "marginSize",
    tab: "layout",
    label: "Page margins",
    description: "Add equal horizontal margins around the reading column.",
    value: (draft) => marginLabel(draft.marginSize),
    cycle: (draft) => ({ ...draft, marginSize: cycleValue(MARGIN_SIZES, draft.marginSize) })
  },
  {
    key: "lineSpacing",
    tab: "layout",
    label: "Line spacing",
    description: "Choose compact, normal, or relaxed block spacing.",
    value: (draft) => lineSpacingLabel(draft.lineSpacing),
    cycle: (draft) => ({ ...draft, lineSpacing: cycleValue(LINE_SPACINGS, draft.lineSpacing) })
  },
  {
    key: "codeDensity",
    tab: "layout",
    label: "Code density",
    description: "How compact stealth code rendering should be.",
    value: (draft) => String(draft.codeDensity),
    cycle: (draft) => ({ ...draft, codeDensity: cycleValue(CODE_DENSITIES, draft.codeDensity) })
  },
  {
    key: "plainHighlight",
    tab: "reading",
    label: "Dialogue highlight",
    description: "Highlight dialogue while using plain reading mode.",
    value: (draft) => boolLabel(draft.plainHighlight),
    cycle: (draft) => ({ ...draft, plainHighlight: !draft.plainHighlight })
  },
  {
    key: "progressVisibility",
    tab: "more",
    label: "Progress display",
    description: "Choose which footer progress indicator is visible.",
    value: (draft) => progressLabel(draft.progressVisibility),
    cycle: (draft) => ({ ...draft, progressVisibility: cycleValue(PROGRESS_VALUES, draft.progressVisibility) })
  },
  {
    key: "appearanceThemeId",
    tab: "themes",
    label: "Appearance theme",
    description: "Dark, light, colorblind-friendly, or ANSI appearance.",
    value: (draft) => APPEARANCE_THEMES.find((item) => item.id === draft.appearanceThemeId)?.label ?? draft.appearanceThemeId,
    cycle: (draft) => ({
      ...draft,
      appearanceThemeId: cycleValue(APPEARANCE_THEMES.map((item) => item.id), draft.appearanceThemeId)
    })
  },
  {
    key: "themeId",
    tab: "themes",
    label: "Colorscheme",
    description: "Accent color palette used across the reader.",
    value: (draft) => THEMES.find((item) => item.id === draft.themeId)?.label ?? draft.themeId,
    cycle: (draft) => ({ ...draft, themeId: cycleValue(THEMES.map((item) => item.id), draft.themeId) })
  },
  {
    key: "mouseCapture",
    tab: "more",
    label: "Mouse capture",
    description: "Enable app mouse mode for scrollbar dragging.",
    value: (draft) => boolLabel(draft.mouseCapture),
    cycle: (draft) => ({ ...draft, mouseCapture: !draft.mouseCapture })
  }
];

export function createSettingsDraft(state: AppState): AppSettings {
  return {
    themeId: state.colorScheme.id,
    appearanceThemeId: state.appearanceTheme.id,
    progressVisibility: state.progressVisibility,
    renderMode: state.renderMode,
    codeLanguage: state.codeLanguage,
    codeDensity: state.codeDensity,
    plainHighlight: state.plainHighlight,
    fontScale: state.fontScale ?? 1,
    marginSize: state.marginSize ?? 0,
    lineSpacing: state.lineSpacing ?? "normal",
    mouseCapture: state.mouseCapture
  };
}

export function openSettingsPanel(state: AppState): void {
  state.overlay = "settings";
  state.overlayCursor = 0;
  state.settingsTab = "themes";
  state.settingsDraft = createSettingsDraft(state);
  state.settingsSearchBuffer = "";
  state.settingsSearchMode = false;
  state.status = "Settings: Left/Right tabs, Up/Down select, Space changes, Enter saves, Esc cancels.";
}

export function closeSettingsPanel(state: AppState): void {
  state.overlay = "none";
  state.overlayCursor = 0;
  state.settingsDraft = null;
  state.settingsTab = "themes";
  state.settingsSearchBuffer = "";
  state.settingsSearchMode = false;
}

export function ensureSettingsDraft(state: AppState): AppSettings {
  if (!state.settingsDraft) {
    state.settingsDraft = createSettingsDraft(state);
  }
  return state.settingsDraft;
}

export function filteredSettingsItems(state: AppState): SettingsItem[] {
  const draft = ensureSettingsDraft(state);
  const activeTab = state.settingsTab ?? "themes";
  const query = (state.settingsSearchBuffer ?? "").trim().toLowerCase();
  const tabItems = SETTINGS_ITEMS.filter((item) => item.tab === activeTab);
  if (!query) {
    return tabItems;
  }
  return tabItems.filter((item) => {
    const haystack = [item.label, item.description, item.key, item.value(draft)].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

export function moveSettingsTab(state: AppState, delta: number): void {
  const current = SETTINGS_TABS.findIndex((tab) => tab.id === (state.settingsTab ?? "themes"));
  const next = (current + delta + SETTINGS_TABS.length) % SETTINGS_TABS.length;
  state.settingsTab = SETTINGS_TABS[next]!.id;
  state.overlayCursor = 0;
  state.settingsSearchBuffer = "";
  state.settingsSearchMode = false;
  state.status = `Settings: ${SETTINGS_TABS[next]!.label}`;
}

export function cycleSelectedSetting(state: AppState): void {
  const items = filteredSettingsItems(state);
  const selected = items[state.overlayCursor];
  if (!selected) {
    state.status = "No setting selected.";
    return;
  }
  const draft = ensureSettingsDraft(state);
  state.settingsDraft = selected.cycle(draft);
  state.status = `${selected.label}: ${selected.value(state.settingsDraft)}`;
}

export function applySettingsDraft(state: AppState): boolean {
  const draft = ensureSettingsDraft(state);
  const colorScheme = THEMES.find((item) => item.id === draft.themeId) ?? state.colorScheme;
  const appearanceTheme = APPEARANCE_THEMES.find((item) => item.id === draft.appearanceThemeId) ?? state.appearanceTheme;

  try {
    state.storage.saveSettings(draft);
  } catch {
    state.status = "Settings could not be saved; no changes were applied.";
    return false;
  }

  state.colorScheme = colorScheme;
  state.appearanceTheme = appearanceTheme;
  state.theme = applyAppearanceTheme(colorScheme, appearanceTheme);
  state.progressVisibility = draft.progressVisibility;
  state.renderMode = draft.renderMode;
  state.codeLanguage = draft.codeLanguage;
  state.codeDensity = draft.codeDensity;
  state.plainHighlight = draft.plainHighlight;
  state.fontScale = draft.fontScale;
  state.marginSize = draft.marginSize;
  state.lineSpacing = draft.lineSpacing;
  state.mouseCapture = draft.mouseCapture;
  state.layoutMetrics = null;

  closeSettingsPanel(state);
  state.status = "Settings saved.";
  return true;
}

function padAnsi(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - stripAnsi(text).length));
}

function boxLine(width: number, left: string, fill: string, right: string, theme: ThemePreset): string {
  const border = (text: string) => fg(theme.border, text);
  return border(left + fill.repeat(Math.max(0, width - 2)) + right);
}

function settingsPreview(draft: AppSettings, width: number): string[] {
  const colorScheme = THEMES.find((item) => item.id === draft.themeId) ?? THEMES[0]!;
  const appearance = APPEARANCE_THEMES.find((item) => item.id === draft.appearanceThemeId) ?? APPEARANCE_THEMES[0]!;
  const theme = applyAppearanceTheme(colorScheme, appearance);
  const samples = draft.renderMode === "plain"
    ? [
        fg(theme.foreground, "A quiet chapter begins here."),
        fg(theme.foreground, "The next sentence follows softly.")
      ]
    : draft.codeLanguage === "python"
    ? [
        `${fg(theme.keyword, "fragment")} = ${fg(theme.codeString, '"A quiet chapter begins here."')}`,
        `${fg(theme.keyword, "timeline")} = [fragment]`
      ]
    : draft.codeLanguage === "rust"
    ? [
        `${fg(theme.keyword, "let")} fragment = ${fg(theme.codeString, '"A quiet chapter begins here."')};`,
        `timeline.push(fragment);`
      ]
    : [
        `${fg(theme.keyword, "const")} fragment = ${fg(theme.codeString, '"A quiet chapter begins here."')};`,
        `timeline.push(fragment);`
      ];
  const meta = fg(
    theme.dim,
    `${fontScaleLabel(draft.fontScale)} text · ${draft.marginSize === 0 ? "No margins" : `${draft.marginSize}-column margins`} · ${lineSpacingLabel(draft.lineSpacing)} spacing`
  );
  const inner = Math.max(1, width - 4);
  const requestedMargin = Math.min(draft.marginSize, Math.max(0, Math.floor((inner - 12) / 2)));
  const widthInsideMargins = Math.max(1, inner - requestedMargin * 2);
  const previewTextWidth = Math.max(1, Math.floor(widthInsideMargins / draft.fontScale));
  const previewPadding = Math.max(0, Math.floor((inner - previewTextWidth) / 2));
  const previewCell = (text: string) => {
    const content = `${" ".repeat(previewPadding)}${padAnsi(truncate(text, previewTextWidth), previewTextWidth)}`;
    return `${fg(theme.border, "│")} ${padAnsi(content, inner)} ${fg(theme.border, "│")}`;
  };
  const sampleSpacing = draft.lineSpacing === "compact" ? 0 : draft.lineSpacing === "relaxed" ? 2 : 1;
  const sampleLines = [previewCell(samples[0]!)];
  for (let blank = 0; blank < sampleSpacing; blank += 1) {
    sampleLines.push(previewCell(""));
  }
  sampleLines.push(previewCell(samples[1]!));
  return [
    fg(theme.accent, "Preview"),
    boxLine(width, "╭", "─", "╮", theme),
    ...sampleLines,
    `${fg(theme.border, "│")} ${padAnsi(truncate(meta, inner), inner)} ${fg(theme.border, "│")}`,
    boxLine(width, "╰", "─", "╯", theme)
  ];
}

export function renderSettingsPanel(state: AppState, width: number, height: number): string[] {
  const theme = state.theme;
  const draft = ensureSettingsDraft(state);
  const items = filteredSettingsItems(state);
  const inner = Math.max(10, width - 4);
  const search = state.settingsSearchBuffer ?? "";
  const searchPrompt = `${fg(theme.dim, "⌕")} ${search || fg(theme.dim, "Search settings...")}${state.settingsSearchMode ? inverse(" ") : ""}`;
  const hint = fg(theme.dim, "←/→ tab · ↑/↓ select · Space change · Enter save · / search · Esc cancel");
  const bodyHeight = Math.max(0, height - 10);
  const start = Math.max(0, Math.min(state.overlayCursor - Math.floor(bodyHeight / 2), Math.max(0, items.length - bodyHeight)));

  const tabBar = SETTINGS_TABS.map((tab) => (
    tab.id === (state.settingsTab ?? "themes")
      ? inverse(` ${tab.label} `)
      : fg(theme.dim, ` ${tab.label} `)
  )).join(fg(theme.border, "  "));
  const lines: string[] = [
    `${inverse(" Aa ")} ${fg(theme.foreground, "Reader settings")}`,
    "",
    truncate(tabBar, width),
    "",
    boxLine(inner + 4, "╭", "─", "╮", theme),
    `${fg(theme.border, "│")} ${padAnsi(truncate(searchPrompt, inner), inner)} ${fg(theme.border, "│")}`,
    boxLine(inner + 4, "╰", "─", "╯", theme),
    ""
  ];

  if (items.length === 0) {
    lines.push(fg(theme.dim, "  No settings match your search."));
  } else {
    for (let index = start; index < Math.min(items.length, start + bodyHeight); index += 1) {
      const item = items[index]!;
      const selected = index === state.overlayCursor;
      const marker = selected ? fg(theme.accent, "›") : " ";
      const label = selected ? fg(theme.accent, item.label) : item.label;
      const value = selected ? fg(theme.accent, item.value(draft)) : item.value(draft);
      const labelWidth = Math.max(18, Math.min(28, Math.floor(inner * 0.34)));
      const row = `${marker} ${padAnsi(truncate(label, labelWidth), labelWidth)} ${value}`;
      lines.push(truncate(row, inner + 2));
    }
  }

  const preview = settingsPreview(draft, inner + 4);
  const roomBeforeHint = height - lines.length - 2;
  if (roomBeforeHint >= preview.length + 1) {
    lines.push("", ...preview);
  }
  lines.push("", truncate(hint, width));
  return lines.slice(0, height);
}
