import test from "node:test";
import assert from "node:assert/strict";
import { applyCommandAutocomplete, listCommandSuggestions, parseSlashCommand } from "../src/commands.js";

test("parses args and flags", () => {
  const parsed = parseSlashCommand('/colorscheme amber --preview --list');
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
  const byName = listCommandSuggestions("mo");
  assert.deepEqual(byName.map((item) => item.name), ["mode"]);

  const byAlias = listCommandSuggestions("theme");
  assert.deepEqual(byAlias.map((item) => item.name), ["colorscheme"]);
});

test("applies autocomplete to the command token only", () => {
  const suggestion = listCommandSuggestions("re")[0];
  assert.equal(applyCommandAutocomplete("re", suggestion), "remove");
  assert.equal(applyCommandAutocomplete("re current-book", suggestion), "remove current-book");
});
