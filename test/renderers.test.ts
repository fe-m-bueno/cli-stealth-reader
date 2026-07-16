import test from "node:test";
import assert from "node:assert/strict";
import { fg } from "../src/color.js";
import { renderBlocks, renderWithDialogueHighlight } from "../src/renderers.js";
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

test("keeps quoted dialogue highlighted across wrapped lines", () => {
  const blocks: CanonicalBlock[] = [{
    id: "b1",
    type: "paragraph",
    text: 'Ela disse: "uma fala longa que precisa quebrar no meio da linha" depois.'
  }];
  const lines = renderBlocks(blocks, "plain", 26, DEFAULT_THEME);

  assert.equal(stripAnsi(lines[0] ?? ""), 'Ela disse: "uma fala longa');
  assert.ok(lines[0]?.includes(fg(DEFAULT_THEME.accent, '"uma fala longa')));

  assert.equal(stripAnsi(lines[1] ?? ""), "que precisa quebrar no");
  assert.equal(lines[1], fg(DEFAULT_THEME.accent, "que precisa quebrar no"));

  assert.equal(stripAnsi(lines[2] ?? ""), 'meio da linha" depois.');
  assert.ok(lines[2]?.includes(fg(DEFAULT_THEME.accent, 'meio da linha"')));
  assert.ok(lines[2]?.includes(fg(DEFAULT_THEME.foreground, " depois.")));
});

test("highlights em-dash dialogue only when it starts the paragraph", () => {
  const dialogue = renderPlainLine("— Vamos embora.");
  assert.ok(dialogue.includes(fg(DEFAULT_THEME.accent, "— Vamos embora.")));

  const narrative = renderPlainLine("Lista — item comum.");
  assert.ok(!narrative.includes(fg(DEFAULT_THEME.accent, "— item comum.")));
});

test("highlights common ebook dialogue dash variants", () => {
  const enDash = renderPlainLine("– Vamos embora.");
  assert.ok(enDash.includes(fg(DEFAULT_THEME.accent, "– Vamos embora.")));

  const horizontalBar = renderPlainLine("― Vamos embora.");
  assert.ok(horizontalBar.includes(fg(DEFAULT_THEME.accent, "― Vamos embora.")));
});

test("keeps wrapped em-dash dialogue highlighted", () => {
  const blocks: CanonicalBlock[] = [{
    id: "b1",
    type: "paragraph",
    text: "— Vamos embora antes que a chuva alcance a estrada de terra."
  }];
  const lines = renderBlocks(blocks, "plain", 24, DEFAULT_THEME);

  assert.equal(stripAnsi(lines[0] ?? ""), "— Vamos embora antes que");
  assert.equal(lines[0], fg(DEFAULT_THEME.accent, "— Vamos embora antes que"));
  assert.equal(stripAnsi(lines[1] ?? ""), "a chuva alcance a");
  assert.equal(lines[1], fg(DEFAULT_THEME.accent, "a chuva alcance a"));
});

test("does not treat apostrophes inside words or one-letter elisions as dialogue", () => {
  const contraction = renderWithDialogueHighlight("Don't stop believing.", DEFAULT_THEME);
  assert.equal(contraction, fg(DEFAULT_THEME.foreground, "Don't stop believing."));

  const elision = renderWithDialogueHighlight("rock 'n' roll", DEFAULT_THEME);
  assert.equal(elision, fg(DEFAULT_THEME.foreground, "rock 'n' roll"));

  const quoted = renderWithDialogueHighlight("Ele respondeu 'sim' e saiu.", DEFAULT_THEME);
  assert.ok(quoted.includes(fg(DEFAULT_THEME.accent, "'sim'")));
});

test("supports curved quotes and guillemets without splitting nested spans", () => {
  const curved = renderWithDialogueHighlight("Ela disse “olá ‘amigo’” agora.", DEFAULT_THEME);
  assert.ok(curved.includes(fg(DEFAULT_THEME.accent, "“olá ‘amigo’”")));

  const guillemet = renderWithDialogueHighlight("Ele leu «bonjour».", DEFAULT_THEME);
  assert.ok(guillemet.includes(fg(DEFAULT_THEME.accent, "«bonjour»")));
});

