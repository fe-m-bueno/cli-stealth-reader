import test from "node:test";
import assert from "node:assert/strict";
import { fg } from "../src/color.js";
import {
  computeBookProgress,
  computeChapterProgress,
  computeWindowStart,
  getScrollbarMetrics,
  renderFooter,
  renderFrame,
  renderStatusBar,
  renderScrollbar,
  scrollbarOffsetFromThumb,
  screenResetSequence,
  stripAnsi,
  truncate
} from "../src/screen.js";
import { currentLines } from "../src/tui.js";
import type { AppState, ThemePreset } from "../src/types.js";

test("truncate preserves visible colored text instead of cutting it at ansi boundaries", () => {
  const colored = `${fg("#88ccff", "›")} ${fg("#8b949e", "[ ]")} ${fg("#88ccff", "alpha.epub")}`;
  const truncated = truncate(colored, 18);
  assert.match(truncated, /alpha/);
});

test("incremental redraws avoid full screen clears", () => {
  assert.equal(screenResetSequence(false), "\x1b[H");
  assert.equal(screenResetSequence(true), "\x1b[2J\x1b[H");
});

test("full frame rendering pads lines without erase sequences", () => {
  const frame = renderFrame(["abc", "x"], 4, 3);
  assert.equal(frame, "\x1b[Habc \nx   \n    ");
});

