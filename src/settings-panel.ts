import { fg, inverse } from "./color.js";
import { stripAnsi, truncate } from "./screen.js";
import { APPEARANCE_THEMES, THEMES, applyAppearanceTheme } from "./themes.js";
import type { AppSettings, AppState, CodeDensity, ThemePreset } from "./types.js";

export type SettingsPanelDraft = AppSettings & {
  mouseCapture: boolean;
};

type SettingsItemKey =
  | "readingMode"
  | "codeDensity"
  | "plainHighlight"
  | "progressVisibility"
  | "appearanceThemeId"
  | "themeId"
  | "mouseCapture";

interface SettingsItem {
  key: SettingsItemKey;
  label: string;
  description: string;
  value: (draft: SettingsPanelDraft) => string;
  cycle: (draft: SettingsPanelDraft) => SettingsPanelDraft;
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

function currentReadingMode(draft: SettingsPanelDraft): ReadingMode {
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

export const SETTINGS_ITEMS: SettingsItem[] = [
  {
    key: "readingMode",
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
    key: "codeDensity",
    label: "Code density",
    description: "How compact stealth code rendering should be.",
    value: (draft) => String(draft.codeDensity),
    cycle: (draft) => ({ ...draft, codeDensity: cycleValue(CODE_DENSITIES, draft.codeDensity) })
  },
  {
    key: "plainHighlight",
    label: "Dialogue highlight",
    description: "Highlight dialogue while using plain reading mode.",
    value: (draft) => boolLabel(draft.plainHighlight),
    cycle: (draft) => ({ ...draft, plainHighlight: !draft.plainHighlight })
  },
  {
    key: "progressVisibility",
    label: "Progress display",
    description: "Choose which footer progress indicator is visible.",
    value: (draft) => progressLabel(draft.progressVisibility),
    cycle: (draft) => ({ ...draft, progressVisibility: cycleValue(PROGRESS_VALUES, draft.progressVisibility) })
  },
  {
    key: "appearanceThemeId",
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
    label: "Colorscheme",
    description: "Accent color palette used across the reader.",
    value: (draft) => THEMES.find((item) => item.id === draft.themeId)?.label ?? draft.themeId,
    cycle: (draft) => ({ ...draft, themeId: cycleValue(THEMES.map((item) => item.id), draft.themeId) })
  },
  {
    key: "mouseCapture",
    label: "Mouse capture",
    description: "Enable app mouse mode for scrollbar dragging.",
    value: (draft) => boolLabel(draft.mouseCapture),
    cycle: (draft) => ({ ...draft, mouseCapture: !draft.mouseCapture })
  }
];

export function createSettingsDraft(state: AppState): SettingsPanelDraft {
  return {
    themeId: state.colorScheme.id,
    appearanceThemeId: state.appearanceTheme.id,
    progressVisibility: state.progressVisibility,
    renderMode: state.renderMode,
    codeLanguage: state.codeLanguage,
    codeDensity: state.codeDensity,
    plainHighlight: state.plainHighlight,
    mouseCapture: state.mouseCapture
  };
}

export function openSettingsPanel(state: AppState): void {
  state.overlay = "settings";
  state.overlayCursor = 0;
  state.settingsDraft = createSettingsDraft(state);
  state.settingsSearchBuffer = "";
  state.settingsSearchMode = false;
  state.status = "Settings: Space changes, Enter saves, / searches, Esc cancels.";
}

export function closeSettingsPanel(state: AppState): void {
  state.overlay = "none";
  state.overlayCursor = 0;
  state.settingsDraft = null;
  state.settingsSearchBuffer = "";
  state.settingsSearchMode = false;
}

export function ensureSettingsDraft(state: AppState): SettingsPanelDraft {
  if (!state.settingsDraft) {
    state.settingsDraft = createSettingsDraft(state);
  }
  return state.settingsDraft;
}

export function filteredSettingsItems(state: AppState): SettingsItem[] {
  const draft = ensureSettingsDraft(state);
  const query = (state.settingsSearchBuffer ?? "").trim().toLowerCase();
  if (!query) {
    return SETTINGS_ITEMS;
  }
  return SETTINGS_ITEMS.filter((item) => {
    const haystack = [item.label, item.description, item.key, item.value(draft)].join(" ").toLowerCase();
    return haystack.includes(query);
  });
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

export function applySettingsDraft(state: AppState): void {
  const draft = ensureSettingsDraft(state);
  const colorScheme = THEMES.find((item) => item.id === draft.themeId) ?? state.colorScheme;
  const appearanceTheme = APPEARANCE_THEMES.find((item) => item.id === draft.appearanceThemeId) ?? state.appearanceTheme;

  state.colorScheme = colorScheme;
  state.appearanceTheme = appearanceTheme;
  state.theme = applyAppearanceTheme(colorScheme, appearanceTheme);
  state.progressVisibility = draft.progressVisibility;
  state.renderMode = draft.renderMode;
  state.codeLanguage = draft.codeLanguage;
  state.codeDensity = draft.codeDensity;
  state.plainHighlight = draft.plainHighlight;
  state.mouseCapture = draft.mouseCapture;
  state.layoutMetrics = null;

  state.storage.setSetting("themeId", draft.themeId);
  state.storage.setSetting("appearanceThemeId", draft.appearanceThemeId);
  state.storage.setSetting("progressVisibility", draft.progressVisibility);
  state.storage.setSetting("renderMode", draft.renderMode);
  state.storage.setSetting("codeLanguage", draft.codeLanguage);
  state.storage.setSetting("codeDensity", draft.codeDensity);
  state.storage.setSetting("plainHighlight", draft.plainHighlight);

  closeSettingsPanel(state);
  state.status = "Settings saved.";
}

function padAnsi(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - stripAnsi(text).length));
}

function boxLine(width: number, left: string, fill: string, right: string, theme: ThemePreset): string {
  const border = (text: string) => fg(theme.border, text);
  return border(left + fill.repeat(Math.max(0, width - 2)) + right);
}

export function renderSettingsPanel(state: AppState, width: number, height: number): string[] {
  const theme = state.theme;
  const draft = ensureSettingsDraft(state);
  const items = filteredSettingsItems(state);
  const inner = Math.max(24, width - 6);
  const search = state.settingsSearchBuffer ?? "";
  const searchPrompt = `${fg(theme.dim, "⌕")} ${search || fg(theme.dim, "Search settings...")}${state.settingsSearchMode ? inverse(" ") : ""}`;
  const hint = fg(theme.dim, "Space change · Enter save · / search · Esc cancel");
  const bodyHeight = Math.max(0, height - 8);
  const start = Math.max(0, Math.min(state.overlayCursor - Math.floor(bodyHeight / 2), Math.max(0, items.length - bodyHeight)));

  const lines: string[] = [
    inverse("Config"),
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

  lines.push("");
  lines.push(hint);
  return lines.slice(0, height);
}
