export type RenderMode = "code" | "plain";

export type CodeLanguage = "typescript" | "python" | "rust";

export type CodeDensity = 1 | 2 | 3 | 4 | 5;
export type LineSpacing = "compact" | "normal" | "relaxed";
export type SettingsTab = "themes" | "reading" | "layout" | "more";

export type ProgressVisibility =
  | "time-chapter"
  | "time-book"
  | "book"
  | "both"
  | "chapter"
  | "hidden";

export interface BookReadingPace {
  bookId: string;
  wpm: number;
  activeMs: number;
  updatedAt: number;
}

export interface PaceState {
  globalWpm: number;
  globalActiveMs: number;
  bookId: string | null;
  bookWpm: number;
  bookActiveMs: number;
  /** Absolute word cursor at last sample (for forward-only delta). */
  lastWordCursor: number | null;
  lastSampleAt: number | null;
}

export interface PaceSample {
  wordsAdvanced: number;
  activeMs: number;
}

export interface ChapterWordInfo {
  wordCount: number;
}

export type LibrarySortKey = "lastOpened" | "title" | "author" | "progress";
export type SortDirection = "asc" | "desc";

export type BlockType =
  | "heading"
  | "paragraph"
  | "blockquote"
  | "list-item"
  | "scene-break"
  | "image"
  | "anchor";

export interface CanonicalBlock {
  id: string;
  type: BlockType;
  text: string;
  level?: number;
  imageSource?: string;
  anchorId?: string;
}

export interface CanonicalChapter {
  id: string;
  index: number;
  title: string;
  href: string;
  depth: number;
  blocks: CanonicalBlock[];
  wordCount: number;
}

export interface CanonicalBook {
  id: string;
  title: string;
  author: string;
  sourcePath: string;
  importHash: string;
  parserVersion?: number;
  diagnostics: ImportDiagnostic[];
  chapters: CanonicalChapter[];
  coverPath?: string;
}

export interface ImportDiagnostic {
  severity: "warning" | "error";
  message: string;
  context?: string;
}

export interface ReadingPosition {
  bookId: string;
  chapterIndex: number;
  chapterProgress: number;
  bookProgress: number;
  blockOffset: number;
}

export interface Bookmark {
  id: string;
  bookId: string;
  chapterIndex: number;
  blockOffset: number;
  label: string | null;
  createdAt: number;
}

export interface Note {
  id: string;
  bookId: string;
  chapterIndex: number | null;
  blockOffset: number | null;
  content: string;
  createdAt: number;
}

export interface LibraryEntry {
  id: string;
  title: string;
  author: string;
  sourcePath: string;
  importHash: string;
  parserVersion?: number;
  lastOpenedAt: number;
  renderMode: RenderMode;
}

export interface LibraryEntryWithProgress extends LibraryEntry {
  chapterIndex: number | null;
  chapterTitle: string | null;
  bookProgress: number | null;
}

export interface ThemePreset {
  id: string;
  label: string;
  accent: string;
  accentMuted: string;
  foreground: string;
  dim: string;
  background: string;
  border: string;
  warning: string;
  keyword: string;
  codeString: string;
  subtle: string;
}

export type AppearanceThemeId =
  | "dark"
  | "light"
  | "dark-colorblind"
  | "light-colorblind"
  | "dark-ansi"
  | "light-ansi";

export interface AppearanceThemePreset {
  id: AppearanceThemeId;
  label: string;
}

export interface AppSettings {
  themeId: string;
  appearanceThemeId: AppearanceThemeId;
  progressVisibility: ProgressVisibility;
  renderMode: RenderMode;
  codeLanguage: CodeLanguage;
  codeDensity: CodeDensity;
  plainHighlight: boolean;
  fontScale: number;
  marginSize: number;
  lineSpacing: LineSpacing;
  mouseCapture: boolean;
}

export interface CommandArgSpec {
  name: string;
  required?: boolean;
}

export interface CommandFlagSpec {
  name: string;
  alias?: string;
  takesValue?: boolean;
}

export interface CommandDefinition {
  name: string;
  aliases?: string[];
  description: string;
  args?: CommandArgSpec[];
  flags?: CommandFlagSpec[];
  usage: string;
  details?: string[];
  examples?: string[];
  notes?: string[];
}

export interface ParsedCommandResult {
  name: string;
  args: string[];
  flags: Record<string, string | boolean>;
}

