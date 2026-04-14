import test from "node:test";
import assert from "node:assert/strict";
import { parseSlashCommand } from "../src/commands.js";

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
