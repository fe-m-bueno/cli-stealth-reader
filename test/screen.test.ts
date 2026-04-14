import test from "node:test";
import assert from "node:assert/strict";
import { fg } from "../src/color.js";
import { renderFooter, stripAnsi, truncate } from "../src/screen.js";
import type { AppState, ThemePreset } from "../src/types.js";

test("truncate preserves visible colored text instead of cutting it at ansi boundaries", () => {
  const colored = `${fg("#88ccff", "›")} ${fg("#8b949e", "[ ]")} ${fg("#88ccff", "alpha.epub")}`;
  const truncated = truncate(colored, 18);
  assert.match(truncated, /alpha/);
});

const theme: ThemePreset = {
  id: "codex",
  label: "Codex",
  accent: "#88ccff",
  accentMuted: "#6699cc",
  foreground: "#d0d7de",
  dim: "#8b949e",
  background: "#0d1117",
  border: "#30363d",
  warning: "#d29922",
  keyword: "#ff7b72",
  codeString: "#a5d6ff",
  subtle: "#6e7681"
};

test("command footer renders a boxed prompt with command suggestions", () => {
  const state = {
    theme,
    commandMode: true,
    commandBuffer: "mo",
    commandSuggestionIndex: 0,
    currentBook: null,
    progressVisibility: "hidden",
    status: "Ready",
    chapterIndex: 0,
    blockOffset: 0
  } as AppState;

  const footer = renderFooter(state, 80).map(stripAnsi);
  assert.match(footer[0], /╭/);
  assert.match(footer[1], /\/mo/);
  assert.ok(footer.some((line) => line.includes("/mode")));
});

test("normal footer keeps progress on a separate bottom-right line", () => {
  const state = {
    theme,
    commandMode: false,
    commandBuffer: "",
    commandSuggestionIndex: 0,
    currentBook: {
      id: "book",
      title: "Book",
      author: "Anon",
      sourcePath: "/tmp/book.epub",
      importHash: "hash",
      diagnostics: [],
      chapters: [
        { id: "ch-1", index: 0, title: "One", href: "one", depth: 0, blocks: [{ id: "b1", type: "paragraph", text: "hello" }], wordCount: 1 },
        { id: "ch-2", index: 1, title: "Two", href: "two", depth: 0, blocks: [{ id: "b2", type: "paragraph", text: "world" }], wordCount: 1 }
      ]
    },
    progressVisibility: "book",
    status: "Opened Book",
    chapterIndex: 0,
    blockOffset: 0
  } as AppState;

  const footer = renderFooter(state, 80).map(stripAnsi);
  assert.equal(footer.length, 2);
  assert.match(footer[0], /Opened Book/);
  assert.match(footer[1], /book/);
  assert.ok(footer[1].startsWith(" "));
});
