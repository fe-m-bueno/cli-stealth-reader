import test from "node:test";
import assert from "node:assert/strict";
import { stripAnsi } from "../src/screen.js";
import {
  openShortcutHelp,
  renderShortcutPanel,
  shortcutModalGeometry,
  shortcutModalHitTest,
  shortcutPanelRows,
  toggleShortcutCategory
} from "../src/shortcuts-panel.js";
import type { AppState, ThemePreset } from "../src/types.js";

const theme: ThemePreset = {
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
};

function state(): AppState {
  return {
    theme,
    overlay: "none",
    overlayCursor: 0,
    commandMode: false,
    commandBuffer: "",
    commandCursor: 0,
    commandSuggestionIndex: 0,
    status: "Ready"
  } as AppState;
}

test("shortcut help opens as a centered modal with Grok-style grouped rows", () => {
  const app = state();
  openShortcutHelp(app);

  const rendered = renderShortcutPanel(app, 100, 30).map(stripAnsi).join("\n");
  assert.match(rendered, /Keyboard Shortcuts/);
  assert.match(rendered, /Essentials/);
  assert.match(rendered, /Ctrl\+\. \/ Ctrl\+X/);
  assert.match(rendered, /Open tabbed reader settings with live preview/);
  assert.match(rendered, /Shift\+S/);
  assert.doesNotMatch(rendered, /\sS\s/);
  assert.match(rendered, /Navigation \(13\)/);
  assert.match(rendered, /View \(6\)/);
  assert.match(rendered, /↑\/↓:nav/);
  assert.match(rendered, /Enter\/Space:expand/);
});

test("shortcut modal keeps the selected row visible while expanded groups scroll", () => {
  const app = state();
  openShortcutHelp(app);
  toggleShortcutCategory(app, "navigation");
  toggleShortcutCategory(app, "commands");
  toggleShortcutCategory(app, "view");
  const rows = shortcutPanelRows(app);
  app.overlayCursor = rows.length - 1;

  const rendered = renderShortcutPanel(app, 70, 18).map(stripAnsi).join("\n");
  assert.match(rendered, /Autocomplete or cycle command/);
  assert.match(rendered, /█/);
});

test("shortcut search filters descriptions and ignores collapsed groups", () => {
  const app = state();
  openShortcutHelp(app);
  app.shortcutSearchBuffer = "focus mode";

  const rows = shortcutPanelRows(app);
  assert.equal(rows.some((row) => row.label.includes("Toggle focus mode")), true);
  assert.equal(rows.some((row) => row.kind === "shortcut" && row.category === "navigation"), false);
});

test("shortcut search footer explains that Escape exits search before closing", () => {
  const app = state();
  openShortcutHelp(app);
  app.shortcutSearchMode = true;

  const rendered = renderShortcutPanel(app, 100, 30).map(stripAnsi).join("\n");
  assert.match(rendered, /Esc:exit search/);
  assert.match(rendered, /Esc again:close/);
});

test("shortcut modal exposes clickable close and row hit areas", () => {
  const app = state();
  openShortcutHelp(app);
  const geometry = shortcutModalGeometry(100, 30);

  assert.deepEqual(
    shortcutModalHitTest(app, 100, 30, geometry.x + geometry.width - 3, geometry.y),
    { kind: "close" }
  );
  assert.deepEqual(
    shortcutModalHitTest(app, 100, 30, geometry.x + 2, geometry.entriesY),
    { kind: "row", index: 0 }
  );
  assert.equal(shortcutModalHitTest(app, 100, 30, geometry.x - 1, geometry.entriesY), null);
  assert.equal(shortcutModalHitTest(app, 100, 30, geometry.x + geometry.width + 1, geometry.entriesY), null);
});