test("frame rendering can paint a stable background across colored segments", () => {
  const frame = renderFrame([`${fg("#ffffff", "x")}y`], 3, 1, "#000000", "#111111");
  assert.match(frame, /\x1b\[48;2;0;0;0m/);
  assert.match(frame, /\x1b\[38;2;17;17;17m/);
  assert.match(frame, /\x1b\[0m\x1b\[48;2;0;0;0m/);
});

test("scrollbar uses a full-height thumb when the chapter fits", () => {
  const scrollbar = renderScrollbar(5, 5, 0, theme).map(stripAnsi);
  assert.deepEqual(scrollbar, ["█", "█", "█", "█", "█"]);
});

test("scrollbar thumb moves to reflect chapter position", () => {
  const top = renderScrollbar(20, 5, 0, theme).map(stripAnsi);
  const bottom = renderScrollbar(20, 5, 15, theme).map(stripAnsi);

  assert.deepEqual(top, ["█", "│", "│", "│", "│"]);
  assert.deepEqual(bottom, ["│", "│", "│", "│", "█"]);
});

test("overlay window keeps the cursor visible", () => {
  assert.equal(computeWindowStart(50, 10, 0), 0);
  assert.equal(computeWindowStart(50, 10, 25), 20);
  assert.equal(computeWindowStart(50, 10, 49), 40);
});

test("scrollbar offset mapping follows thumb geometry", () => {
  const metrics = getScrollbarMetrics(100, 10, 45);
  const offset = scrollbarOffsetFromThumb(100, 10, metrics.thumbOffset);
  assert.ok(Math.abs(offset - 45) <= 5);
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

  const footer = renderFooter(state, 80, "book ███ 50%").map(stripAnsi);
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

  const footer = renderFooter(state, 80, "book ███ 50%").map(stripAnsi);
  assert.equal(footer.length, 2);
  assert.match(footer[0], /Opened Book/);
  assert.match(footer[1], /book/);
  assert.ok(footer[1].startsWith(" "));
});

test("overlay footer advertises escape close hint", () => {
  const state = {
    theme,
    commandMode: false,
    commandBuffer: "",
    commandSuggestionIndex: 0,
    currentBook: null,
    progressVisibility: "hidden",
    status: "Opened keyboard shortcuts",
    overlay: "keys",
    chapterIndex: 0,
    blockOffset: 0
  } as AppState;

  const footer = renderFooter(state, 100).map(stripAnsi);
  assert.match(footer[0], /Esc close/);
});

test("focus mode footer advertises escape exit hint", () => {
  const state = {
    theme,
    commandMode: false,
    commandBuffer: "",
    commandSuggestionIndex: 0,
    currentBook: null,
    progressVisibility: "hidden",
    status: "Focus mode enabled",
    overlay: "none",
    focusMode: true,
    chapterIndex: 0,
    blockOffset: 0
  } as AppState;

  const footer = renderFooter(state, 100).map(stripAnsi);
  assert.match(footer[0], /Esc exit focus/);
});

test("overlay footer close hint takes precedence over focus mode exit hint", () => {
  const state = {
    theme,
    commandMode: false,
    commandBuffer: "",
    commandSuggestionIndex: 0,
    currentBook: null,
    progressVisibility: "hidden",
    status: "Opened keyboard shortcuts",
    overlay: "keys",
    focusMode: true,
    chapterIndex: 0,
    blockOffset: 0
  } as AppState;

  const footer = renderFooter(state, 100).map(stripAnsi);
  assert.match(footer[0], /Esc close/);
  assert.doesNotMatch(footer[0], /Esc exit focus/);
});

test("normal footer does not show escape close hint", () => {
  const state = {
    theme,
    commandMode: false,
    commandBuffer: "",
    commandSuggestionIndex: 0,
    currentBook: null,
    progressVisibility: "hidden",
    status: "Ready",
    overlay: "none",
    chapterIndex: 0,
    blockOffset: 0
  } as AppState;

  const footer = renderFooter(state, 100).map(stripAnsi);
  assert.doesNotMatch(footer[0], /Esc close/);
  assert.doesNotMatch(footer[0], /Esc exit focus/);
});

test("status bar includes chapter title and focus block cue", () => {
  const state = readingState({
    focusMode: true,
    focusBlockIndex: 2,
    chapterIndex: 0
  });

  const status = stripAnsi(renderStatusBar(state, 100));
  assert.match(status, /Book · Ch 1\/2 · One/);
  assert.match(status, /plain · focus §3 · Codex/);
});

test("focus mode renders a compact context hint above the focused block", () => {
  const state = readingState({ focusMode: true, focusBlockIndex: 1 });

  const lines = currentLines(state, 80, 10).map(stripAnsi).filter((line) => line.trim());

  assert.match(lines[0]!, /FOCUS · Ch 1\/2 One · § 2\/3 · j\/k next · Esc exit/);
  assert.match(lines.join("\n"), /second paragraph/);
  assert.doesNotMatch(lines.join("\n"), /first paragraph/);
});

test("progress uses rendered viewport lines instead of raw block count", () => {
  const longParagraph = Array.from({ length: 120 }, (_, index) => `word${index}`).join(" ");
  const state = {
    theme,
    renderMode: "plain",
    commandMode: false,
    commandBuffer: "",
    commandSuggestionIndex: 0,
    progressVisibility: "both",
    status: "Reading",
    chapterIndex: 0,
    blockOffset: 4,
    layoutMetrics: null,
    currentBook: {
      id: "book",
      title: "Book",
      author: "Anon",
      sourcePath: "/tmp/book.epub",
      importHash: "hash",
      diagnostics: [],
      chapters: [
        { id: "ch-1", index: 0, title: "One", href: "one", depth: 0, blocks: [{ id: "b1", type: "paragraph", text: longParagraph }], wordCount: 120 },
        { id: "ch-2", index: 1, title: "Two", href: "two", depth: 0, blocks: [{ id: "b2", type: "paragraph", text: "short text" }], wordCount: 2 }
      ]
    }
  } as AppState;

  const chapterProgress = computeChapterProgress(state, 20, 6);
  const bookProgressNearChapterEnd = computeBookProgress(state, 20, 6);

  assert.ok(chapterProgress > 0);
  assert.ok(chapterProgress < 1);

  state.chapterIndex = 1;
  state.blockOffset = 0;
  const bookProgressNextChapterStart = computeBookProgress(state, 20, 6);

  assert.ok(bookProgressNextChapterStart >= bookProgressNearChapterEnd);
});

function readingState(overrides: Partial<AppState> = {}): AppState {
  return {
    theme,
    renderMode: "plain",
    codeLanguage: "typescript",
    codeDensity: 3,
    plainHighlight: true,
    commandMode: false,
    commandBuffer: "",
    commandSuggestionIndex: 0,
    progressVisibility: "book",
    status: "Reading",
    overlay: "none",
    focusMode: false,
    focusBlockIndex: 0,
    chapterIndex: 0,
    blockOffset: 0,
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
