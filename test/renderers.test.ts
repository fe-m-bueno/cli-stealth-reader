import test from "node:test";
import assert from "node:assert/strict";
import { fg } from "../src/color.js";
import { renderBlocks } from "../src/renderers.js";
import { stripAnsi } from "../src/screen.js";
import { DEFAULT_THEME } from "../src/themes.js";
import type { CanonicalBlock } from "../src/types.js";

function renderPlainLine(text: string, plainHighlight = true): string {
  const blocks: CanonicalBlock[] = [{ id: "b1", type: "paragraph", text }];
  const lines = renderBlocks(
    blocks,
    "plain",
    120,
    DEFAULT_THEME,
    "typescript",
    3,
    undefined,
    plainHighlight
  );
  return lines[0] ?? "";
}

test("highlights quoted dialogue in plain mode", () => {
  const line = renderPlainLine('Ela disse: "Oi".');
  assert.ok(line.includes(fg(DEFAULT_THEME.foreground, "Ela disse: ")));
  assert.ok(line.includes(fg(DEFAULT_THEME.accent, '"Oi"')));
  assert.ok(line.includes(fg(DEFAULT_THEME.foreground, ".")));
});

test("highlights em-dash dialogue only when it starts the paragraph", () => {
  const dialogue = renderPlainLine("— Vamos embora.");
  assert.ok(dialogue.includes(fg(DEFAULT_THEME.accent, "— Vamos embora.")));

  const narrative = renderPlainLine("Lista — item comum.");
  assert.ok(!narrative.includes(fg(DEFAULT_THEME.accent, "— item comum.")));
});

test("keeps blockquote rendering with quote marker", () => {
  const blocks: CanonicalBlock[] = [{ id: "b1", type: "blockquote", text: "Trecho citado" }];
  const lines = renderBlocks(blocks, "plain", 120, DEFAULT_THEME);
  assert.equal(stripAnsi(lines[0] ?? ""), "❝ Trecho citado");
});

test("supports disabling dialogue highlight in plain mode", () => {
  const line = renderPlainLine('Ela disse: "Oi".', false);
  assert.equal(line, fg(DEFAULT_THEME.foreground, 'Ela disse: "Oi".'));
});
