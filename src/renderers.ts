import type { CanonicalBlock, RenderMode, ThemePreset } from "./types.js";
import { bold, fg } from "./color.js";

function wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines.length ? lines : [""];
}

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

function disguisedLine(text: string, index: number, theme: ThemePreset): string {
  const escaped = text.replace(/"/g, '\\"');
  if (index % 4 === 0) {
    return (
      fg(theme.keyword, "const") +
      " " +
      fg(theme.foreground, `fragment${index}`) +
      fg(theme.border, " = ") +
      fg(theme.codeString, `"${escaped}"`) +
      fg(theme.border, ";")
    );
  }
  if (index % 4 === 1) {
    return fg(theme.subtle, `// ${text}`);
  }
  if (index % 4 === 2) {
    return (
      fg(theme.keyword, "function") +
      " " +
      fg(theme.foreground, `stage${index}`) +
      fg(theme.border, "() { ") +
      fg(theme.keyword, "return") +
      " " +
      fg(theme.codeString, `"${escaped}"`) +
      fg(theme.border, "; }")
    );
  }
  return (
    fg(theme.foreground, "timeline") +
    fg(theme.border, ".") +
    fg(theme.foreground, "push") +
    fg(theme.border, "(") +
    fg(theme.codeString, `"${escaped}"`) +
    fg(theme.border, ");")
  );
}

function renderCode(block: CanonicalBlock, width: number, theme: ThemePreset, blockIndex: number): string[] {
  if (block.type === "heading") {
    return [bold(fg(theme.accent, `// ${block.text.toUpperCase()}`))];
  }
  if (block.type === "scene-break") {
    return [fg(theme.subtle, "/* · · · · · */")];
  }
  if (block.type === "image") {
    return [fg(theme.subtle, `// image: ${block.text}`)];
  }
  const wrapped = wrapText(block.text, width);
  return wrapped.map((line, lineIndex) => disguisedLine(line, blockIndex * 4 + lineIndex, theme));
}

export function renderBlocks(
  blocks: CanonicalBlock[],
  mode: RenderMode,
  width: number,
  theme: ThemePreset
): string[] {
  const lines: string[] = [];
  blocks.forEach((block, index) => {
    const rendered = mode === "plain" ? renderPlain(block, width, theme) : renderCode(block, width, theme, index);
    lines.push(...rendered, "");
  });
  return lines;
}
