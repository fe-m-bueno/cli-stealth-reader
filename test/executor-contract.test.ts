import test from "node:test";
import assert from "node:assert/strict";
import { executeCommand, pushNavHistory } from "../src/executor.js";
import { createEmptyPaceState } from "../src/reading-pace.js";
import { APPEARANCE_THEMES, THEMES } from "../src/themes.js";
import type { AppState, Bookmark, CanonicalBook } from "../src/types.js";

const book: CanonicalBook = {
  id: "contract-book",
  title: "Contract Book",
  author: "Reader",
  sourcePath: "/tmp/contract.epub",
  importHash: "contract-hash",
  diagnostics: [],
  chapters: [
    {
      id: "chapter-1", index: 0, title: "Opening", href: "opening.xhtml", depth: 0, wordCount: 10,
      blocks: [
        { id: "b1", type: "paragraph", text: "alpha opening" },
        { id: "b2", type: "paragraph", text: "shared phrase" }
      ]
    },
    {
      id: "chapter-2", index: 1, title: "Middle", href: "middle.xhtml", depth: 0, wordCount: 30,
      blocks: [
        { id: "b3", type: "paragraph", text: "beta middle" },
        { id: "b4", type: "paragraph", text: "shared phrase" }
      ]
    },
    {
      id: "chapter-3", index: 2, title: "Ending", href: "ending.xhtml", depth: 0, wordCount: 60,
      blocks: [{ id: "b5", type: "paragraph", text: "omega ending" }]
    }
  ]
};

function makeStorage() {
  const settings = new Map<string, unknown>();
  const bookmarks: Bookmark[] = [];
  const histories: Array<{ raw: string; name: string }> = [];
  const removedBooks: string[] = [];
  return {
    settings,
    bookmarks,
    histories,
    removedBooks,
    storage: {
      saveCommandHistory: (raw: string, name: string) => histories.push({ raw, name }),
      getSetting: (key: string) => settings.get(key) ?? null,
      setSetting: (key: string, value: unknown) => settings.set(key, value),
      setRawSetting: (key: string, value: unknown) => settings.set(key, value),
      getSettings: () => ({
        themeId: "codex", appearanceThemeId: "dark", progressVisibility: "book", renderMode: "plain",
        codeLanguage: "typescript", codeDensity: 3, plainHighlight: true, fontScale: 1,
        marginSize: 0, lineSpacing: "normal", mouseCapture: false
      }),
      saveSettings: () => {},
      getPosition: () => null,
      getReadingPace: () => null,
      saveReadingPace: () => {},
      savePosition: () => {},
      saveBook: () => {},
      listBooks: () => [{
        id: book.id, title: book.title, author: book.author, sourcePath: book.sourcePath,
        importHash: book.importHash, lastOpenedAt: 1, renderMode: "plain" as const
      }],
      listBooksWithProgress: () => [],
      getBook: (id: string) => id === book.id ? book : null,
      getLatestBookId: () => book.id,
      removeBook: (id: string) => removedBooks.push(id),
      listBookmarks: () => bookmarks,
      addBookmark: (bookId: string, chapterIndex: number, blockOffset: number, label: string) => {
        const bookmark = {
          id: `bookmark-${bookmarks.length + 1}`, bookId, chapterIndex, blockOffset, label, createdAt: bookmarks.length + 1
        };
        bookmarks.push(bookmark);
        return bookmark;
      },
      deleteBookmark: (id: string) => {
        const index = bookmarks.findIndex((item) => item.id === id);
        if (index >= 0) bookmarks.splice(index, 1);
      },
      listTagsByBookId: () => new Map<string, string[]>(),
      listTags: () => [],
      addTag: () => {},
      removeTag: () => {},
      listNotes: () => [],
      addNote: () => ({ id: "note", bookId: book.id, chapterIndex: 0, blockOffset: 0, content: "", createdAt: 0 }),
      deleteNote: () => {}
    } as unknown as AppState["storage"]
  };
}

