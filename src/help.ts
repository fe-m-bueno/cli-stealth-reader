export const KEYBOARD_SHORTCUTS: Array<{ category: string; key: string; description: string }> = [
  { category: "navigation", key: "j / ↓", description: "Scroll down" },
  { category: "navigation", key: "k / ↑", description: "Scroll up" },
  { category: "navigation", key: "space", description: "Page down / toggle picker selection" },
  { category: "navigation", key: "b", description: "Page up" },
  { category: "navigation", key: "g", description: "Jump to top" },
  { category: "navigation", key: "G", description: "Jump to bottom" },
  { category: "commands", key: "/", description: "Focus command bar" },
  { category: "commands", key: "Enter", description: "Run command / confirm picker" },
  { category: "commands", key: "Esc", description: "Close overlay or blur command input" },
  { category: "commands", key: "?", description: "Open keyboard shortcuts" },
  { category: "view", key: "Tab", description: "Cycle overlay selection / command completion" },
  { category: "view", key: "q", description: "Quit the reader" }
];
