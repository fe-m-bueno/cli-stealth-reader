import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { executeCommand } from "../src/executor.js";
import { handleInput, normalizeTerminalKey } from "../src/input.js";
import { createEmptyPaceState } from "../src/reading-pace.js";
import { computeChapterMaxOffset, footerHeight, getScrollbarMetrics, getViewportLayout, renderFooter, stripAnsi } from "../src/screen.js";
import { renderSettingsPanel } from "../src/settings-panel.js";
import { APPEARANCE_THEMES, THEMES } from "../src/themes.js";
import { renderOverlay } from "../src/tui.js";
import type { AppState, CanonicalBook, FolderDiscovery, ThemePreset } from "../src/types.js";

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

const discoveries: FolderDiscovery[] = [
  { path: "/tmp/alpha.epub", fileName: "alpha.epub" },
  { path: "/tmp/beta.epub", fileName: "beta.epub" },
  { path: "/tmp/gamma.epub", fileName: "gamma.epub" }
];

const currentBook: CanonicalBook = {
  id: "book-1",
  title: "Alpha",
  author: "Anon",
  sourcePath: "/tmp/alpha.epub",
  importHash: "hash",
  diagnostics: [],
  chapters: [
    { id: "ch-1", index: 0, title: "One", href: "one", depth: 0, blocks: [{ id: "b1", type: "paragraph", text: "one" }], wordCount: 1 },
    { id: "ch-2", index: 1, title: "Two", href: "two", depth: 0, blocks: [{ id: "b2", type: "paragraph", text: "two" }], wordCount: 1 },
    { id: "ch-3", index: 2, title: "Three", href: "three", depth: 0, blocks: [{ id: "b3", type: "paragraph", text: "three" }], wordCount: 1 }
  ]
};

const manyChaptersBook: CanonicalBook = {
  ...currentBook,
  chapters: Array.from({ length: 60 }, (_, index) => ({
    id: `ch-${index + 1}`,
    index,
    title: `Chapter ${index + 1}`,
    href: `chapter-${index + 1}`,
    depth: 0,
    blocks: [{ id: `b-${index + 1}`, type: "paragraph", text: `chapter ${index + 1}` }],
    wordCount: 2
  }))
};

const longChapterBook: CanonicalBook = {
  ...currentBook,
  chapters: [
    {
      id: "ch-long",
      index: 0,
      title: "Long",
      href: "long",
      depth: 0,
      blocks: [{
        id: "b-long",
        type: "paragraph",
        text: Array.from({ length: 1200 }, (_, index) => `word${index}`).join(" ")
      }],
      wordCount: 1200
    }
  ]
};

const multiChapterScrollBook: CanonicalBook = {
  ...currentBook,
  chapters: [
    longChapterBook.chapters[0]!,
    currentBook.chapters[1]!,
    currentBook.chapters[2]!
  ]
};

const focusBook: CanonicalBook = {
  ...currentBook,
  chapters: [
    {
      id: "ch-focus",
      index: 0,
      title: "Focus",
      href: "focus",
      depth: 0,
      blocks: [
        { id: "focus-1", type: "paragraph", text: "first" },
        { id: "focus-2", type: "paragraph", text: "second" },
        { id: "focus-3", type: "paragraph", text: "third" }
      ],
      wordCount: 3
    }
  ]
};

const baseBook = { id: "book-1", title: "Alpha", author: "Anon", sourcePath: "/tmp/alpha.epub", importHash: "hash", lastOpenedAt: 0, renderMode: "plain" as const };

function makeStorage(overrides: Partial<ReturnType<typeof makeStorageBase>> = {}) {
  return { ...makeStorageBase(), ...overrides } as AppState["storage"];
}

function makeStorageBase() {
  return {
    getPosition: () => null,
    saveBook: () => {},
    listBooks: () => [baseBook],
    listBooksWithProgress: () => [{ ...baseBook, chapterIndex: null, chapterTitle: null, bookProgress: null }],
    getBook: () => currentBook,
    removeBook: () => {},
    getLatestBookId: () => null,
    getSetting: () => null,
    setSetting: () => {},
    saveSettings: () => {},
    saveCommandHistory: () => {},
    savePosition: () => {},
    getSettings: () => ({
      themeId: "codex",
      appearanceThemeId: "dark",
      progressVisibility: "book",
      renderMode: "plain",
      codeLanguage: "typescript",
      codeDensity: 3,
      plainHighlight: true,
      fontScale: 1,
      marginSize: 0,
      lineSpacing: "normal",
      mouseCapture: false
    }),
    listBookmarks: () => [],
    addBookmark: () => ({ id: "", bookId: "", chapterIndex: 0, blockOffset: 0, label: null, createdAt: 0 }),
    deleteBookmark: () => {},
    listTagsByBookId: () => new Map<string, string[]>(),
    listTags: () => [] as string[],
    addTag: () => {},
    removeTag: () => {},
    listNotes: () => [],
    addNote: () => ({ id: "", bookId: "", chapterIndex: 0, blockOffset: 0, content: "", createdAt: 0 }),
    deleteNote: () => {}
  };
}

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    storage: makeStorage(),
    cwd: "/tmp",
    colorScheme: theme,
    appearanceTheme: APPEARANCE_THEMES[0]!,
    theme,
    renderMode: "plain",
    codeLanguage: "typescript",
    codeDensity: 3,
    plainHighlight: true,
    fontScale: 1,
    marginSize: 0,
    lineSpacing: "normal",
    progressVisibility: "book",
    readingPace: createEmptyPaceState(),
    currentBook: null,
    chapterIndex: 0,
    blockOffset: 0,
    commandBuffer: "",
    commandCursor: 0,
    commandMode: false,
    commandSuggestionIndex: 0,
    status: "",
    overlay: "file-picker",
    overlayCursor: 0,
    discoveries,
    shouldQuit: false,
    filePickerCursor: 0,
    filePickerItems: discoveries,
    filePickerSelected: new Set(),
    filePickerForce: false,
    chapterTransition: null,
    mouseDrag: null,
    layoutMetrics: null,
    searchState: null,
    navHistory: [],
    navHistoryCursor: -1,
    librarySortKey: "lastOpened",
    librarySortDir: "desc",
    booksTagFilter: null,
    booksTagMap: new Map<string, string[]>(),
    helpCommand: null,
    mouseCapture: false,
    focusMode: false,
    focusBlockIndex: 0,
    ...overrides
  };
}