function makeState(currentBook: CanonicalBook | null = book) {
  const backing = makeStorage();
  const state = {
    storage: backing.storage,
    cwd: "/tmp",
    colorScheme: THEMES[0]!,
    appearanceTheme: APPEARANCE_THEMES[0]!,
    theme: THEMES[0]!,
    renderMode: "plain",
    codeLanguage: "typescript",
    codeDensity: 3,
    plainHighlight: true,
    fontScale: 1,
    marginSize: 0,
    lineSpacing: "normal",
    progressVisibility: "book",
    readingPace: createEmptyPaceState(),
    currentBook,
    chapterIndex: 0,
    blockOffset: 0,
    focusMode: false,
    focusBlockIndex: 0,
    commandBuffer: "",
    commandCursor: 0,
    commandMode: false,
    commandSuggestionIndex: 0,
    status: "",
    overlay: "none",
    overlayCursor: 0,
    discoveries: [],
    shouldQuit: false,
    filePickerCursor: 0,
    filePickerItems: [],
    filePickerSelected: new Set<number>(),
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
    mouseCapture: false
  } as AppState;
  return { state, ...backing };
}

test("chapter navigation records bounded history and never leaves the book", async () => {
  const { state } = makeState();
  state.chapterIndex = 1;
  state.blockOffset = 8;

  await executeCommand(state, "/prev 5");
  assert.equal(state.chapterIndex, 0);
  assert.equal(state.blockOffset, 0);
  assert.equal(state.status, "Moved to chapter 1");

  await executeCommand(state, "/next 99");
  assert.equal(state.chapterIndex, 2);
  assert.equal(state.status, "Moved to chapter 3");

  for (let index = 0; index < 60; index += 1) {
    state.blockOffset = index;
    pushNavHistory(state);
  }
  assert.equal(state.navHistory.length, 50);
  assert.deepEqual(state.navHistory.at(-1), { chapterIndex: 2, blockOffset: 59 });
});

test("bookmark commands save automatic labels and delete by id, exact label, or unique partial label", async () => {
  const { state, bookmarks } = makeState();
  state.chapterIndex = 1;
  state.blockOffset = 7;

  await executeCommand(state, "/mark");
  await executeCommand(state, "/mark Important passage");
  assert.deepEqual(bookmarks.map((item) => item.label), ["Ch.2 §7", "Important passage"]);

  await executeCommand(state, "/marks");
  assert.equal(state.overlay, "bookmarks");
  assert.equal(state.status, "Opened bookmarks.");

  await executeCommand(state, "/delmark Important");
  assert.deepEqual(bookmarks.map((item) => item.label), ["Ch.2 §7"]);
  await executeCommand(state, `/delmark ${bookmarks[0]!.id}`);
  assert.equal(bookmarks.length, 0);

  await executeCommand(state, "/delmark missing");
  assert.equal(state.status, 'No bookmark matched "missing".');
});

test("search commands distinguish chapter and whole-book matches and move to the first result", async () => {
  const { state } = makeState();
  state.chapterIndex = 1;

  await executeCommand(state, "/search shared");
  assert.equal(state.searchState?.global, false);
  assert.deepEqual(state.searchState?.results, [{ chapterIndex: 1, blockIndex: 1, lineIndex: 0 }]);
  assert.equal(state.chapterIndex, 1);

  await executeCommand(state, "/search -g shared");
  assert.equal(state.searchState?.global, true);
  assert.equal(state.searchState?.results.length, 2);
  assert.equal(state.chapterIndex, 0);

  await executeCommand(state, "/search absent");
  assert.equal(state.searchState, null);
  assert.equal(state.status, 'No matches for "absent" in this chapter.');

  await executeCommand(state, "/search");
  assert.equal(state.status, "Use /search [-g|--global] <term>");
});

