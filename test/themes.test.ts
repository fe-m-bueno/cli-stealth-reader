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
