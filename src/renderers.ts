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
    return wrapText(block.text, width - 2).map((line) => fg(theme.dim, `> ${line}`));
  }
  if (block.type === "scene-break") {
    return [fg(theme.dim, "· · ·")];
  }
  if (block.type === "image") {
    return [fg(theme.warning, `[image] ${block.text}`)];
  }
  const prefix = block.type === "list-item" ? "• " : "";
  return wrapText(`${prefix}${block.text}`, width);
}

function disguisedLine(text: string, index: number): string {
  if (index % 4 === 0) {
    return `const fragment${index} = "${text.replace(/"/g, '\\"')}";`;
  }
  if (index % 4 === 1) {
    return `// ${text}`;
  }
  if (index % 4 === 2) {
    return `function stage${index}() { return "${text.replace(/"/g, '\\"')}"; }`;
  }
  return `timeline.push("${text.replace(/"/g, '\\"')}");`;
}

function renderCode(block: CanonicalBlock, width: number, theme: ThemePreset, blockIndex: number): string[] {
  if (block.type === "heading") {
    return [bold(fg(theme.accent, `// ${block.text.toUpperCase()}`))];
  }
  if (block.type === "scene-break") {
    return [fg(theme.dim, "/* ---------- */")];
  }
  if (block.type === "image") {
    return [fg(theme.warning, `// image: ${block.text}`)];
  }
  const body = disguisedLine(block.text, blockIndex + 1);
  return wrapText(body, width);
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
