import type { CanonicalBlock, CodeDensity, CodeLanguage, RenderMode, ThemePreset } from "./types.js";
import { bold, fg, highlightPreservingCSI } from "./color.js";
import { wrapText, lineHash } from "./renderers/shared.js";
import { renderCodeTypescript } from "./renderers/typescript.js";
import { renderCodePython } from "./renderers/python.js";
import { renderCodeRust } from "./renderers/rust.js";

function renderPlain(block: CanonicalBlock, width: number, theme: ThemePreset): string[] {
  if (block.type === "heading") {
    return wrapText(block.text.toUpperCase(), width).map((line) => bold(fg(theme.accent, line)));
  }
  if (block.type === "blockquote") {
    return wrapText(block.text, width - 2).map((line) => fg(theme.subtle, `▏ ${line}`));
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
  return wrapText(`${prefix}${block.text}`, width);
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
  searchQuery?: string | null
): string[] {
  const lines: string[] = [];
  blocks.forEach((block, index) => {
    const rendered = mode === "plain"
      ? renderPlain(block, width, theme)
      : renderCode(block, width, theme, index, codeLanguage, codeDensity);
    lines.push(...rendered);

    if (mode === "code") {
      // Vary blank lines: 70% → 1 blank, 20% → 0 blanks, 10% → 2 blanks
      const r = lineHash(index, 999) % 10;
      if (r < 7) {
        lines.push("");
      } else if (r >= 9) {
        lines.push("", "");
      }
      // r === 7 or 8: no blank line (20%)
    } else {
      lines.push("");
    }
  });
  if (searchQuery) {
    return lines.map((line) => highlightPreservingCSI(line, searchQuery, theme.warning, theme.background));
  }
  return lines;
}
