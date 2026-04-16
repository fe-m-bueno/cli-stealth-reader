import test from "node:test";
import assert from "node:assert/strict";
import { applyCommandAutocomplete, commandHelp, listCommandSuggestions, parseSlashCommand } from "../src/commands.js";
import { stripAnsi } from "../src/screen.js";
import type { ThemePreset } from "../src/types.js";

test("parses args and flags", () => {
  const parsed = parseSlashCommand("/colorscheme amber --preview --list");
  assert.equal(parsed.name, "colorscheme");
  assert.deepEqual(parsed.args, ["amber"]);
  assert.equal(parsed.flags.preview, true);
  assert.equal(parsed.flags.list, true);
});

test("supports quoted args", () => {
  const parsed = parseSlashCommand('/changebook "The Hobbit" --recent');
  assert.equal(parsed.name, "changebook");
  assert.deepEqual(parsed.args, ["The Hobbit"]);
  assert.equal(parsed.flags.recent, true);
});

test("fails on unknown flags", () => {
  assert.throws(() => parseSlashCommand("/next --bogus"), /Unknown flag/);
});

test("parses /search with short global flag", () => {
  const parsed = parseSlashCommand("/search -g foo bar");
  assert.equal(parsed.name, "search");
  assert.deepEqual(parsed.args, ["foo", "bar"]);
  assert.equal(parsed.flags.global, true);
});

test("parses /goto percentage and chapter flag", () => {
  const parsed = parseSlashCommand("/goto 12% --chapter");
  assert.equal(parsed.name, "goto");
  assert.deepEqual(parsed.args, ["12%"]);
  assert.equal(parsed.flags.chapter, true);
});

test("parses /highlight with on/off argument", () => {
  const parsed = parseSlashCommand("/highlight off");
  assert.equal(parsed.name, "highlight");
  assert.deepEqual(parsed.args, ["off"]);
  assert.deepEqual(parsed.flags, {});
});

test("parses /settings and /config alias", () => {
  assert.equal(parseSlashCommand("/settings").name, "settings");
  assert.equal(parseSlashCommand("/config").name, "settings");
});

test("parses bookmark commands", () => {
  const mark = parseSlashCommand('/mark "Ponto importante"');
  assert.equal(mark.name, "mark");
  assert.deepEqual(mark.args, ["Ponto importante"]);

  const marks = parseSlashCommand("/marks");
  assert.equal(marks.name, "marks");

  const delmark = parseSlashCommand("/delmark Ch.3");
  assert.equal(delmark.name, "delmark");
  assert.deepEqual(delmark.args, ["Ch.3"]);
});

test("lists all commands when the slash buffer is empty", () => {
  const suggestions = listCommandSuggestions("");
  assert.ok(suggestions.length > 5);
  assert.equal(suggestions[0]?.name, "add");
});

test("filters command suggestions by prefix and aliases", () => {
  const byName = listCommandSuggestions("mod");
  assert.deepEqual(byName.map((item) => item.name), ["mode"]);

  const byTheme = listCommandSuggestions("theme");
  assert.deepEqual(byTheme.map((item) => item.name), ["theme"]);

  const byAlias = listCommandSuggestions("conf");
  assert.deepEqual(byAlias.map((item) => item.name), ["settings"]);
  assert.equal(byAlias[0]?.matchedAlias, "config");
});

test("applies autocomplete to the command token only", () => {
  const suggestion = listCommandSuggestions("re")[0];
  assert.equal(applyCommandAutocomplete("re", suggestion), "remove");
  assert.equal(applyCommandAutocomplete("re current-book", suggestion), "remove current-book");
});

test("renders full manual help with examples", () => {
  const lines = commandHelp();
  assert.ok(lines.includes("CLI-STEALTH-READER(1)"));
  assert.ok(lines.includes("COMMANDS"));
  assert.ok(lines.includes("/MODE(1)"));
  assert.ok(lines.includes("EXAMPLES"));
  assert.ok(lines.includes("  /mode typescript"));
});

test("renders manual page for the theme command", () => {
  const lines = commandHelp("theme");
  assert.ok(lines.includes("/THEME(1)"));
  assert.ok(lines.includes("  /theme light"));
  assert.ok(lines.includes("  /theme dark-colorblind"));
});

test("wraps manual help to the viewport width", () => {
  const lines = commandHelp(undefined, 48);
  assert.ok(lines.length > commandHelp().length);
  assert.ok(lines.every((line) => line.length <= 48));
  assert.ok(lines.some((line) => line.trim() === "The selected mode is saved and reused the next"));
});

test("styles manual titles commands and flags when a theme is provided", () => {
  const lines = commandHelp("search", 80, theme);
  assert.ok(lines.some((line) => line.includes("\x1b[1m/SEARCH(1)\x1b[0m")));
  assert.ok(lines.some((line) => line.includes("\x1b[1m\x1b[38;2;89;208;255m/search\x1b[0m\x1b[0m")));
  assert.ok(lines.some((line) => line.includes("\x1b[38;2;244;184;96m--global\x1b[0m")));
  assert.ok(lines.every((line) => stripAnsi(line).length <= 80));
});

const theme: ThemePreset = {
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
};
