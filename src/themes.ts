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
    border: "#1e3a45",
    warning: "#f4b860",
    keyword: "#7c9ebf",
    codeString: "#8fb573",
    subtle: "#3d5560"
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

export const DEFAULT_THEME = THEMES[0];