export interface CommandSuggestion {
  name: string;
  usage: string;
  description: string;
  category: string;
  detail: string;
  aliases: string[];
  matchedAlias?: string;
  completion?: string;
  completionStart?: number;
  completionEnd?: number;
}

export interface FolderDiscovery {
  path: string;
  fileName: string;
}

export type OverlayKind = "none" | "chapters" | "books" | "bookmarks" | "notes" | "colorschemes" | "themes" | "settings" | "help" | "keys" | "diagnostics" | "file-picker";

export interface ExportPosition {
  bookImportHash: string;
  bookTitle: string;
  chapterIndex: number;
  blockOffset: number;
  bookProgress: number;
}

export interface ExportBookmark {
  bookImportHash: string;
  bookTitle: string;
  chapterIndex: number;
  blockOffset: number;
  label: string | null;
  createdAt: number;
}

export interface ExportNote {
  bookImportHash: string;
  bookTitle: string;
  chapterIndex: number | null;
  blockOffset: number | null;
  content: string;
  createdAt: number;
}

export interface ExportTag {
  bookImportHash: string;
  bookTitle: string;
  tag: string;
}

export interface ExportData {
  version: 1;
  exportedAt: string;
  positions: ExportPosition[];
  bookmarks: ExportBookmark[];
  notes: ExportNote[];
  tags: ExportTag[];
}

export interface ImportResult {
  positionsUpdated: number;
  bookmarksAdded: number;
  notesAdded: number;
  tagsAdded: number;
}

export interface SearchHit {
  chapterIndex: number;
  blockIndex: number;
  lineIndex: number;
}

export interface SearchState {
  query: string;
  global: boolean;
  results: SearchHit[];
  cursor: number;
}

export interface NavHistoryEntry {
  chapterIndex: number;
  blockOffset: number;
}

export interface AppState {
  storage: import("./storage.js").Storage;
  cwd: string;
  colorScheme: ThemePreset;
  appearanceTheme: AppearanceThemePreset;
  theme: ThemePreset;
  renderMode: RenderMode;
  codeLanguage: CodeLanguage;
  codeDensity: CodeDensity;
  plainHighlight: boolean;
  fontScale: number;
  marginSize: number;
  lineSpacing: LineSpacing;
  progressVisibility: ProgressVisibility;
  /** Runtime reading-pace tracker; see reading-pace.ts */
  readingPace: PaceState;
  currentBook: CanonicalBook | null;
  chapterIndex: number;
  blockOffset: number;
  focusMode: boolean;
  focusBlockIndex: number;
  commandBuffer: string;
  commandCursor: number;
  commandMode: boolean;
  commandSuggestionIndex: number;
  status: string;
  overlay: OverlayKind;
  overlayCursor: number;
  discoveries: FolderDiscovery[];
  shouldQuit: boolean;
  filePickerCursor: number;
  filePickerItems: FolderDiscovery[];
  filePickerSelected: Set<number>;
  filePickerForce: boolean;
  chapterTransition:
    | {
        message: string;
        targetChapterIndex: number;
        stage: number;
      }
    | null;
  mouseDrag:
    | {
        kind: "scrollbar";
        thumbGrabOffset: number;
      }
    | null;
  layoutMetrics:
    | {
        bookId: string;
        renderMode: RenderMode;
        codeLanguage: CodeLanguage;
        codeDensity: CodeDensity;
        lineSpacing: LineSpacing;
        width: number;
        bodyHeight: number;
        chapterLineCounts: number[];
        chapterViewCounts: number[];
      }
    | null;
  searchState: SearchState | null;
  navHistory: NavHistoryEntry[];
  navHistoryCursor: number;
  librarySortKey: LibrarySortKey;
  librarySortDir: SortDirection;
  booksTagFilter: string | null;
  booksTagMap: Map<string, string[]>;
  helpCommand: string | null;
  integrationLines?: string[];
  mouseCapture: boolean;
  shortcutCollapsedCategories?: Set<string>;
  shortcutSearchBuffer?: string;
  shortcutSearchMode?: boolean;
  overlaySearchBuffer?: string;
  overlaySearchMode?: boolean;
  settingsDraft?: AppSettings | null;
  settingsTab?: SettingsTab;
  settingsSearchBuffer?: string;
  settingsSearchMode?: boolean;
}