async function withTempEpubDir<T>(files: string[], run: (dir: string) => Promise<T>): Promise<T> {
  const previousCwd = process.cwd();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stealth-reader-picker-"));
  for (const file of files) {
    await fs.writeFile(path.join(dir, file), "");
  }
  process.chdir(dir);
  try {
    return await run(dir);
  } finally {
    process.chdir(previousCwd);
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const redraw = () => {};
const noop = async () => {};

test("arrow down moves cursor", async () => {
  const state = makeState();
  await handleInput("\u001b[B", state, redraw, noop, () => {}, noop);
  assert.equal(state.filePickerCursor, 1);
});

test("SS3 arrow down moves cursor", async () => {
  const state = makeState();
  await handleInput("\u001bOB", state, redraw, noop, () => {}, noop);
  assert.equal(state.filePickerCursor, 1);
});

test("full Kitty arrow reports navigate every direction in the file picker", async () => {
  const state = makeState({ filePickerCursor: 1 });

  await handleInput("\u001b[1;1:1B", state, redraw, noop, () => {}, noop);
  assert.equal(state.filePickerCursor, 2);

  await handleInput("\u001b[1;1:1A", state, redraw, noop, () => {}, noop);
  assert.equal(state.filePickerCursor, 1);

  await handleInput("\u001b[1;1:1C", state, redraw, noop, () => {}, noop);
  assert.equal(state.filePickerCursor, 2);

  await handleInput("\u001b[1;1:1D", state, redraw, noop, () => {}, noop);
  assert.equal(state.filePickerCursor, 1);
});

test("arrow up does not go below 0", async () => {
  const state = makeState();
  await handleInput("\u001b[A", state, redraw, noop, () => {}, noop);
  assert.equal(state.filePickerCursor, 0);
});

test("j moves cursor down and k moves it up", async () => {
  const state = makeState();
  await handleInput("j", state, redraw, noop, () => {}, noop);
  assert.equal(state.filePickerCursor, 1);
  await handleInput("k", state, redraw, noop, () => {}, noop);
  assert.equal(state.filePickerCursor, 0);
});

test("space toggles the current selection", async () => {
  const state = makeState();
  await handleInput(" ", state, redraw, noop, () => {}, noop);
  assert.ok(state.filePickerSelected.has(0));
  await handleInput(" ", state, redraw, noop, () => {}, noop);
  assert.ok(!state.filePickerSelected.has(0));
});

test("cursor does not move past the last item", async () => {
  const state = makeState({ filePickerCursor: 2 });
  await handleInput("\u001b[B", state, redraw, noop, () => {}, noop);
  assert.equal(state.filePickerCursor, 2);
});

test("escape closes the picker", async () => {
  const state = makeState();
  await handleInput("\u001b", state, redraw, noop, () => {}, noop);
  assert.equal(state.overlay, "none");
});

test("enter with no selection confirms the cursor item", async () => {
  const confirmed: Array<{ paths: string[]; force: boolean }> = [];
  const state = makeState({ filePickerCursor: 1, filePickerForce: true });
  await handleInput("\r", state, redraw, noop, () => {}, async (paths, force) => {
    confirmed.push({ paths, force });
  });
  assert.deepEqual(confirmed, [{ paths: ["/tmp/beta.epub"], force: true }]);
  assert.equal(state.overlay, "none");
});

test("enter with selected items confirms all selections in order", async () => {
  const confirmed: Array<{ paths: string[]; force: boolean }> = [];
  const state = makeState({ filePickerSelected: new Set([2, 0]) });
  await handleInput("\r", state, redraw, noop, () => {}, async (paths, force) => {
    confirmed.push({ paths, force });
  });
  assert.deepEqual(confirmed, [{ paths: ["/tmp/alpha.epub", "/tmp/gamma.epub"], force: false }]);
  assert.equal(state.overlay, "none");
});

test("enter on the empty startup screen opens add flow when discoveries exist", async () => {
  const state = makeState({ overlay: "none" });
  const commands: string[] = [];
  await handleInput("\r", state, redraw, async (cmd) => {
    commands.push(cmd);
  }, () => {}, noop);
  assert.deepEqual(commands, ["/add"]);
});

test("add with no args opens the file picker instead of importing the first item", async () => {
  await withTempEpubDir(["alpha.epub", "beta.epub"], async (dir) => {
    const state = makeState({ overlay: "none", status: "Ready", cwd: "/stale", discoveries: [] });
    await executeCommand(state, "/add");
    assert.equal(state.overlay, "file-picker");
    assert.deepEqual(state.filePickerItems.map((item) => item.path), [
      path.join(dir, "alpha.epub"),
      path.join(dir, "beta.epub")
    ]);
    assert.equal(state.filePickerCursor, 0);
    assert.equal(state.filePickerSelected.size, 0);
    assert.equal(state.cwd, dir);
  });
});

test("add query with multiple matches opens a filtered picker", async () => {
  await withTempEpubDir(["alpine.epub", "alpha.epub", "beta.epub"], async () => {
    const state = makeState({
      overlay: "none",
      cwd: "/stale",
      discoveries: []
    });
    await executeCommand(state, "/add alp");
    assert.equal(state.overlay, "file-picker");
    assert.deepEqual(state.filePickerItems.map((item) => item.fileName), ["alpha.epub", "alpine.epub"]);
  });
});

test("add query with no matches opens an empty picker state", async () => {
  await withTempEpubDir(["alpha.epub"], async () => {
    const state = makeState({ overlay: "none", cwd: "/stale", discoveries: [] });
    await executeCommand(state, "/add zeta");
    assert.equal(state.overlay, "file-picker");
    assert.deepEqual(state.filePickerItems, []);
    assert.match(state.status, /No books matched "zeta"\./);
  });
});

test("changebook with no query opens the library picker instead of auto-opening the first book", async () => {
  const state = makeState({ overlay: "none", currentBook: null, status: "Ready" });
  await executeCommand(state, "/changebook");
  assert.equal(state.overlay, "books");
  assert.equal(state.currentBook, null);
  assert.equal(state.overlayCursor, 0);
});

test("slash opens command mode and tab autocompletes commands", async () => {
  const state = makeState({ overlay: "none" });
  await handleInput("/", state, redraw, noop, () => {}, noop);
  assert.equal(state.commandMode, true);

  await handleInput("m", state, redraw, noop, () => {}, noop);
  await handleInput("o", state, redraw, noop, () => {}, noop);
  await handleInput("d", state, redraw, noop, () => {}, noop);
  await handleInput("\t", state, redraw, noop, () => {}, noop);
  assert.equal(state.commandBuffer, "mode");
});

test("a second Tab completes the highlighted Toggl subcommand with a separator", async () => {
  const state = makeState({
    overlay: "none",
    commandMode: true,
    commandBuffer: "togg",
    commandCursor: 4,
    commandSuggestionIndex: 0
  });

  await handleInput("\t", state, redraw, noop, () => {}, noop);
  assert.equal(state.commandBuffer, "toggl");
  assert.equal(state.commandCursor, 5);

  await handleInput("\t", state, redraw, noop, () => {}, noop);
  assert.equal(state.commandBuffer, "toggl auth");
  assert.equal(state.commandCursor, 10);
});

test("entering slash command mode breaks the reading pace timing window", async () => {
  const state = makeState({
    overlay: "none",
    readingPace: createEmptyPaceState({ lastWordCursor: 100, lastSampleAt: 1_000 })
  });

  await handleInput("/", state, redraw, noop, () => {}, noop);

  assert.equal(state.commandMode, true);
  assert.equal(state.readingPace.lastSampleAt, null);
  assert.equal(state.readingPace.lastWordCursor, 100);
});

test("command mode left arrow moves cursor and backspace deletes before cursor", async () => {
  const state = makeState({ overlay: "none" });
  await handleInput("/", state, redraw, noop, () => {}, noop);
  for (const char of "toggl") await handleInput(char, state, redraw, noop, () => {}, noop);
  await handleInput("\u001b[D", state, redraw, noop, () => {}, noop);
  await handleInput("\u001b[D", state, redraw, noop, () => {}, noop);
  assert.equal(state.commandCursor, 3);
  await handleInput("\u007f", state, redraw, noop, () => {}, noop);
  assert.equal(state.commandBuffer, "togl");
  assert.equal(state.commandCursor, 2);
});

test("command mode inserts text at cursor", async () => {
  const state = makeState({ overlay: "none", commandMode: true, commandBuffer: "tggl", commandCursor: 1 });
  await handleInput("o", state, redraw, noop, () => {}, noop);
  assert.equal(state.commandBuffer, "toggl");
  assert.equal(state.commandCursor, 2);
});

test("question mark remains typable inside command mode", async () => {
  const state = makeState({ overlay: "none", commandMode: true, commandBuffer: "search ", commandCursor: 7 });

  await handleInput("?", state, redraw, noop, () => {}, noop);

  assert.equal(state.commandMode, true);
  assert.equal(state.commandBuffer, "search ?");
  assert.equal(state.overlay, "none");
});

test("Kitty-protocol Escape with an event type closes command mode", async () => {
  const state = makeState({
    overlay: "none",
    commandMode: true,
    commandBuffer: "commands",
    commandCursor: 8
  });

  await handleInput("\u001b[27;1:1u", state, redraw, noop, () => {}, noop);

  assert.equal(state.commandMode, false);
  assert.equal(state.commandBuffer, "commands");
});

test("event-typed Kitty control keys normalize without leaking terminal escapes", () => {
  assert.equal(normalizeTerminalKey("\u001b[27;1:1u"), "\u001b");
  assert.equal(normalizeTerminalKey("\u001b[46;5:1u"), "\u001b[46;5u");
  assert.equal(normalizeTerminalKey("\u001b[99;5:1u"), "\u0003");
  assert.equal(normalizeTerminalKey("\u001b[100;5:1u"), "\u0004");
  assert.equal(normalizeTerminalKey("\u001b[46;5:3u"), null);
});

test("full Kitty key reports normalize alternate keys and associated text", () => {
  assert.equal(normalizeTerminalKey("\u001b[27;1:1;27u"), "\u001b");
  assert.equal(normalizeTerminalKey("\u001b[46::46;5:1;46u"), "\u001b[46;5u");
});

test("command mode autocomplete replaces the token under the cursor and keeps the suffix", async () => {
  const state = makeState({
    overlay: "none",
    commandMode: true,
    commandBuffer: "modx foo",
    commandCursor: 3
  });

  await handleInput("\t", state, redraw, noop, () => {}, noop);

  assert.equal(state.commandBuffer, "mode foo");
  assert.equal(state.commandCursor, 4);
});

test("down arrow cycles command suggestions and keeps the selection visible", async () => {
  const state = makeState({ overlay: "none" });
  await handleInput("/", state, redraw, noop, () => {}, noop);
  for (let index = 0; index < 8; index += 1) {
    await handleInput("\u001b[B", state, redraw, noop, () => {}, noop);
  }
  assert.ok(state.commandSuggestionIndex >= 7);
});

test("page up and page down scroll the current chapter", async () => {
  const state = makeState({ overlay: "none", currentBook, blockOffset: 10 });
  await handleInput("\u001b[5~", state, redraw, noop, () => {}, noop);
  assert.equal(state.blockOffset, 0);

  await handleInput("\u001b[6~", state, redraw, noop, () => {}, noop);
  assert.ok(state.blockOffset > 0);
});

test("normal reader maps k forward and j backward", async () => {
  const state = makeState({ overlay: "none", currentBook: longChapterBook, blockOffset: 1 });

  await handleInput("k", state, redraw, noop, () => {}, noop);
  assert.equal(state.blockOffset, 2);

  await handleInput("j", state, redraw, noop, () => {}, noop);
  assert.equal(state.blockOffset, 1);
});

test("normal reader handles buffered j and k input", async () => {
  const state = makeState({ overlay: "none", currentBook: longChapterBook, blockOffset: 1 });

  await handleInput("kkj", state, redraw, noop, () => {}, noop);
  assert.equal(state.blockOffset, 2);
});

test("bundled alternate-scroll arrows scroll the current chapter", async () => {
  const state = makeState({ overlay: "none", currentBook: longChapterBook, blockOffset: 0 });
  await handleInput("\u001bOB\u001bOB\u001bOB", state, redraw, noop, () => {}, noop);
  assert.equal(state.blockOffset, 3);
});

test("bundled alternate-scroll arrows scroll the help manual", async () => {
  const state = makeState({ overlay: "none", currentBook: longChapterBook, blockOffset: 10 });
  await executeCommand(state, "/help");
  await handleInput("\u001bOB\u001bOB", state, redraw, noop, () => {}, noop);
  assert.equal(state.overlay, "help");
  assert.equal(state.overlayCursor, 2);
  assert.equal(state.blockOffset, 10);
});

test("/mouse toggles app mouse capture for draggable scrollbar mode", async () => {
  const saved: Array<[string, unknown]> = [];
  const storage = makeStorage({
    setSetting: (key: string, value: unknown) => saved.push([key, value])
  });
  const state = makeState({ overlay: "none", storage });
  assert.equal(state.mouseCapture, false);

  await executeCommand(state, "/mouse on");
  assert.equal(state.mouseCapture, true);

  await executeCommand(state, "/mouse off");
  assert.equal(state.mouseCapture, false);
  assert.deepEqual(saved, [
    ["mouseCapture", true],
    ["mouseCapture", false]
  ]);
});

test("home and end jump to the chapter boundaries", async () => {
  const state = makeState({ overlay: "none", currentBook: longChapterBook, blockOffset: 12 });
  await handleInput("\u001b[H", state, redraw, noop, () => {}, noop);
  assert.equal(state.blockOffset, 0);

  await handleInput("\u001b[F", state, redraw, noop, () => {}, noop);
  assert.ok(state.blockOffset > 0);
});

test("clicking and dragging the reading scrollbar updates chapter offset", async () => {
  const state = makeState({ overlay: "none", currentBook: longChapterBook, blockOffset: 0 });
  const layout = getViewportLayout(state, 120, 40);
  const scrollbarX = layout.mainWidth;
  const bodyTop = 2;

  await handleInput(`\u001b[<0;${scrollbarX};${bodyTop + 20}M`, state, redraw, noop, () => {}, noop);
  const jumpedOffset = state.blockOffset;
  assert.ok(jumpedOffset > 0);
  assert.equal(state.mouseDrag?.kind, "scrollbar");

  const chapterLineCount = computeChapterMaxOffset(state, layout.contentWidth, layout.bodyHeight) + layout.bodyHeight;
  const metrics = getScrollbarMetrics(chapterLineCount, layout.bodyHeight, jumpedOffset);
  await handleInput(`\u001b[<0;${scrollbarX};${bodyTop + metrics.thumbOffset}M`, state, redraw, noop, () => {}, noop);
  await handleInput(`\u001b[<32;${scrollbarX};${bodyTop + layout.bodyHeight - 1}M`, state, redraw, noop, () => {}, noop);
  assert.ok(state.blockOffset > jumpedOffset);

  await handleInput(`\u001b[<0;${scrollbarX};${bodyTop + layout.bodyHeight - 1}m`, state, redraw, noop, () => {}, noop);
  assert.equal(state.mouseDrag, null);
});

test("left and right arrows move between chapters", async () => {
  const state = makeState({ overlay: "none", currentBook, chapterIndex: 1, blockOffset: 5 });
  await handleInput("\u001b[C", state, redraw, noop, () => {}, noop);
  assert.equal(state.chapterIndex, 2);
  assert.equal(state.blockOffset, 0);

  await handleInput("\u001b[D", state, redraw, noop, () => {}, noop);
  assert.equal(state.chapterIndex, 1);
});

test("history keys go back and forward after /goto", async () => {
  const state = makeState({ overlay: "none", currentBook: longChapterBook, chapterIndex: 0, blockOffset: 0 });
  await executeCommand(state, "/goto 50% --chapter");
  const jumpedOffset = state.blockOffset;
  assert.ok(jumpedOffset > 0);

  await handleInput("[", state, redraw, noop, () => {}, noop);
  assert.equal(state.blockOffset, 0);

  await handleInput("]", state, redraw, noop, () => {}, noop);
  assert.equal(state.blockOffset, jumpedOffset);
});

test("history keys show boundary messages", async () => {
  const state = makeState({ overlay: "none", currentBook, chapterIndex: 0, blockOffset: 0 });

  await handleInput("[", state, redraw, noop, () => {}, noop);
  assert.equal(state.status, "No history to go back");

  state.navHistory = [{ chapterIndex: 0, blockOffset: 0 }];
  state.navHistoryCursor = 0;
  await handleInput("]", state, redraw, noop, () => {}, noop);
  assert.equal(state.status, "No history to go forward");
});

test("T opens the table of contents", async () => {
  const state = makeState({ overlay: "none", currentBook, chapterIndex: 2, blockOffset: 5 });
  await handleInput("T", state, redraw, noop, () => {}, noop);
  assert.equal(state.overlay, "chapters");
  assert.equal(state.overlayCursor, 2);
});

test("focus mode maps k forward and j backward", async () => {
  const state = makeState({
    overlay: "none",
    currentBook: focusBook,
    focusMode: true,
    focusBlockIndex: 1
  });

  await handleInput("k", state, redraw, noop, () => {}, noop);
  assert.equal(state.focusBlockIndex, 2);

  await handleInput("j", state, redraw, noop, () => {}, noop);
  assert.equal(state.focusBlockIndex, 1);
});

test("Ctrl+. opens shortcut help and escape closes it without leaving focus", async () => {
  const state = makeState({
    overlay: "none",
    currentBook: focusBook,
    focusMode: true,
    focusBlockIndex: 1
  });

  await handleInput("\u001b[46;5u", state, redraw, noop, () => {}, noop);
  assert.equal(state.overlay, "keys");

  await handleInput("\u001b", state, redraw, noop, () => {}, noop);
  assert.equal(state.overlay, "none");
  assert.equal(state.focusMode, true);
  assert.equal(state.focusBlockIndex, 1);
});

test("?, Ctrl+X, and event-typed Ctrl+. open shortcut help", async () => {
  const state = makeState({ overlay: "none", currentBook: focusBook });

  await handleInput("?", state, redraw, noop, () => {}, noop);
  assert.equal(state.overlay, "keys");

  await handleInput("?", state, redraw, noop, () => {}, noop);
  assert.equal(state.overlay, "none");

  await handleInput("\u0018", state, redraw, noop, () => {}, noop);
  assert.equal(state.overlay, "keys");
  assert.equal(state.shortcutCollapsedCategories?.has("navigation"), true);

  await handleInput("\u001b[120;5u", state, redraw, noop, () => {}, noop);
  assert.equal(state.overlay, "none");

  await handleInput("\u001b[46;5:1u", state, redraw, noop, () => {}, noop);
  assert.equal(state.overlay, "keys");
});

test("Kitty-protocol Escape closes shortcut help", async () => {
  const state = makeState({ overlay: "none" });
  await handleInput("\u001b[46;5u", state, redraw, noop, () => {}, noop);
  await handleInput("\u001b[27u", state, redraw, noop, () => {}, noop);
  assert.equal(state.overlay, "none");
});

test("full Kitty reports open shortcuts and require two Escapes to leave modal search", async () => {
  const state = makeState({ overlay: "none", currentBook: focusBook });

  await handleInput("\u001b[46::46;5:1;46u", state, redraw, noop, () => {}, noop);
  assert.equal(state.overlay, "keys");

  await handleInput("/", state, redraw, noop, () => {}, noop);
  assert.equal(state.shortcutSearchMode, true);

  await handleInput("\u001b[27;1:1;27u", state, redraw, noop, () => {}, noop);
  assert.equal(state.shortcutSearchMode, false);
  assert.equal(state.overlay, "keys");

  await handleInput("\u001b[27;1:1;27u", state, redraw, noop, () => {}, noop);
  assert.equal(state.overlay, "none");
});

test("clicking the Ctrl+. footer hint opens shortcut help", async () => {
  const state = makeState({ overlay: "none", currentBook: null, progressVisibility: "hidden" });
  const width = process.stdout.columns || 120;
  const height = process.stdout.rows || 40;
  const footer = stripAnsi(renderFooter(state, width)[0] ?? "");
  const x = footer.indexOf("Ctrl+.:shortcuts") + 1;
  const y = height - footerHeight(state, width);
  assert.ok(x > 0);

  await handleInput(`\u001b[<0;${x};${y}M`, state, redraw, noop, () => {}, noop);
  assert.equal(state.overlay, "keys");
});

test("batched Ctrl+X and slash input closes shortcuts then opens the command bar", async () => {
  const state = makeState({ overlay: "keys", commandMode: false });

  await handleInput("\u0018/", state, redraw, noop, () => {}, noop);
  assert.equal(state.overlay, "none");
  assert.equal(state.commandMode, true);
});

test("focus mode escape closes empty bookmark aside without leaving focus", async () => {
  const state = makeState({
    overlay: "none",
    currentBook: focusBook,
    focusMode: true,
    focusBlockIndex: 1
  });

  await handleInput("B", state, redraw, noop, () => {}, noop);
  assert.equal(state.overlay, "bookmarks");

  await handleInput("\u001b", state, redraw, noop, () => {}, noop);
  assert.equal(state.overlay, "none");
  assert.equal(state.focusMode, true);
  assert.equal(state.focusBlockIndex, 1);
});

test("extra downward wheel at chapter end requires a firmer pull before changing chapters", async () => {
  const state = makeState({ overlay: "none", currentBook: multiChapterScrollBook });
  const layout = getViewportLayout(state, 120, 40);
  state.blockOffset = computeChapterMaxOffset(state, layout.contentWidth, layout.bodyHeight);

  await handleInput("\u001b[<65;10;10M", state, redraw, noop, () => {}, noop);
  assert.equal(state.chapterIndex, 0);
  assert.match(state.chapterTransition?.message ?? "", /Chapter 2: Two/);
  assert.equal(state.chapterTransition?.stage, 1);
  assert.match(state.status, /Pull 3 more/);

  await handleInput("\u001b[<65;10;10M", state, redraw, noop, () => {}, noop);
  assert.equal(state.chapterIndex, 0);
  assert.equal(state.chapterTransition?.stage, 2);
  assert.match(state.status, /Pull 2 more/);

  await handleInput("\u001b[<65;10;10M", state, redraw, noop, () => {}, noop);
  assert.equal(state.chapterIndex, 0);
  assert.equal(state.chapterTransition?.stage, 3);
  assert.match(state.status, /Pull once more/);

  await handleInput("\u001b[<65;10;10M", state, redraw, noop, () => {}, noop);
  assert.equal(state.chapterIndex, 1);
  assert.equal(state.blockOffset, 0);
  assert.equal(state.chapterTransition, null);
});

test("extra down-arrow input at chapter end also moves to the next chapter", async () => {
  const state = makeState({ overlay: "none", currentBook: multiChapterScrollBook });
  const layout = getViewportLayout(state, 120, 40);
  state.blockOffset = computeChapterMaxOffset(state, layout.contentWidth, layout.bodyHeight);

  await handleInput("\u001b[B", state, redraw, noop, () => {}, noop);
  assert.equal(state.chapterIndex, 0);
  assert.equal(state.chapterTransition?.stage, 1);

  await handleInput("\u001b[B", state, redraw, noop, () => {}, noop);
  assert.equal(state.chapterIndex, 0);
  assert.equal(state.chapterTransition?.stage, 2);

  await handleInput("\u001b[B", state, redraw, noop, () => {}, noop);
  assert.equal(state.chapterIndex, 1);
});

test("scroll up cancels a pending chapter transition", async () => {
  const state = makeState({ overlay: "none", currentBook: multiChapterScrollBook });
  const layout = getViewportLayout(state, 120, 40);
  state.blockOffset = computeChapterMaxOffset(state, layout.contentWidth, layout.bodyHeight);

  await handleInput("\u001b[<65;10;10M", state, redraw, noop, () => {}, noop);
  assert.equal(state.chapterTransition?.stage, 1);

  await handleInput("\u001b[<64;10;10M", state, redraw, noop, () => {}, noop);
  assert.equal(state.chapterTransition, null);
});

test("page down cancels a pending chapter transition", async () => {
  const state = makeState({ overlay: "none", currentBook: multiChapterScrollBook });
  const layout = getViewportLayout(state, 120, 40);
  state.blockOffset = computeChapterMaxOffset(state, layout.contentWidth, layout.bodyHeight);

  await handleInput("\u001b[<65;10;10M", state, redraw, noop, () => {}, noop);
  assert.equal(state.chapterTransition?.stage, 1);

  await handleInput("\u001b[6~", state, redraw, noop, () => {}, noop);
  assert.equal(state.chapterTransition, null);
});

test("chapters overlay arrow keys move selection and enter opens the selected chapter", async () => {
  const state = makeState({ overlay: "none", currentBook, chapterIndex: 0, blockOffset: 5 });
  await executeCommand(state, "/chapters");
  assert.equal(state.overlay, "chapters");
  assert.equal(state.overlayCursor, 0);

  await handleInput("\u001b[B", state, redraw, noop, () => {}, noop);
  assert.equal(state.overlayCursor, 1);
  assert.equal(state.chapterIndex, 0);

  await handleInput("\r", state, redraw, noop, () => {}, noop);
  assert.equal(state.overlay, "none");
  assert.equal(state.chapterIndex, 1);
  assert.equal(state.blockOffset, 0);
});

test("chapter overlay keeps deep selections visible", async () => {
  const state = makeState({ overlay: "none", currentBook: manyChaptersBook, chapterIndex: 0 });
  await executeCommand(state, "/chapters");
  for (let index = 0; index < 43; index += 1) {
    await handleInput("\u001b[B", state, redraw, noop, () => {}, noop);
  }
  assert.equal(state.overlayCursor, 43);
});

test("books overlay arrow keys move selection and enter opens the selected book", async () => {
  const state = makeState({ overlay: "books", currentBook: null, overlayCursor: 0 });
  await handleInput("\r", state, redraw, noop, () => {}, noop);
  assert.equal(state.overlay, "none");
  assert.equal(state.currentBook?.id, "book-1");
});

test("colorschemes overlay arrow keys move selection and enter applies the colorscheme", async () => {
  const state = makeState({ overlay: "none" });
  await executeCommand(state, "/colorscheme");
  assert.equal(state.overlay, "colorschemes");
  assert.equal(state.overlayCursor, Math.max(0, THEMES.findIndex((item) => item.id === state.colorScheme.id)));

  await handleInput("\u001b[B", state, redraw, noop, () => {}, noop);
  assert.equal(state.overlayCursor, 1);

  await handleInput("\r", state, redraw, noop, () => {}, noop);
  assert.equal(state.overlay, "none");
  assert.equal(state.colorScheme.id, THEMES[1].id);
});

test("/colorscheme claude applies and persists the Claude Code palette", async () => {
  const saved: Array<[string, unknown]> = [];
  const storage = makeStorage({
    setSetting: (key: string, value: unknown) => saved.push([key, value])
  });
  const state = makeState({ overlay: "none", storage });

  await executeCommand(state, "/colorscheme claude");

  assert.equal(state.colorScheme.id, "claude");
  assert.equal(state.theme.accent, "#d77757");
  assert.equal(state.status, "Colorscheme set to Claude Code");
  assert.deepEqual(saved, [["themeId", "claude"]]);
});

test("themes overlay arrow keys move selection and enter applies the appearance theme", async () => {
  const state = makeState({ overlay: "none" });
  await executeCommand(state, "/theme");
  assert.equal(state.overlay, "themes");
  assert.equal(state.overlayCursor, 0);

  await handleInput("\u001b[B", state, redraw, noop, () => {}, noop);
  assert.equal(state.overlayCursor, 1);

  await handleInput("\r", state, redraw, noop, () => {}, noop);
  assert.equal(state.overlay, "none");
  assert.equal(state.appearanceTheme.id, APPEARANCE_THEMES[1]!.id);
  assert.equal(state.theme.id, `${state.colorScheme.id}:${APPEARANCE_THEMES[1]!.id}`);
});

test("books overlay shows [not started] for a book with no saved position", () => {
  const state = makeState({ overlay: "books", overlayCursor: 0 });
  const lines = renderOverlay(state, 60, 10).map(stripAnsi);
  assert.ok(lines.some((line) => line.includes("[not started]")));
});

test("books overlay includes discovered EPUBs that have not been imported yet", () => {
  const jane = { path: "/tmp/Jane Eyre (Brontë Charlotte) (Z-Library).epub", fileName: "Jane Eyre (Brontë Charlotte) (Z-Library).epub" };
  const state = makeState({ overlay: "books", overlayCursor: 0, discoveries: [jane] });

  const lines = renderOverlay(state, 100, 12).map(stripAnsi);

  assert.ok(lines.some((line) => line.includes("Jane Eyre")), `Expected discovered Jane Eyre in: ${lines.join(" | ")}`);
});

test("enter on a discovered EPUB in the books overlay imports the selected file", async () => {
  const jane = { path: "/tmp/Jane Eyre.epub", fileName: "Jane Eyre.epub" };
  const state = makeState({ overlay: "books", overlayCursor: 1, discoveries: [jane] });
  let confirmed: { paths: string[]; force: boolean } | null = null;

  await handleInput("\r", state, redraw, noop, () => {}, async (paths, force) => {
    confirmed = { paths, force };
  });

  assert.deepEqual(confirmed, { paths: [jane.path], force: false });
  assert.equal(state.overlay, "none");
});

test("books overlay shows chapter and progress for a book with a saved position", () => {
  const storage = makeStorage({
    listBooksWithProgress: () => [{ ...baseBook, chapterIndex: 4, chapterTitle: "Act Two", bookProgress: 0.42 }]
  });
  const state = makeState({ overlay: "books", overlayCursor: 0, storage });
  const lines = renderOverlay(state, 60, 10).map(stripAnsi);
  assert.ok(lines.some((line) => line.includes("[Ch.5 · 42%]")));
});

test("books overlay restores saved chapter and scroll offset when opening a book", async () => {
  const storage = makeStorage({
    getPosition: () => ({ bookId: "book-1", chapterIndex: 3, chapterProgress: 0.5, bookProgress: 0.3, blockOffset: 17 })
  });
  const state = makeState({ overlay: "books", overlayCursor: 0, storage });
  await handleInput("\r", state, redraw, noop, () => {}, noop);
  assert.equal(state.overlay, "none");
  assert.equal(state.chapterIndex, 3);
  assert.equal(state.blockOffset, 17);
});

test("m key toggles render mode from plain to code", async () => {
  const state = makeState({ overlay: "none", renderMode: "plain" });
  await handleInput("m", state, redraw, async (cmd) => { await executeCommand(state, cmd); }, () => {}, noop);
  assert.equal(state.renderMode, "code");
});

test("m key cycles from typescript to python", async () => {
  const state = makeState({ overlay: "none", renderMode: "code", codeLanguage: "typescript" });
  await handleInput("m", state, redraw, async (cmd) => { await executeCommand(state, cmd); }, () => {}, noop);
  assert.equal(state.renderMode, "code");
  assert.equal(state.codeLanguage, "python");
});

test("m key cycles from rust to plain", async () => {
  const state = makeState({ overlay: "none", renderMode: "code", codeLanguage: "rust" });
  await handleInput("m", state, redraw, async (cmd) => { await executeCommand(state, cmd); }, () => {}, noop);
  assert.equal(state.renderMode, "plain");
});

test("c key opens the colorscheme picker", async () => {
  const state = makeState({ overlay: "none" });
  await handleInput("c", state, redraw, async (cmd) => { await executeCommand(state, cmd); }, () => {}, noop);
  assert.equal(state.overlay, "colorschemes");
});

test("C key opens the theme picker", async () => {
  const state = makeState({ overlay: "none" });
  await handleInput("C", state, redraw, async (cmd) => { await executeCommand(state, cmd); }, () => {}, noop);
  assert.equal(state.overlay, "themes");
});

test("/settings and S open the settings panel", async () => {
  const state = makeState({ overlay: "none" });
  await executeCommand(state, "/settings");
  assert.equal(state.overlay, "settings");
  assert.equal(state.settingsDraft?.renderMode, "plain");

  const shortcutState = makeState({ overlay: "none" });
  await handleInput("S", shortcutState, redraw, async (cmd) => { await executeCommand(shortcutState, cmd); }, () => {}, noop);
  assert.equal(shortcutState.overlay, "settings");
});

test("settings opens on the Themes tab and shows only theme controls", async () => {
  const state = makeState({ overlay: "none" });

  await executeCommand(state, "/settings");
  const lines = renderSettingsPanel(state, 80, 20).map(stripAnsi);
  const panel = lines.join("\n");

  assert.match(panel, /Themes.*Reading.*Layout.*More/);
  assert.match(panel, /Appearance theme/);
  assert.match(panel, /Colorscheme/);
  assert.doesNotMatch(panel, /Reading mode/);
  assert.doesNotMatch(panel, /Progress display/);
});

test("right arrow moves settings from Themes to Reading", async () => {
  const state = makeState({ overlay: "none" });
  await executeCommand(state, "/settings");
  state.overlayCursor = 1;

  await handleInput("\u001b[C", state, redraw, noop, () => {}, noop);
  const panel = renderSettingsPanel(state, 80, 20).map(stripAnsi).join("\n");

  assert.equal(state.settingsTab, "reading");
  assert.equal(state.overlayCursor, 0);
  assert.match(panel, /Reading mode/);
  assert.match(panel, /Dialogue highlight/);
  assert.doesNotMatch(panel, /Appearance theme/);
});

test("Layout tab exposes text size, margins, spacing, and code density", async () => {
  const state = makeState({ overlay: "none" });
  await executeCommand(state, "/settings");
  await handleInput("\u001b[C", state, redraw, noop, () => {}, noop);
  await handleInput("\u001b[C", state, redraw, noop, () => {}, noop);

  const panel = renderSettingsPanel(state, 80, 24).map(stripAnsi).join("\n");

  assert.equal(state.settingsTab, "layout");
  assert.match(panel, /Text size/);
  assert.match(panel, /Page margins/);
  assert.match(panel, /Line spacing/);
  assert.match(panel, /Code density/);
});

test("settings preview follows the draft without applying it to the reader", async () => {
  const state = makeState({ overlay: "none", renderMode: "plain", codeLanguage: "typescript" });
  await executeCommand(state, "/settings");
  await handleInput("\u001b[C", state, redraw, noop, () => {}, noop);

  await handleInput(" ", state, redraw, noop, () => {}, noop);
  const panel = renderSettingsPanel(state, 80, 24).map(stripAnsi).join("\n");

  assert.equal(state.renderMode, "plain");
  assert.equal(state.settingsDraft?.renderMode, "code");
  assert.match(panel, /Preview/);
  assert.match(panel, /const fragment/);
});

test("settings stays within a small terminal and omits an incomplete preview", async () => {
  const state = makeState({ overlay: "none" });
  await executeCommand(state, "/settings");
  await handleInput("\u001b[C", state, redraw, noop, () => {}, noop);
  await handleInput("\u001b[C", state, redraw, noop, () => {}, noop);

  const lines = renderSettingsPanel(state, 36, 12).map(stripAnsi);

  assert.ok(lines.length <= 12);
  assert.ok(lines.every((line) => line.length <= 36));
  assert.ok(!lines.some((line) => line.includes("Preview")));
});

test("settings panel labels both reading-time progress modes", async () => {
  const chapterState = makeState({ overlay: "none", progressVisibility: "time-chapter" });
  await executeCommand(chapterState, "/settings");
  await handleInput("\u001b[D", chapterState, redraw, noop, () => {}, noop);
  const chapterLines = renderSettingsPanel(chapterState, 80, 20).map(stripAnsi);
  assert.ok(chapterLines.some((line) => line.includes("Time left in chapter")));

  const bookState = makeState({ overlay: "none", progressVisibility: "time-book" });
  await executeCommand(bookState, "/settings");
  await handleInput("\u001b[D", bookState, redraw, noop, () => {}, noop);
  const bookLines = renderSettingsPanel(bookState, 80, 20).map(stripAnsi);
  assert.ok(bookLines.some((line) => line.includes("Time left in book")));
});

test("settings search filters controls inside the active tab", async () => {
  const state = makeState({ overlay: "none" });
  await executeCommand(state, "/config");
  await handleInput("\u001b[C", state, redraw, noop, () => {}, noop);
  await handleInput("\u001b[C", state, redraw, noop, () => {}, noop);
  await handleInput("/", state, redraw, noop, () => {}, noop);
  await handleInput("d", state, redraw, noop, () => {}, noop);
  await handleInput("e", state, redraw, noop, () => {}, noop);
  await handleInput("n", state, redraw, noop, () => {}, noop);

  assert.equal(state.overlay, "settings");
  assert.equal(state.commandMode, false);
  assert.equal(state.settingsSearchBuffer, "den");

  const lines = renderSettingsPanel(state, 80, 20).map(stripAnsi);
  assert.ok(lines.some((line) => line.includes("Code density")));
  assert.ok(!lines.some((line) => line.includes("Mouse capture")));
});

test("Enter applies and persists the complete Layout draft", async () => {
  let saved: Parameters<AppState["storage"]["saveSettings"]>[0] | null = null;
  const storage = makeStorage({
    saveSettings: (settings) => { saved = settings; }
  });
  const state = makeState({
    overlay: "none",
    storage,
    fontScale: 1,
    marginSize: 0,
    lineSpacing: "normal"
  });
  await executeCommand(state, "/settings");
  await handleInput("\u001b[C", state, redraw, noop, () => {}, noop);
  await handleInput("\u001b[C", state, redraw, noop, () => {}, noop);

  await handleInput(" ", state, redraw, noop, () => {}, noop);
  await handleInput("\u001b[B", state, redraw, noop, () => {}, noop);
  await handleInput(" ", state, redraw, noop, () => {}, noop);
  await handleInput("\u001b[B", state, redraw, noop, () => {}, noop);
  await handleInput(" ", state, redraw, noop, () => {}, noop);

  assert.equal(state.fontScale, 1);
  assert.equal(state.marginSize, 0);
  assert.equal(state.lineSpacing, "normal");

  await handleInput("\r", state, redraw, noop, () => {}, noop);

  assert.equal(state.fontScale, 1.15);
  assert.equal(state.marginSize, 4);
  assert.equal(state.lineSpacing, "relaxed");
  assert.equal(saved?.fontScale, 1.15);
  assert.equal(saved?.marginSize, 4);
  assert.equal(saved?.lineSpacing, "relaxed");
});

test("space stages a settings change and escape cancels it", async () => {
  const state = makeState({ overlay: "none", renderMode: "plain", codeLanguage: "typescript" });
  await executeCommand(state, "/settings");
  await handleInput("\u001b[C", state, redraw, noop, () => {}, noop);
  await handleInput(" ", state, redraw, noop, () => {}, noop);

  assert.equal(state.settingsDraft?.renderMode, "code");
  assert.equal(state.settingsDraft?.codeLanguage, "typescript");
  assert.equal(state.renderMode, "plain");

  await handleInput("\u001b", state, redraw, noop, () => {}, noop);
  assert.equal(state.overlay, "none");
  assert.equal(state.renderMode, "plain");
  assert.equal(state.status, "Settings cancelled.");
});

test("enter saves staged settings and persists app settings", async () => {
  let saved: Parameters<AppState["storage"]["saveSettings"]>[0] | null = null;
  const storage = makeStorage({
    saveSettings: (settings) => { saved = settings; }
  });
  const state = makeState({ overlay: "none", storage, renderMode: "plain", codeLanguage: "typescript" });

  await executeCommand(state, "/settings");
  await handleInput("\u001b[C", state, redraw, noop, () => {}, noop);
  await handleInput(" ", state, redraw, noop, () => {}, noop);
  await handleInput("\r", state, redraw, noop, () => {}, noop);

  assert.equal(state.overlay, "none");
  assert.equal(state.renderMode, "code");
  assert.equal(state.codeLanguage, "typescript");
  assert.equal(state.status, "Settings saved.");
  assert.equal(saved?.renderMode, "code");
  assert.equal(saved?.codeLanguage, "typescript");
});

test("settings stay staged when atomic persistence fails", async () => {
  const storage = makeStorage({
    saveSettings: () => { throw new Error("disk full"); }
  });
  const state = makeState({ overlay: "none", storage, renderMode: "plain" });

  await executeCommand(state, "/settings");
  await handleInput("\u001b[C", state, redraw, noop, () => {}, noop);
  await handleInput(" ", state, redraw, noop, () => {}, noop);
  await handleInput("\r", state, redraw, noop, () => {}, noop);

  assert.equal(state.renderMode, "plain");
  assert.equal(state.settingsDraft?.renderMode, "code");
  assert.equal(state.overlay, "settings");
  assert.equal(state.status, "Settings could not be saved; no changes were applied.");
});

test("p key cycles progress visibility to the next value", async () => {
  const state = makeState({ overlay: "none", progressVisibility: "book" });
  await handleInput("p", state, redraw, async (cmd) => { await executeCommand(state, cmd); }, () => {}, noop);
  assert.equal(state.progressVisibility, "both");
});

test("p key cycles chapter time to book time", async () => {
  const state = makeState({ overlay: "none", progressVisibility: "time-chapter" });
  await handleInput("p", state, redraw, async (cmd) => { await executeCommand(state, cmd); }, () => {}, noop);
  assert.equal(state.progressVisibility, "time-book");
});

test("p key wraps progress visibility back to time left in chapter after hidden", async () => {
  const state = makeState({ overlay: "none", progressVisibility: "hidden" });
  await handleInput("p", state, redraw, async (cmd) => { await executeCommand(state, cmd); }, () => {}, noop);
  assert.equal(state.progressVisibility, "time-chapter");
});

test("/highlight requires on/off argument", async () => {
  const state = makeState({ overlay: "none", plainHighlight: true });
  await executeCommand(state, "/highlight");
  assert.equal(state.plainHighlight, true);
  assert.equal(state.status, "Use /highlight <on|off>");
});

test("/highlight off and on toggle plain dialogue highlight", async () => {
  const state = makeState({ overlay: "none", plainHighlight: true });
  await executeCommand(state, "/highlight off");
  assert.equal(state.plainHighlight, false);
  assert.equal(state.status, "Dialogue highlight: off");

  await executeCommand(state, "/highlight on");
  assert.equal(state.plainHighlight, true);
  assert.equal(state.status, "Dialogue highlight: on");
});
