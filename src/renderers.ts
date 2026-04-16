import type { CanonicalBlock, CodeDensity, CodeLanguage, RenderMode, ThemePreset } from "./types.js";
import { bold, fg, highlightPreservingCSI } from "./color.js";
import { wrapText, lineHash } from "./renderers/shared.js";
import { renderCodeTypescript } from "./renderers/typescript.js";
import { renderCodePython } from "./renderers/python.js";
import { renderCodeRust } from "./renderers/rust.js";

interface DialogueSpan {
  start: number;
  end: number;
}

interface IndexedChar {
  char: string;
  sourceIndex: number | null;
}

interface IndexedWord {
  text: string;
  start: number;
  end: number;
}

const QUOTE_PAIRS = [
  { open: "\"", close: "\"", single: false },
  { open: "'", close: "'", single: true },
  { open: "“", close: "”", single: false },
  { open: "‘", close: "’", single: true },
  { open: "«", close: "»", single: false }
] as const;

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /^[\p{L}\p{N}_]$/u.test(char);
}

function isEscaped(text: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function isSingleQuoteBoundary(text: string, openIndex: number, closeIndex: number): boolean {
  const beforeOpen = text[openIndex - 1];
  const afterOpen = text[openIndex + 1];
  const beforeClose = text[closeIndex - 1];
  const afterClose = text[closeIndex + 1];
  if (isWordChar(beforeOpen) || isWordChar(afterClose)) {
    return false;
  }
  if (!afterOpen || /\s/u.test(afterOpen) || !beforeClose || /\s/u.test(beforeClose)) {
    return false;
  }
  const content = text.slice(openIndex + 1, closeIndex);
  return !(content.length === 1 && isWordChar(content));
}

function findClosingQuote(text: string, openIndex: number, close: string, single: boolean): number {
  for (let cursor = openIndex + 1; cursor < text.length; cursor += 1) {
    if (text[cursor] !== close || isEscaped(text, cursor)) {
      continue;
    }
    if (single && !isSingleQuoteBoundary(text, openIndex, cursor)) {
      continue;
    }
    return cursor;
  }
  return -1;
}

function collectDialogueSpans(line: string): DialogueSpan[] {
  const spans: Array<{ start: number; end: number }> = [];
  for (let cursor = 0; cursor < line.length; cursor += 1) {
    if (isEscaped(line, cursor)) {
      continue;
    }
    const pair = QUOTE_PAIRS.find((candidate) => candidate.open === line[cursor]);
    if (!pair) {
      continue;
    }
    if ((line[cursor + 1] === undefined || /\s/u.test(line[cursor + 1])) && pair.open !== "«") {
      continue;
    }
    const closeIndex = findClosingQuote(line, cursor, pair.close, pair.single);
    if (closeIndex > cursor) {
      spans.push({ start: cursor, end: closeIndex + 1 });
      cursor = closeIndex;
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

function isDialogueIndex(index: number, spans: DialogueSpan[]): boolean {
  return spans.some((span) => index >= span.start && index < span.end);
}

function isInsertedSpaceDialogue(previousIndex: number, nextIndex: number, spans: DialogueSpan[]): boolean {
  return spans.some((span) => previousIndex >= span.start && nextIndex < span.end);
}

function renderIndexedChars(chars: IndexedChar[], spans: DialogueSpan[], theme: ThemePreset): string {
  let result = "";
  let segment = "";
  let segmentDialogue: boolean | null = null;
  const flush = () => {
    if (segmentDialogue === null) {
      return;
    }
    result += fg(segmentDialogue ? theme.accent : theme.foreground, segment);
    segment = "";
    segmentDialogue = null;
  };

  for (let index = 0; index < chars.length; index += 1) {
    const item = chars[index];
    let dialogue = false;
    if (item.sourceIndex !== null) {
      dialogue = isDialogueIndex(item.sourceIndex, spans);
    } else {
      const previous = chars[index - 1]?.sourceIndex;
      const next = chars[index + 1]?.sourceIndex;
      dialogue = previous !== undefined
        && previous !== null
        && next !== undefined
        && next !== null
        && isInsertedSpaceDialogue(previous, next, spans);
    }
    if (segmentDialogue !== dialogue) {
      flush();
      segmentDialogue = dialogue;
    }
    segment += item.char;
  }
  flush();
  if (!result) {
    return fg(theme.foreground, "");
  }
  return result;
}

export function renderWithDialogueHighlight(line: string, theme: ThemePreset): string {
  const spans = collectDialogueSpans(line);
  const chars: IndexedChar[] = [];
  for (let index = 0; index < line.length;) {
    const codePoint = line.codePointAt(index);
    const char = codePoint === undefined ? line[index] : String.fromCodePoint(codePoint);
    chars.push({ char, sourceIndex: index });
    index += char.length;
  }
  return renderIndexedChars(chars, spans, theme);
}

function indexedWords(text: string): IndexedWord[] {
  const words: IndexedWord[] = [];
  const pattern = /\S+/gu;
  let match: RegExpExecArray | null = pattern.exec(text);
  while (match) {
    words.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length
    });
    match = pattern.exec(text);
  }
  return words;
}

function renderWrappedTextWithDialogueHighlight(text: string, width: number, theme: ThemePreset): string[] {
  if (width <= 0) width = 20;
  const spans = collectDialogueSpans(text);
  const words = indexedWords(text);
  if (words.length === 0) {
    return [fg(theme.foreground, "")];
  }

  const rendered: string[] = [];
  let currentText = "";
  let currentChars: IndexedChar[] = [];
  const pushCurrent = () => {
    rendered.push(renderIndexedChars(currentChars, spans, theme));
    currentText = "";
    currentChars = [];
  };

  for (const word of words) {
    const nextText = currentText ? `${currentText} ${word.text}` : word.text;
    if (nextText.length > width && currentText) {
      pushCurrent();
    }
    if (currentText) {
      currentText += " ";
      currentChars.push({ char: " ", sourceIndex: null });
    }
    currentText += word.text;
    for (let index = 0; index < word.text.length; index += 1) {
      currentChars.push({ char: word.text[index], sourceIndex: word.start + index });
    }
  }
  if (currentChars.length > 0) {
    pushCurrent();
  }
  return rendered.length ? rendered : [fg(theme.foreground, "")];
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
  const text = `${prefix}${block.text}`;
  return plainHighlight
    ? renderWrappedTextWithDialogueHighlight(text, width, theme)
    : wrapText(text, width).map((line) => fg(theme.foreground, line));
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