test("keeps quote spans aligned after surrogate-pair characters", () => {
  const line = renderWithDialogueHighlight('🙂 Ela disse "oi".', DEFAULT_THEME);
  assert.ok(line.includes(fg(DEFAULT_THEME.foreground, "🙂 Ela disse ")));
  assert.ok(line.includes(fg(DEFAULT_THEME.accent, '"oi"')));
  assert.ok(line.includes(fg(DEFAULT_THEME.foreground, ".")));
});

test("ignores escaped quote delimiters and unterminated quotes", () => {
  const escaped = renderWithDialogueHighlight('Literal \\"sem fala\\" aqui.', DEFAULT_THEME);
  assert.equal(escaped, fg(DEFAULT_THEME.foreground, 'Literal \\"sem fala\\" aqui.'));

  const unterminated = renderWithDialogueHighlight('Ela disse "sem fim.', DEFAULT_THEME);
  assert.equal(unterminated, fg(DEFAULT_THEME.foreground, 'Ela disse "sem fim.'));
});

test("keeps blockquote rendering with quote marker", () => {
  const blocks: CanonicalBlock[] = [{ id: "b1", type: "blockquote", text: "Trecho citado" }];
  const lines = renderBlocks(blocks, "plain", 120, DEFAULT_THEME);
  assert.equal(stripAnsi(lines[0] ?? ""), "❝ Trecho citado");
});

test("does not apply dialogue highlight in code mode", () => {
  const blocks: CanonicalBlock[] = [{ id: "b1", type: "paragraph", text: 'Ela disse: "Oi".' }];
  const lines = renderBlocks(blocks, "code", 120, DEFAULT_THEME);
  assert.equal(stripAnsi(lines.join("\n")).includes('\\"Oi\\"'), true);
  assert.equal(lines.some((line) => line.includes(fg(DEFAULT_THEME.accent, '"Oi"'))), false);
});

test("preserves list prefix when dialogue highlight is enabled", () => {
  const blocks: CanonicalBlock[] = [{ id: "b1", type: "list-item", text: '"Oi" na lista' }];
  const lines = renderBlocks(blocks, "plain", 120, DEFAULT_THEME);
  assert.equal(stripAnsi(lines[0] ?? ""), '· "Oi" na lista');
  assert.ok(lines[0]?.includes(fg(DEFAULT_THEME.accent, '"Oi"')));
});

test("search highlighting still works on dialogue-highlighted plain lines", () => {
  const blocks: CanonicalBlock[] = [{ id: "b1", type: "paragraph", text: 'Ela disse: "Oi".' }];
  const lines = renderBlocks(
    blocks,
    "plain",
    120,
    DEFAULT_THEME,
    "typescript",
    3,
    "Oi"
  );
  assert.equal(stripAnsi(lines[0] ?? ""), 'Ela disse: "Oi".');
  assert.ok((lines[0] ?? "").includes("\x1b[48;2;244;184;96m"));
});

test("supports disabling dialogue highlight in plain mode", () => {
  const line = renderPlainLine('Ela disse: "Oi".', false);
  assert.equal(line, fg(DEFAULT_THEME.foreground, 'Ela disse: "Oi".'));
});

test("line spacing changes the rendered distance between blocks", () => {
  const blocks: CanonicalBlock[] = [
    { id: "b1", type: "paragraph", text: "First" },
    { id: "b2", type: "paragraph", text: "Second" }
  ];
  const render = (lineSpacing: "compact" | "normal" | "relaxed") => renderBlocks(
    blocks,
    "plain",
    80,
    DEFAULT_THEME,
    "typescript",
    3,
    undefined,
    true,
    0,
    true,
    lineSpacing
  );

  assert.equal(render("compact").length, 2);
  assert.equal(render("normal").length, 4);
  assert.equal(render("relaxed").length, 6);
});

test("relaxed line spacing separates wrapped lines inside a paragraph", () => {
  const blocks: CanonicalBlock[] = [
    { id: "b1", type: "paragraph", text: "one two three four five six seven eight" }
  ];
  const normal = renderBlocks(blocks, "plain", 12, DEFAULT_THEME);
  const relaxed = renderBlocks(
    blocks,
    "plain",
    12,
    DEFAULT_THEME,
    "typescript",
    3,
    undefined,
    true,
    0,
    true,
    "relaxed"
  );

  assert.ok(relaxed.length > normal.length);
  assert.equal(stripAnsi(relaxed[1] ?? ""), "");
});