test("goto supports book percentages, chapter percentages, chapter numbers, and invalid positions", async () => {
  const { state } = makeState();

  await executeCommand(state, "/goto 0%");
  assert.equal(state.chapterIndex, 0);
  assert.equal(state.status, "Jumped to 0% (start of book)");

  await executeCommand(state, "/goto 50%");
  assert.equal(state.chapterIndex, 2);
  assert.match(state.status, /^Jumped to 50% of book/);

  await executeCommand(state, "/goto 100%");
  assert.equal(state.chapterIndex, 2);
  assert.equal(state.status, "Jumped to 100% (end of book)");

  await executeCommand(state, "/goto 2");
  assert.equal(state.chapterIndex, 1);
  assert.equal(state.blockOffset, 0);

  await executeCommand(state, "/goto 25%c");
  assert.match(state.status, /^Jumped to 25% of chapter 2/);

  await executeCommand(state, "/goto 101%");
  assert.equal(state.status, "Percentage must be between 0 and 100.");
  await executeCommand(state, "/goto nowhere");
  assert.match(state.status, /Could not parse position/);
  await executeCommand(state, "/goto 99");
  assert.match(state.status, /There is no chapter 99/);
});

test("appearance and reading commands persist valid choices and report invalid choices", async () => {
  const { state, settings } = makeState();

  await executeCommand(state, "/mode rust");
  assert.equal(state.renderMode, "code");
  assert.equal(state.codeLanguage, "rust");
  assert.equal(settings.get("codeLanguage"), "rust");

  await executeCommand(state, "/mode plain");
  assert.equal(state.renderMode, "plain");
  await executeCommand(state, "/mode invalid");
  assert.equal(state.status, "Mode must be plain, typescript, python, or rust");

  await executeCommand(state, "/density 5");
  assert.equal(state.codeDensity, 5);
  await executeCommand(state, "/density 9");
  assert.equal(state.status, "Density must be a number between 1 and 5");

  await executeCommand(state, "/toggleprogress hidden");
  assert.equal(state.progressVisibility, "hidden");
  await executeCommand(state, "/toggleprogress");
  assert.equal(state.progressVisibility, "time-chapter");

  await executeCommand(state, "/mouse");
  assert.equal(state.mouseCapture, true);
  await executeCommand(state, "/mouse invalid");
  assert.equal(state.status, "Use /mouse [on|off]");

  await executeCommand(state, "/colorscheme claude");
  assert.equal(state.colorScheme.id, "claude");
  await executeCommand(state, "/theme light");
  assert.equal(state.appearanceTheme.id, "light");
  await executeCommand(state, "/colorscheme missing");
  assert.equal(state.status, "Unknown colorscheme missing");
  await executeCommand(state, "/theme missing");
  assert.equal(state.status, "Unknown theme missing");
});

test("resume and removal commands handle both an active book and an empty reader", async () => {
  const active = makeState();
  await executeCommand(active.state, "/removecurrent");
  assert.deepEqual(active.removedBooks, [book.id]);
  assert.equal(active.state.currentBook, null);

  await executeCommand(active.state, "/removecurrent");
  assert.equal(active.state.status, "No current book to remove.");

  const resumed = makeState(null);
  await executeCommand(resumed.state, "/resume --latest");
  assert.equal(resumed.state.currentBook?.id, book.id);
  assert.equal(resumed.state.status, "Opened Contract Book");
  assert.equal(resumed.state.chapterIndex, 0);
});

test("commands issued in focus mode preserve the viewport offset while updating the focused block", async () => {
  const { state } = makeState();
  state.focusMode = true;
  state.focusBlockIndex = 1;
  state.blockOffset = 42;

  await executeCommand(state, "/goto 3");

  assert.equal(state.chapterIndex, 2);
  assert.equal(state.focusBlockIndex, 0);
  assert.equal(state.blockOffset, 42);

  const empty = makeState(null).state;
  pushNavHistory(empty);
  assert.deepEqual(empty.navHistory, []);
});
