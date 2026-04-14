export type RenderMode = "code" | "plain";

export type ProgressVisibility = "book" | "both" | "chapter" | "hidden";

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

export interface AppSettings {
  themeId: string;
  progressVisibility: ProgressVisibility;
  renderMode: RenderMode;
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
  aliases: string[];
  matchedAlias?: string;
}

export interface FolderDiscovery {
  path: string;
  fileName: string;
}

export type OverlayKind = "none" | "chapters" | "books" | "themes" | "help" | "keys" | "diagnostics" | "file-picker";

export interface AppState {
  storage: import("./storage.js").Storage;
  cwd: string;
  theme: ThemePreset;
  renderMode: RenderMode;
  progressVisibility: ProgressVisibility;
  currentBook: CanonicalBook | null;
  chapterIndex: number;
  blockOffset: number;
  commandBuffer: string;
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
  layoutMetrics:
    | {
        bookId: string;
        renderMode: RenderMode;
        width: number;
        bodyHeight: number;
        chapterLineCounts: number[];
        chapterViewCounts: number[];
      }
    | null;
}
