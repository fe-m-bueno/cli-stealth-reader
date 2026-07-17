import { fg, paintBackground } from "./color.js";
import { fuzzyFilter } from "./fuzzy.js";
import {
  composeModal,
  modalHitTest,
  padAnsi,
  renderModalFrame,
  type ModalHit
} from "./modal.js";
import { clamp, stripAnsi, truncate } from "./screen.js";
import { APPEARANCE_THEMES, THEMES } from "./themes.js";
import type { AppState, AppearanceThemePreset, Bookmark, CanonicalChapter, Note, ThemePreset } from "./types.js";

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

export function formatRelativeTime(timestamp: number): string {
  const elapsedMs = Math.max(0, Date.now() - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (elapsedMs < minute) {
    return "agora";
  }
  if (elapsedMs < hour) {
    const minutes = Math.floor(elapsedMs / minute);
    return `há ${minutes} min`;
  }
  if (elapsedMs < day) {
    const hours = Math.floor(elapsedMs / hour);
    return `há ${hours} h`;
  }
  const days = Math.floor(elapsedMs / day);
  return `há ${days} dia${days > 1 ? "s" : ""}`;
}

export interface FilteredChapterItem {
  item: CanonicalChapter;
  index: number;
}

export function filteredChapterItems(state: AppState): FilteredChapterItem[] {
  const chapters = state.currentBook?.chapters ?? [];
  const entries = chapters.map((item, index) => ({ item, index }));
  return fuzzyFilter(overlayQuery(state), entries, (entry) => entry.item.title);
}

function bookmarkLocation(bookmark: Bookmark): string {
  return `Ch.${bookmark.chapterIndex + 1} §${bookmark.blockOffset}`;
}

export function filteredBookmarkItems(state: AppState): Bookmark[] {
  const bookmarks = state.currentBook ? state.storage.listBookmarks(state.currentBook.id) : [];
  return fuzzyFilter(overlayQuery(state), bookmarks, (bookmark) => `${bookmark.label ?? ""} ${bookmarkLocation(bookmark)}`);
}

function noteLocation(note: Note): string {
  return note.chapterIndex !== null
    ? `Ch.${note.chapterIndex + 1} §${note.blockOffset ?? 0}`
    : "Book";
}

export function filteredNoteItems(state: AppState): Note[] {
  const notes = state.currentBook ? state.storage.listNotes(state.currentBook.id) : [];
  return fuzzyFilter(overlayQuery(state), notes, (note) => `${note.content} ${noteLocation(note)}`);
}

export function filteredColorschemeItems(state: AppState): ThemePreset[] {
  return fuzzyFilter(overlayQuery(state), THEMES, (item) => `${item.label} ${item.id}`);
}

export function filteredThemeItems(state: AppState): AppearanceThemePreset[] {
  return fuzzyFilter(overlayQuery(state), APPEARANCE_THEMES, (item) => `${item.label} ${item.id}`);
}

function paintRow(state: AppState, content: string, contentWidth: number, selected: boolean): string {
  const plain = padAnsi(truncate(content, contentWidth), contentWidth);
  return selected
    ? paintBackground(state.theme.border, fg(state.theme.foreground, plain))
    : fg(state.theme.foreground, plain);
}

function agedRow(state: AppState, left: string, createdAt: number, contentWidth: number, selected: boolean): string {
  const age = `[${formatRelativeTime(createdAt)}]`;
  const leftText = truncate(left, Math.max(1, contentWidth - age.length - 1));
  const gap = " ".repeat(Math.max(1, contentWidth - stripAnsi(leftText).length - age.length));
  return paintRow(state, `${leftText}${gap}${age}`, contentWidth, selected);
}

interface ListModalOptions<T> {
  title: string;
  items: T[];
  cursor: number;
  emptyMessage: string;
  row: (item: T, contentWidth: number, selected: boolean) => string;
  footerHints: Array<{ key: string; label: string }>;
}

function renderListModal<T>(state: AppState, options: ListModalOptions<T>, width: number, height: number): string[] {
  return renderModalFrame({
    theme: state.theme,
    title: options.title,
    search: searchState(state),
    rowCount: Math.max(options.items.length, 1),
    cursor: options.cursor,
    renderRow: (index, contentWidth, selected) => {
      const item = options.items[index];
      if (item === undefined) {
        return fg(state.theme.dim, options.emptyMessage);
      }
      return options.row(item, contentWidth, selected);
    },
    footerHints: state.overlaySearchMode
      ? [
          { key: "Esc", label: "exit search" },
          { key: "Enter", label: "confirm" }
        ]
      : options.footerHints
  }, width, height);
}

// Front matter (cover, preface) shifts the spine index off the book's own
// chapter numbering, so a number already present in the title wins over index+1.
export function chapterRowNumber(title: string, index: number): string {
  const match = /\d+/.exec(title);
  const value = match ? Number(match[0]) : index + 1;
  return String(value).padStart(2, "0");
}

export function renderChaptersModal(state: AppState, width: number, height: number): string[] {
  const items = filteredChapterItems(state);
  state.overlayCursor = clamp(state.overlayCursor, 0, Math.max(0, items.length - 1));
  return renderListModal(state, {
    title: state.currentBook ? `Chapters · ${state.currentBook.title}` : "Chapters",
    items,
    cursor: state.overlayCursor,
    emptyMessage: state.currentBook ? "No chapters match." : "No book open.",
    row: (entry, contentWidth, selected) =>
      paintRow(state, `${chapterRowNumber(entry.item.title, entry.index)} ${entry.item.title}`, contentWidth, selected),
    footerHints: [
      { key: "Enter", label: "go" },
      { key: "Esc", label: "close" }
    ]
  }, width, height);
}

export function renderBookmarksModal(state: AppState, width: number, height: number): string[] {
  const items = filteredBookmarkItems(state);
  state.overlayCursor = clamp(state.overlayCursor, 0, Math.max(0, items.length - 1));
  return renderListModal(state, {
    title: "Bookmarks",
    items,
    cursor: state.overlayCursor,
    emptyMessage: state.currentBook ? "No bookmarks match." : "No book open.",
    row: (bookmark, contentWidth, selected) => {
      const label = bookmark.label ? ` — "${bookmark.label}"` : "";
      return agedRow(state, `${bookmarkLocation(bookmark)}${label}`, bookmark.createdAt, contentWidth, selected);
    },
    footerHints: [
      { key: "Enter", label: "go" },
      { key: "d", label: "delete" },
      { key: "Esc", label: "close" }
    ]
  }, width, height);
}

export function renderNotesModal(state: AppState, width: number, height: number): string[] {
  const items = filteredNoteItems(state);
  state.overlayCursor = clamp(state.overlayCursor, 0, Math.max(0, items.length - 1));
  return renderListModal(state, {
    title: "Notes",
    items,
    cursor: state.overlayCursor,
    emptyMessage: state.currentBook ? "No notes for this book yet." : "No book open.",
    row: (note, contentWidth, selected) =>
      agedRow(state, `${noteLocation(note)}  "${note.content}"`, note.createdAt, contentWidth, selected),
    footerHints: [
      { key: "Enter", label: "go" },
      { key: "d", label: "delete" },
      { key: "Esc", label: "close" }
    ]
  }, width, height);
}

export function renderColorschemesModal(state: AppState, width: number, height: number): string[] {
  const items = filteredColorschemeItems(state);
  state.overlayCursor = clamp(state.overlayCursor, 0, Math.max(0, items.length - 1));
  return renderListModal(state, {
    title: "Colorscheme",
    items,
    cursor: state.overlayCursor,
    emptyMessage: "No colorschemes match.",
    row: (item, contentWidth, selected) => paintRow(state, `${item.label} (${item.id})`, contentWidth, selected),
    footerHints: [
      { key: "Enter", label: "apply" },
      { key: "Esc", label: "close" }
    ]
  }, width, height);
}

export function renderThemesModal(state: AppState, width: number, height: number): string[] {
  const items = filteredThemeItems(state);
  state.overlayCursor = clamp(state.overlayCursor, 0, Math.max(0, items.length - 1));
  return renderListModal(state, {
    title: "Theme",
    items,
    cursor: state.overlayCursor,
    emptyMessage: "No themes match.",
    row: (item, contentWidth, selected) => paintRow(state, `${item.label} (${item.id})`, contentWidth, selected),
    footerHints: [
      { key: "Enter", label: "apply" },
      { key: "Esc", label: "close" }
    ]
  }, width, height);
}

export type ListOverlayKind = "chapters" | "bookmarks" | "notes" | "colorschemes" | "themes";

export function isListModalOverlay(overlay: AppState["overlay"]): overlay is ListOverlayKind {
  return overlay === "chapters" || overlay === "bookmarks" || overlay === "notes"
    || overlay === "colorschemes" || overlay === "themes";
}

export function listOverlayItemCount(state: AppState): number {
  switch (state.overlay) {
    case "chapters":
      return filteredChapterItems(state).length;
    case "bookmarks":
      return filteredBookmarkItems(state).length;
    case "notes":
      return filteredNoteItems(state).length;
    case "colorschemes":
      return filteredColorschemeItems(state).length;
    case "themes":
      return filteredThemeItems(state).length;
    default:
      return 0;
  }
}

function renderListOverlayModal(state: AppState, width: number, height: number): string[] {
  switch (state.overlay) {
    case "chapters":
      return renderChaptersModal(state, width, height);
    case "bookmarks":
      return renderBookmarksModal(state, width, height);
    case "notes":
      return renderNotesModal(state, width, height);
    case "colorschemes":
      return renderColorschemesModal(state, width, height);
    default:
      return renderThemesModal(state, width, height);
  }
}

export function composeListOverlayModal(state: AppState, backgroundLines: string[], width: number, height: number): string[] {
  return composeModal(state.theme, renderListOverlayModal(state, width, height), backgroundLines, width, height);
}

export function listOverlayModalHitTest(state: AppState, width: number, height: number, x: number, y: number): ModalHit {
  return modalHitTest(width, height, listOverlayItemCount(state), state.overlayCursor, x, y);
}

export function chaptersModalHitTest(state: AppState, width: number, height: number, x: number, y: number): ModalHit {
  return modalHitTest(width, height, filteredChapterItems(state).length, state.overlayCursor, x, y);
}
