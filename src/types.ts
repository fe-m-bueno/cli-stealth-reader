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

export interface FolderDiscovery {
  path: string;
  fileName: string;
}
