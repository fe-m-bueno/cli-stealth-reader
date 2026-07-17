import test from "node:test";
import assert from "node:assert/strict";
import { renderOverlay } from "../src/tui.js";
import { renderLibraryModal } from "../src/library-modal.js";
import { stripAnsi } from "../src/screen.js";
import type { AppState, LibraryEntryWithProgress, ThemePreset } from "../src/types.js";

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

function booksState(books: LibraryEntryWithProgress[], latestBookId: string | null): AppState {
  return {
    theme,
    overlay: "books",
    overlayCursor: 0,
    librarySortKey: "lastOpened",
    librarySortDir: "desc",
    booksTagFilter: null,
    booksTagMap: new Map(),
    storage: {
      listBooksWithProgress: () => books,
      getLatestBookId: () => latestBookId
    }
  } as unknown as AppState;
}

test("library startup overlay makes continue-reading action explicit", () => {
  const books: LibraryEntryWithProgress[] = [
    {
      id: "latest",
      title: "Latest Book",
      author: "Ada",
      sourcePath: "/books/latest.epub",
      importHash: "hash-latest",
      lastOpenedAt: 2,
      renderMode: "plain",
      chapterIndex: 3,
      chapterTitle: "Four",
      bookProgress: 0.42
    },
    {
      id: "other",
      title: "Other Book",
      author: "Bea",
      sourcePath: "/books/other.epub",
      importHash: "hash-other",
      lastOpenedAt: 1,
      renderMode: "code",
      chapterIndex: null,
      chapterTitle: null,
      bookProgress: null
    }
  ];

  const lines = renderLibraryModal(booksState(books, "latest"), 100, 30).map(stripAnsi);

  const footer = lines.find((line) => line.includes("Enter:open"));
  assert.ok(footer, `Expected Enter:open footer hint, got: ${lines.join(" | ")}`);
  const latestLine = lines.find((line) => line.includes("Latest Book"));
  assert.ok(latestLine, "Expected Latest Book row");
  assert.match(latestLine!, /\[continue\]/);
  assert.match(latestLine!, /\[Ch\.4 · 42%\]/);
  const otherLine = lines.find((line) => line.includes("Other Book"));
  assert.ok(otherLine, "Expected Other Book row");
  assert.doesNotMatch(otherLine!, /\[continue\]/);
});
