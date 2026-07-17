import test from "node:test";
import assert from "node:assert/strict";
import { renderFrame, resetRenderCache } from "../src/screen.js";
import { currentLines } from "../src/tui.js";
import { getFocusBlockLineCounts } from "../src/focus.js";
import { createEmptyPaceState } from "../src/reading-pace.js";
import type { AppState, ThemePreset } from "../src/types.js";

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

function readingState(overrides: Partial<AppState> = {}): AppState {
  return {
    theme,
    renderMode: "plain",
    codeLanguage: "typescript",
    codeDensity: 3,
    plainHighlight: true,
    fontScale: 1,
    marginSize: 0,
    lineSpacing: "normal",
    commandMode: false,
    commandBuffer: "",
    commandCursor: 0,
    commandSuggestionIndex: 0,
    progressVisibility: "book",
    readingPace: createEmptyPaceState(),
    status: "Reading",
    overlay: "none",
    focusMode: false,
    focusBlockIndex: 0,
    chapterIndex: 0,
    blockOffset: 0,
    layoutMetrics: null,
    chapterRenderCache: null,
    currentBook: {
      id: "book",
      title: "Book",
      author: "Anon",
      sourcePath: "/tmp/book.epub",
      importHash: "hash",
      diagnostics: [],
      chapters: [
        {
          id: "ch-1",
          index: 0,
          title: "One",
          href: "one",
          depth: 0,
          blocks: [
            { id: "b1", type: "paragraph", text: "first paragraph" },
            { id: "b2", type: "paragraph", text: "second paragraph" },
            { id: "b3", type: "paragraph", text: "third paragraph" }
          ],
          wordCount: 6
        },
        { id: "ch-2", index: 1, title: "Two", href: "two", depth: 0, blocks: [{ id: "b4", type: "paragraph", text: "world" }], wordCount: 1 }
      ]
    },
    ...overrides
  } as AppState;
}

test("currentLines memoizes the rendered chapter across repeated calls", () => {
  const state = readingState();
  const first = currentLines(state, 40, 20);
  const second = currentLines(state, 40, 20);

  assert.ok(state.chapterRenderCache, "expected the render cache to be populated");
  assert.equal(second, first, "expected the cached line array to be reused");
});

test("chapter render cache invalidates when a render input changes", () => {
  const state = readingState();
  const plain = currentLines(state, 40, 20);

  state.renderMode = "code";
  const code = currentLines(state, 40, 20);
  assert.notEqual(code, plain);
  assert.notDeepEqual(code, plain);

  const codeAgain = currentLines(state, 40, 20);
  assert.equal(codeAgain, code);

  const narrower = currentLines(state, 30, 20);
  assert.notEqual(narrower, codeAgain);

  state.chapterIndex = 1;
  const nextChapter = currentLines(state, 30, 20);
  assert.notEqual(nextChapter, narrower);
});

test("focus block line counts are memoized per layout key", () => {
  const state = readingState({ focusMode: true });
  const first = getFocusBlockLineCounts(state, 40);
  const second = getFocusBlockLineCounts(state, 40);
  assert.equal(second, first);

  const narrower = getFocusBlockLineCounts(state, 20);
  assert.notEqual(narrower, second);
  assert.equal(narrower.length, 3);
});

test("renderFrame repaints fully on first paint and after a resize", () => {
  resetRenderCache();
  assert.equal(renderFrame(["abc", "x"], 4, 3), "\x1b[Habc \nx   \n    ");
  assert.equal(renderFrame(["abc", "x"], 5, 3), "\x1b[Habc  \nx    \n     ");
});

test("renderFrame emits nothing when the frame is unchanged", () => {
  resetRenderCache();
  renderFrame(["abc", "x"], 4, 3);
  assert.equal(renderFrame(["abc", "x"], 4, 3), "");
});

test("renderFrame emits only the changed lines with cursor addressing", () => {
  resetRenderCache();
  renderFrame(["abc", "x"], 4, 3);
  const diff = renderFrame(["abc", "xy"], 4, 3);
  assert.equal(diff, "\x1b[2;1Hxy  \x1b[3;4H");
});

test("resetRenderCache forces the next paint to be a full frame", () => {
  resetRenderCache();
  renderFrame(["abc", "x"], 4, 3);
  resetRenderCache();
  assert.equal(renderFrame(["abc", "x"], 4, 3), "\x1b[Habc \nx   \n    ");
});
