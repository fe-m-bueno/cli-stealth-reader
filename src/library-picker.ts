import path from "node:path";
import type { AppState, FolderDiscovery, LibraryEntryWithProgress } from "./types.js";

export type LibraryPickerItem =
  | { kind: "stored"; book: LibraryEntryWithProgress }
  | { kind: "discovered"; discovery: FolderDiscovery };

function normalizedPath(filePath: string): string {
  return path.resolve(filePath);
}

export function libraryPickerItems(state: AppState): LibraryPickerItem[] {
  const books = state.storage.listBooksWithProgress(
    state.librarySortKey,
    state.librarySortDir,
    state.booksTagFilter ?? undefined
  );
  const storedItems: LibraryPickerItem[] = books.map((book) => ({ kind: "stored", book }));
  if (state.booksTagFilter) {
    return storedItems;
  }

  const importedPaths = new Set(books.map((book) => normalizedPath(book.sourcePath)));
  const discoveries = (state.discoveries ?? [])
    .filter((discovery) => !importedPaths.has(normalizedPath(discovery.path)))
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
  if (state.librarySortKey === "title" && state.librarySortDir === "desc") {
    discoveries.reverse();
  }

  return [
    ...storedItems,
    ...discoveries.map((discovery): LibraryPickerItem => ({ kind: "discovered", discovery }))
  ];
}

export function discoveredBookLabel(discovery: FolderDiscovery): string {
  const extension = path.extname(discovery.fileName);
  return extension ? discovery.fileName.slice(0, -extension.length) : discovery.fileName;
}
