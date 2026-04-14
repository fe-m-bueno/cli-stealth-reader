import test from "node:test";
import assert from "node:assert/strict";
import { extractBlocksFromHtml } from "../src/parser/html.js";

test("keeps drop caps attached to the following word", () => {
  const blocks = extractBlocksFromHtml(
    '<!doctype html><html><body><p><span class="cap">Q</span>uando <span>E</span>ra noite</p></body></html>',
    "fixture"
  );
  assert.deepEqual(blocks.map((block) => block.text), ["Quando Era noite"]);
});

test("skips decorative icon-only paragraphs", () => {
  const blocks = extractBlocksFromHtml(
    '<!doctype html><html><body><p></p><p>Texto real.</p></body></html>',
    "fixture"
  );
  assert.deepEqual(blocks.map((block) => block.text), ["Texto real."]);
});
