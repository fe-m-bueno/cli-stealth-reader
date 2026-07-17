import { fg, paintBackground } from "./color.js";
import { fuzzyFilter } from "./fuzzy.js";
import { discoveredBookLabel, libraryPickerItems, type LibraryPickerItem } from "./library-picker.js";
import {
  composeModal,
  modalHitTest,
  padAnsi,
  renderModalFrame,
  type ModalHit
} from "./modal.js";
import { clamp, stripAnsi, truncate } from "./screen.js";
import type { AppState, FolderDiscovery } from "./types.js";

const SORT_KEY_LABELS: Record<string, string> = {
  lastOpened: "Last Opened",
  title: "Title",
  author: "Author",
  progress: "Progress"
};

function overlayQuery(state: AppState): string {
  return (state.overlaySearchBuffer ?? "").trim();
}

function searchState(state: AppState) {
  return {
    buffer: state.overlaySearchBuffer ?? "",
    active: Boolean(state.overlaySearchMode),
    placeholder: "/ to search"
  };
}

export function resetOverlaySearch(state: AppState): void {
  state.overlaySearchBuffer = "";
  state.overlaySearchMode = false;
}

export function filteredLibraryItems(state: AppState): LibraryPickerItem[] {
  return fuzzyFilter(overlayQuery(state), libraryPickerItems(state), (item) => item.kind === "stored"
    ? `${item.book.title} ${item.book.author} ${(state.booksTagMap.get(item.book.id) ?? []).join(" ")}`
    : item.discovery.fileName);
}

export interface FilteredPickerItem {
  item: FolderDiscovery;
  index: number;
}

export function filteredPickerItems(state: AppState): FilteredPickerItem[] {
  const entries = state.filePickerItems.map((item, index) => ({ item, index }));
  return fuzzyFilter(overlayQuery(state), entries, (entry) => entry.item.fileName);
}

function paintRow(state: AppState, content: string, contentWidth: number, selected: boolean, dim: boolean): string {
  const plain = padAnsi(truncate(content, contentWidth), contentWidth);
  return selected
    ? paintBackground(state.theme.border, fg(state.theme.foreground, plain))
    : fg(dim ? state.theme.dim : state.theme.foreground, plain);
}

function libraryRow(state: AppState, item: LibraryPickerItem, contentWidth: number, selected: boolean, latestBookId: string | null): string {
  if (item.kind === "discovered") {
    const right = "  [local · Enter to import]";
    const title = truncate(discoveredBookLabel(item.discovery), Math.max(1, contentWidth - right.length));
    return paintRow(state, `${title}${" ".repeat(Math.max(0, contentWidth - stripAnsi(title).length - right.length))}${right}`, contentWidth, selected, true);
  }
  const book = item.book;
  const progressTag = book.bookProgress !== null
    ? `[Ch.${(book.chapterIndex ?? 0) + 1} · ${Math.round(book.bookProgress * 100)}%]`
    : "[not started]";
  const latestTag = book.id === latestBookId ? "[continue] " : "";
  const tags = state.booksTagMap.get(book.id) ?? [];
  const tagsStr = tags.length > 0 ? ` ${tags.map((tag) => `#${tag}`).join(" ")}` : "";
  const right = `${latestTag}${progressTag}${tagsStr}`;
  const left = truncate(`${book.title}  —  ${book.author}`, Math.max(1, contentWidth - stripAnsi(right).length - 2));
  const gap = " ".repeat(Math.max(2, contentWidth - stripAnsi(left).length - stripAnsi(right).length));
  return paintRow(state, `${left}${gap}${right}`, contentWidth, selected, false);
}

export function renderLibraryModal(state: AppState, width: number, height: number): string[] {
  const items = filteredLibraryItems(state);
  state.overlayCursor = clamp(state.overlayCursor, 0, Math.max(0, items.length - 1));
  const latestBookId = state.storage.getLatestBookId();
  const dirArrow = state.librarySortDir === "asc" ? "↑" : "↓";
  const filterNote = state.booksTagFilter ? ` · #${state.booksTagFilter}` : "";
  return renderModalFrame({
    theme: state.theme,
    title: `Library · Sort: ${SORT_KEY_LABELS[state.librarySortKey] ?? state.librarySortKey} ${dirArrow}${filterNote}`,
    search: searchState(state),
    rowCount: Math.max(items.length, 1),
    cursor: state.overlayCursor,
    renderRow: (index, contentWidth, selected) => {
      const item = items[index];
      if (!item) {
        return fg(state.theme.dim, "No books match.");
      }
      return libraryRow(state, item, contentWidth, selected, latestBookId);
    },
    footerHints: state.overlaySearchMode
      ? [
          { key: "Esc", label: "exit search" },
          { key: "Enter", label: "confirm" }
        ]
      : [
          { key: "Enter", label: "open" },
          { key: "b/n", label: "marks/notes" },
          { key: "s/r", label: "sort" },
          { key: "Esc", label: "close" }
        ]
  }, width, height);
}

export function renderFilePickerModal(state: AppState, width: number, height: number): string[] {
  const items = filteredPickerItems(state);
  state.filePickerCursor = clamp(state.filePickerCursor, 0, Math.max(0, items.length - 1));
  return renderModalFrame({
    theme: state.theme,
    title: "Add Books",
    search: searchState(state),
    rowCount: Math.max(items.length, 1),
    cursor: state.filePickerCursor,
    renderRow: (index, contentWidth, selected) => {
      const entry = items[index];
      if (!entry) {
        return fg(state.theme.dim, "No books found in this folder.");
      }
      const check = state.filePickerSelected.has(entry.index) ? "[x]" : "[ ]";
      return paintRow(state, `${check} ${entry.item.fileName}`, contentWidth, selected, !selected);
    },
    footerHints: state.overlaySearchMode
      ? [
          { key: "Esc", label: "exit search" },
          { key: "Enter", label: "confirm" }
        ]
      : [
          { key: "Space", label: "select" },
          { key: "Enter", label: "import" },
          { key: "Esc", label: "close" }
        ]
  }, width, height);
}

export function composeLibraryModal(state: AppState, backgroundLines: string[], width: number, height: number): string[] {
  return composeModal(state.theme, renderLibraryModal(state, width, height), backgroundLines, width, height);
}

export function composeFilePickerModal(state: AppState, backgroundLines: string[], width: number, height: number): string[] {
  return composeModal(state.theme, renderFilePickerModal(state, width, height), backgroundLines, width, height);
}

export function libraryModalHitTest(state: AppState, width: number, height: number, x: number, y: number): ModalHit {
  return modalHitTest(width, height, filteredLibraryItems(state).length, state.overlayCursor, x, y);
}

export function filePickerModalHitTest(state: AppState, width: number, height: number, x: number, y: number): ModalHit {
  return modalHitTest(width, height, filteredPickerItems(state).length, state.filePickerCursor, x, y);
}
