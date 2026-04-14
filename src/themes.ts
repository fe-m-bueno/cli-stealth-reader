import type { ThemePreset } from "./types.js";

export const THEMES: ThemePreset[] = [
  {
    id: "codex",
    label: "Codex",
    accent: "#59d0ff",
    accentMuted: "#1f6f88",
    foreground: "#dce6ea",
    dim: "#6d7d84",
    background: "#0b1012",
    border: "#17313b",
    warning: "#f4b860"
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
    warning: "#f1b36a"
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
    warning: "#ffd166"
  },
  {
    id: "forest",
    label: "Forest",
    accent: "#7ce2a1",
    accentMuted: "#2d7047",
    foreground: "#dff6e6",
    dim: "#86a88e",
    background: "#0b120e",
    border: "#173521",
    warning: "#f2c97d"
  }
];

export const DEFAULT_THEME = THEMES[0];
