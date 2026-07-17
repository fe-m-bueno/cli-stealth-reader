import test from "node:test";
import assert from "node:assert/strict";
import { fuzzyScore, fuzzyFilter } from "../src/fuzzy.js";

test("fuzzyScore matches subsequences case-insensitively", () => {
  assert.ok(fuzzyScore("dn", "Dune") !== null);
  assert.ok(fuzzyScore("dune", "Dune") !== null);
  assert.equal(fuzzyScore("dux", "Dune"), null);
});

test("fuzzyScore prefers contiguous and word-start matches", () => {
  const contiguous = fuzzyScore("dun", "Dune")!;
  const scattered = fuzzyScore("dun", "dragon universe")!;
  assert.ok(contiguous > scattered, `expected ${contiguous} > ${scattered}`);
});

test("empty query matches everything with neutral score", () => {
  assert.ok(fuzzyScore("", "anything") !== null);
});

test("fuzzyFilter sorts by score and keeps original items", () => {
  const items = ["dragon universe", "Dune", "sand"];
  const result = fuzzyFilter("dun", items, (item) => item);
  assert.deepEqual(result, ["Dune", "dragon universe"]);
});

test("fuzzyFilter with empty query preserves original order", () => {
  const items = ["b", "a", "c"];
  assert.deepEqual(fuzzyFilter("", items, (item) => item), items);
});
