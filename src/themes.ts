import type { AppearanceThemePreset, ThemePreset } from "./types.js";

const CHALK_BACKGROUND = "#f7f2e4";

export const THEMES: ThemePreset[] = [
  {
    id: "codex",
    label: "Codex",
    accent: "#3b82f6",
    accentMuted: "#20488d",
    foreground: "#ffffff",
    dim: "#aaaaaa",
    background: "#0d0d0d",
    border: "#5d5d5d",
    warning: "#ffcc00",
    keyword: "#3b82f6",
    codeString: "#00cc66",
    subtle: "#616567"
  },
  {
    id: "claude",
    label: "Claude Code",
    accent: "#d77757",
    accentMuted: "#eb9f7f",
    foreground: "#ffffff",
    dim: "#999999",
    background: "#0d0d0d",
    border: "#888888",
    warning: "#ffc107",
    keyword: "#b1b9f9",
    codeString: "#4eba65",
    subtle: "#505050"
  },
  {
    id: "graphite",
    label: "Graphite",
    accent: "#c6d0da",
    accentMuted: "#606a75",
    foreground: "#eceff3",
    dim: "#8f98a1",
    background: "#121417",
    border: "#2f343a",
    warning: "#f1b36a",
    keyword: "#9a9a9a",
    codeString: "#7a9a7a",
    subtle: "#4a4f55"
  },
  {
    id: "amber",
    label: "Amber",
    accent: "#ffb347",
    accentMuted: "#8a5a18",
    foreground: "#fbe8c6",
    dim: "#b3935a",
    background: "#110d07",
    border: "#3e2910",
    warning: "#ffd166",
    keyword: "#d4a853",
    codeString: "#c8864a",
    subtle: "#5a3e1e"
  },
  {
    id: "forest",
    label: "Forest",
    accent: "#7ce2a1",
    accentMuted: "#2d7047",
    foreground: "#dff6e6",
    dim: "#86a88e",
    background: "#0b120e",
    border: "#1a3d24",
    warning: "#f2c97d",
    keyword: "#5f9e6e",
    codeString: "#7ec88a",
    subtle: "#2e4d36"
  }
];

export const APPEARANCE_THEMES: AppearanceThemePreset[] = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light Chalk" },
  { id: "dark-colorblind", label: "Dark Colorblind" },
  { id: "light-colorblind", label: "Light Colorblind" },
  { id: "dark-ansi", label: "Dark ANSI" },
  { id: "light-ansi", label: "Light ANSI" }
];

export const DEFAULT_COLOR_SCHEME = THEMES[0];
export const DEFAULT_APPEARANCE_THEME = APPEARANCE_THEMES[0];

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace("#", "");
  const numeric = Number.parseInt(value, 16);
  return {
    r: (numeric >> 16) & 255,
    g: (numeric >> 8) & 255,
    b: numeric & 255
  };
}

