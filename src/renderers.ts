import type { CanonicalBlock, CodeDensity, CodeLanguage, RenderMode, ThemePreset } from "./types.js";
import { bold, fg, highlightPreservingCSI } from "./color.js";
import { wrapText, lineHash } from "./renderers/shared.js";
import { renderCodeTypescript } from "./renderers/typescript.js";
import { renderCodePython } from "./renderers/python.js";
import { renderCodeRust } from "./renderers/rust.js";

const DIALOGUE_PATTERNS = [
  /"((?:\\.|[^"\\])*)"/g,
  /“((?:\\.|[^”\\])*)”/g,
  /'((?:\\.|[^'\\])*)'/g,
  /‘((?:\\.|[^’\\])*)’/g,
  /«((?:\\.|[^»\\])*)»/g
];

function collectDialogueSpans(line: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  for (const pattern of DIALOGUE_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null = pattern.exec(line);
    while (match) {
      if (match[0].length > 0 && typeof match.index === "number") {
        spans.push({
          start: match.index,
          end: match.index + match[0].length
        });
      }
      match = pattern.exec(line);
    }
  }
  const firstNonSpace = line.search(/\S/);
  if (firstNonSpace >= 0 && line[firstNonSpace] === "—") {
    spans.push({ start: firstNonSpace, end: line.length });
  }
  if (spans.length <= 1) {
    return spans;
  }
  const merged: Array<{ start: number; end: number }> = [];
  const sorted = spans.sort((left, right) => left.start - right.start || left.end - right.end);
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (!last || span.start > last.end) {
      merged.push({ ...span });
    } else {
      last.end = Math.max(last.end, span.end);
    }
  }
  return merged;
}

export function renderWithDialogueHighlight(line: string, theme: ThemePreset): string {
  const spans = collectDialogueSpans(line);
  if (spans.length === 0) {
    return fg(theme.foreground, line);
  }
  let result = "";
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) {
      result += fg(theme.foreground, line.slice(cursor, span.start));
    }
    result += fg(theme.accent, line.slice(span.start, span.end));
    cursor = span.end;
  }
  if (cursor < line.length) {
    result += fg(theme.foreground, line.slice(cursor));
  }
  return result;
}

function renderPlain(block: CanonicalBlock, width: number, theme: ThemePreset, plainHighlight: boolean): string[] {
  if (block.type === "heading") {
    return wrapText(block.text.toUpperCase(), width).map((line) => bold(fg(theme.accent, line)));
  }
  if (block.type === "blockquote") {
    return wrapText(block.text, width - 2).map((line) => fg(theme.subtle, `❝ ${line}`));
  }
  if (block.type === "scene-break") {
    const mark = "· · · · ·";
    const padded = mark.padStart(Math.floor((width + mark.length) / 2));
    return [fg(theme.border, padded)];
  }
  if (block.type === "image") {
    return [fg(theme.subtle, `[image${block.text ? `: ${block.text}` : ""}]`)];
  }
  const prefix = block.type === "list-item" ? "  · " : "";
  return wrapText(`${prefix}${block.text}`, width).map((line) => (
    plainHighlight
      ? renderWithDialogueHighlight(line, theme)
      : fg(theme.foreground, line)
  ));
}

function renderCode(
  block: CanonicalBlock,
  width: number,
  theme: ThemePreset,
  blockIndex: number,
  codeLanguage: CodeLanguage,
  codeDensity: CodeDensity
): string[] {
  switch (codeLanguage) {
    case "python":
      return renderCodePython(block, width, theme, blockIndex);
    case "rust":
      return renderCodeRust(block, width, theme, blockIndex);
    default:
      return renderCodeTypescript(block, width, theme, blockIndex, codeDensity);
  }
}

export function renderBlocks(
  blocks: CanonicalBlock[],
  mode: RenderMode,
  width: number,
  theme: ThemePreset,
  codeLanguage: CodeLanguage = "typescript",
  codeDensity: CodeDensity = 3,
  searchQuery?: string | null,
  plainHighlight = true,
  blockIndexOffset = 0,
  includeTrailingSpacing = true
): string[] {
  const lines: string[] = [];
  blocks.forEach((block, index) => {
    const absoluteIndex = blockIndexOffset + index;
    const rendered = mode === "plain"
      ? renderPlain(block, width, theme, plainHighlight)
      : renderCode(block, width, theme, absoluteIndex, codeLanguage, codeDensity);
    lines.push(...rendered);

    if (includeTrailingSpacing || index < blocks.length - 1) {
      if (mode === "code") {
        // Vary blank lines: 70% → 1 blank, 20% → 0 blanks, 10% → 2 blanks
        const r = lineHash(absoluteIndex, 999) % 10;
        if (r < 7) {
          lines.push("");
        } else if (r >= 9) {
          lines.push("", "");
        }
        // r === 7 or 8: no blank line (20%)
      } else {
        lines.push("");
      }
    }
  });
  if (searchQuery) {
    return lines.map((line) => highlightPreservingCSI(line, searchQuery, theme.warning, theme.background));
  }
  return lines;
}
