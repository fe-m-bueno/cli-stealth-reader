import test from "node:test";
import assert from "node:assert/strict";
import { bg, fg } from "../src/color.js";
import { APPEARANCE_THEMES, THEMES, applyAppearanceTheme } from "../src/themes.js";
import type { AppearanceThemeId, ThemePreset } from "../src/types.js";

function scheme(id: string): ThemePreset {
  const found = THEMES.find((item) => item.id === id);
  assert.ok(found);
  return found;
}

function appearance(id: AppearanceThemeId) {
  const found = APPEARANCE_THEMES.find((item) => item.id === id);
  assert.ok(found);
  return found;
}

test("dark appearance preserves the selected colorscheme", () => {
  const colorScheme = scheme("codex");
  assert.deepEqual(applyAppearanceTheme(colorScheme, appearance("dark")), colorScheme);
});

test("codex matches the installed CLI's monochrome and blue visual tokens", () => {
  const codex = scheme("codex");

  assert.equal(codex.accent, "#3b82f6");
  assert.equal(codex.foreground, "#ffffff");
  assert.equal(codex.background, "#0d0d0d");
  assert.equal(codex.border, "#5d5d5d");
});

test("claude uses Claude Code's dark truecolor role palette", () => {
  const claude = scheme("claude");

  assert.equal(claude.accent, "#d77757");
  assert.equal(claude.foreground, "#ffffff");
  assert.equal(claude.background, "#0d0d0d");
  assert.equal(claude.warning, "#ffc107");
  assert.equal(claude.keyword, "#b1b9f9");
  assert.equal(claude.codeString, "#4eba65");
  assert.equal(claude.subtle, "#505050");
});

test("light appearance adapts each colorscheme for a chalk background", () => {
  const codex = applyAppearanceTheme(scheme("codex"), appearance("light"));
  const amber = applyAppearanceTheme(scheme("amber"), appearance("light"));

  assert.equal(codex.background, "#f7f2e4");
  assert.equal(amber.background, "#f7f2e4");
  assert.notEqual(codex.accent, amber.accent);
});

test("colorblind appearance still varies by active colorscheme", () => {
  const codex = applyAppearanceTheme(scheme("codex"), appearance("dark-colorblind"));
  const forest = applyAppearanceTheme(scheme("forest"), appearance("dark-colorblind"));

  assert.equal(codex.background, forest.background);
  assert.notEqual(codex.accent, forest.accent);
});

test("ansi appearances use standard ansi color escapes", () => {
  const theme = applyAppearanceTheme(scheme("forest"), appearance("dark-ansi"));
  const rendered = `${fg(theme.accent, "x")}${bg(theme.background, "y")}`;

  assert.equal(theme.accent, "ansi:brightGreen");
  assert.match(rendered, /\x1b\[[0-9]+m/);
  assert.doesNotMatch(rendered, /38;2|48;2/);
});

test("claude keeps its coral identity in accessibility variants", () => {
  const colorblind = applyAppearanceTheme(scheme("claude"), appearance("dark-colorblind"));
  const ansi = applyAppearanceTheme(scheme("claude"), appearance("dark-ansi"));

  assert.equal(colorblind.accent, "#e69f00");
  assert.equal(ansi.accent, "ansi:brightRed");
  assert.equal(ansi.border, "ansi:white");
  assert.equal(ansi.keyword, "ansi:brightBlue");
  assert.equal(ansi.codeString, "ansi:brightGreen");
});