function rgbToHex({ r, g, b }: { r: number; g: number; b: number }): string {
  return `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

function mix(first: string, second: string, amount: number): string {
  const a = hexToRgb(first);
  const b = hexToRgb(second);
  return rgbToHex({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount
  });
}

function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channels = [r, g, b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : Math.pow((normalized + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

function readableOnLight(hex: string): string {
  let current = hex;
  for (let step = 0; step < 12 && contrast(current, CHALK_BACKGROUND) < 4.5; step += 1) {
    current = mix(current, "#000000", 0.12);
  }
  return current;
}

function labelFor(colorScheme: ThemePreset, appearanceTheme: AppearanceThemePreset): string {
  return appearanceTheme.id === "dark"
    ? colorScheme.label
    : `${colorScheme.label} · ${appearanceTheme.label}`;
}

function lightTheme(colorScheme: ThemePreset, appearanceTheme: AppearanceThemePreset): ThemePreset {
  const accent = readableOnLight(colorScheme.accent);
  return {
    ...colorScheme,
    id: `${colorScheme.id}:${appearanceTheme.id}`,
    label: labelFor(colorScheme, appearanceTheme),
    accent,
    accentMuted: mix(accent, CHALK_BACKGROUND, 0.42),
    foreground: "#25231d",
    dim: "#706a5d",
    background: CHALK_BACKGROUND,
    border: "#d8cfb8",
    warning: readableOnLight(colorScheme.warning),
    keyword: readableOnLight(colorScheme.keyword),
    codeString: readableOnLight(colorScheme.codeString),
    subtle: "#837a68"
  };
}

function colorblindSchemeColors(colorScheme: ThemePreset, light: boolean) {
  switch (colorScheme.id) {
    case "claude":
      return light
        ? { accent: "#b65c00", accentMuted: "#c99b69", warning: "#8a5a00", keyword: "#0072b2", codeString: "#007f5f" }
        : { accent: "#e69f00", accentMuted: "#7a560f", warning: "#f0e442", keyword: "#56b4e9", codeString: "#009e73" };
    case "graphite":
      return light
        ? { accent: "#4d5358", accentMuted: "#9aa0a5", warning: "#d55e00", keyword: "#0072b2", codeString: "#007f5f" }
        : { accent: "#d8dee4", accentMuted: "#6f7780", warning: "#e69f00", keyword: "#56b4e9", codeString: "#f0e442" };
    case "amber":
      return light
        ? { accent: "#b65c00", accentMuted: "#c99b69", warning: "#8a5a00", keyword: "#0072b2", codeString: "#984ea3" }
        : { accent: "#e69f00", accentMuted: "#7a560f", warning: "#f0e442", keyword: "#56b4e9", codeString: "#cc79a7" };
    case "forest":
      return light
        ? { accent: "#007f5f", accentMuted: "#78aa9b", warning: "#d55e00", keyword: "#0072b2", codeString: "#984ea3" }
        : { accent: "#34c9a2", accentMuted: "#236b59", warning: "#f0e442", keyword: "#56b4e9", codeString: "#e69f00" };
    case "codex":
    default:
      return light
        ? { accent: "#0072b2", accentMuted: "#7aa6c4", warning: "#d55e00", keyword: "#cc79a7", codeString: "#007f5f" }
        : { accent: "#56b4e9", accentMuted: "#2f657d", warning: "#e69f00", keyword: "#cc79a7", codeString: "#f0e442" };
  }
}

function colorblindTheme(colorScheme: ThemePreset, appearanceTheme: AppearanceThemePreset): ThemePreset {
  const light = appearanceTheme.id === "light-colorblind";
  const colors = colorblindSchemeColors(colorScheme, light);
  return {
    ...colorScheme,
    id: `${colorScheme.id}:${appearanceTheme.id}`,
    label: labelFor(colorScheme, appearanceTheme),
    accent: colors.accent,
    accentMuted: colors.accentMuted,
    foreground: light ? "#202124" : "#edf2f4",
    dim: light ? "#62676b" : "#9aa4aa",
    background: light ? "#f8f7f1" : "#0b0f12",
    border: light ? "#d1cec4" : "#313a42",
    warning: colors.warning,
    keyword: colors.keyword,
    codeString: colors.codeString,
    subtle: light ? "#777b80" : "#68747c"
  };
}

function ansiSchemeColors(colorScheme: ThemePreset, light: boolean) {
  switch (colorScheme.id) {
    case "claude":
      return light
        ? { accent: "ansi:brightRed", accentMuted: "ansi:brightYellow", warning: "ansi:yellow", keyword: "ansi:blue", codeString: "ansi:green" }
        : { accent: "ansi:brightRed", accentMuted: "ansi:brightYellow", warning: "ansi:brightYellow", keyword: "ansi:brightBlue", codeString: "ansi:brightGreen" };
    case "graphite":
      return light
        ? { accent: "ansi:black", accentMuted: "ansi:brightBlack", warning: "ansi:red", keyword: "ansi:blue", codeString: "ansi:green" }
        : { accent: "ansi:brightWhite", accentMuted: "ansi:brightBlack", warning: "ansi:yellow", keyword: "ansi:white", codeString: "ansi:cyan" };
    case "amber":
      return light
        ? { accent: "ansi:red", accentMuted: "ansi:yellow", warning: "ansi:magenta", keyword: "ansi:blue", codeString: "ansi:magenta" }
        : { accent: "ansi:yellow", accentMuted: "ansi:red", warning: "ansi:brightYellow", keyword: "ansi:brightBlue", codeString: "ansi:brightMagenta" };
    case "forest":
      return light
        ? { accent: "ansi:green", accentMuted: "ansi:cyan", warning: "ansi:red", keyword: "ansi:blue", codeString: "ansi:magenta" }
        : { accent: "ansi:brightGreen", accentMuted: "ansi:green", warning: "ansi:yellow", keyword: "ansi:brightCyan", codeString: "ansi:green" };
    case "codex":
    default:
      return light
        ? { accent: "ansi:blue", accentMuted: "ansi:brightBlack", warning: "ansi:red", keyword: "ansi:blue", codeString: "ansi:green" }
        : { accent: "ansi:brightBlue", accentMuted: "ansi:blue", warning: "ansi:yellow", keyword: "ansi:brightBlue", codeString: "ansi:brightGreen" };
  }
}

function ansiTheme(colorScheme: ThemePreset, appearanceTheme: AppearanceThemePreset): ThemePreset {
  const light = appearanceTheme.id === "light-ansi";
  const colors = ansiSchemeColors(colorScheme, light);
  return {
    ...colorScheme,
    id: `${colorScheme.id}:${appearanceTheme.id}`,
    label: labelFor(colorScheme, appearanceTheme),
    accent: colors.accent,
    accentMuted: colors.accentMuted,
    foreground: light ? "ansi:black" : "ansi:brightWhite",
    dim: "ansi:brightBlack",
    background: light ? "ansi:brightWhite" : "ansi:black",
    border: light
      ? "ansi:brightBlack"
      : colorScheme.id === "claude"
        ? "ansi:white"
        : colorScheme.id === "codex"
          ? "ansi:brightBlack"
          : "ansi:blue",
    warning: colors.warning,
    keyword: colors.keyword,
    codeString: colors.codeString,
    subtle: light ? "ansi:brightBlack" : "ansi:brightBlack"
  };
}

export function applyAppearanceTheme(colorScheme: ThemePreset, appearanceTheme: AppearanceThemePreset): ThemePreset {
  switch (appearanceTheme.id) {
    case "dark":
      return { ...colorScheme, label: labelFor(colorScheme, appearanceTheme) };
    case "light":
      return lightTheme(colorScheme, appearanceTheme);
    case "dark-colorblind":
    case "light-colorblind":
      return colorblindTheme(colorScheme, appearanceTheme);
    case "dark-ansi":
    case "light-ansi":
      return ansiTheme(colorScheme, appearanceTheme);
  }
}

export const DEFAULT_THEME = applyAppearanceTheme(DEFAULT_COLOR_SCHEME, DEFAULT_APPEARANCE_THEME);
