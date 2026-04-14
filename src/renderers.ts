import type { CanonicalBlock, RenderMode, ThemePreset } from "./types.js";
import { bold, fg } from "./color.js";

function wrapText(text: string, width: number): string[] {
  if (width <= 0) width = 20;
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
  if (current) lines.push(current);
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

// ─── color helpers ────────────────────────────────────────────────────────────

function kw(t: ThemePreset, s: string)  { return fg(t.keyword, s); }
function fn_(t: ThemePreset, s: string) { return bold(fg(t.accent, s)); }
function str(t: ThemePreset, s: string) { return fg(t.codeString, s); }
function cm(t: ThemePreset, s: string)  { return fg(t.subtle, s); }
function id(t: ThemePreset, s: string)  { return fg(t.foreground, s); }
function tp(t: ThemePreset, s: string)  { return fg(t.accentMuted, s); }
function op(t: ThemePreset, s: string)  { return fg(t.border, s); }
function dm(t: ThemePreset, s: string)  { return fg(t.dim, s); }

function esc(text: string): string {
  return text.replace(/"/g, '\\"').replace(/`/g, "\\`");
}

// ─── contextual naming ────────────────────────────────────────────────────────

function extractWords(text: string): string[] {
  return text
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && /^[a-zA-Z]/.test(w));
}

const MAX_NAME = 10;

function toVarName(words: string[], seed: number, suffix = ""): string {
  const fallbacks = ["data", "result", "value", "content", "item", "output", "state", "ctx"];
  const w = words.length ? words[seed % words.length] : fallbacks[seed % fallbacks.length];
  const base = (w.charAt(0).toLowerCase() + w.slice(1) + suffix);
  return base.slice(0, MAX_NAME);
}

function toTypeName(words: string[], seed: number, suffix = ""): string {
  const fallbacks = ["Data", "Config", "State", "Result", "Options"];
  const w = words.length ? words[seed % words.length] : fallbacks[seed % fallbacks.length];
  const base = (w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() + suffix);
  return base.slice(0, MAX_NAME);
}

function toFuncName(words: string[], seed: number): string {
  const prefixes = ["handle", "process", "render", "format", "get", "create", "build", "parse"];
  const prefix = prefixes[seed % prefixes.length];
  const w = words.length ? words[(seed + 1) % words.length] : "Content";
  const name = prefix + w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  return name.slice(0, MAX_NAME);
}

function lineHash(blockIndex: number, lineIndex: number): number {
  let h = (blockIndex * 53 + lineIndex * 17 + 7) & 0xffff;
  return Math.abs(h);
}

function withGenerics(typeName: string, seed: number): string {
  if (seed % 10 >= 3) return typeName;
  const suffixes = ["<T>", "<T, K>", "<T extends Base>"];
  return typeName + suffixes[seed % 3];
}

// ─── per-line code patterns ───────────────────────────────────────────────────
// Each function takes a single pre-wrapped line of text and renders it as code.

function patConst(line: string, words: string[], seed: number, t: ThemePreset): string {
  const v = toVarName(words, seed);
  return kw(t, "const") + " " + id(t, v) + op(t, " = ") + str(t, `"${esc(line)}"`) + op(t, ";");
}

function patLet(line: string, words: string[], seed: number, t: ThemePreset): string {
  const v = toVarName(words, seed, "Value");
  return kw(t, "let") + " " + id(t, v) + op(t, " = ") + str(t, `"${esc(line)}"`) + op(t, ";");
}

function patComment(line: string, _words: string[], _seed: number, t: ThemePreset): string {
  return cm(t, `// ${line}`);
}

function patReturn(line: string, _words: string[], _seed: number, t: ThemePreset): string {
  return kw(t, "return") + " " + str(t, `\`${esc(line)}\``) + op(t, ";");
}

function patConsoleLog(line: string, _words: string[], _seed: number, t: ThemePreset): string {
  return id(t, "console") + op(t, ".") + fn_(t, "log") + op(t, "(") + str(t, `"${esc(line)}"`) + op(t, ");");
}

function patArrow(line: string, words: string[], seed: number, t: ThemePreset): string {
  const v = toVarName(words, seed);
  return kw(t, "const") + " " + id(t, v) + op(t, " = () => ") + str(t, `\`${esc(line)}\``) + op(t, ";");
}

function patExport(line: string, words: string[], seed: number, t: ThemePreset): string {
  const v = toFuncName(words, seed);
  return kw(t, "export") + " " + kw(t, "const") + " " + id(t, v) + op(t, " = ") + str(t, `"${esc(line)}"`) + op(t, ";");
}

function patThrow(line: string, _words: string[], _seed: number, t: ThemePreset): string {
  return kw(t, "throw") + " " + kw(t, "new") + " " + tp(t, "Error") + op(t, "(") + str(t, `"${esc(line)}"`) + op(t, ");");
}

function patAwait(line: string, words: string[], seed: number, t: ThemePreset): string {
  const f = toFuncName(words, seed);
  return kw(t, "await") + " " + fn_(t, f) + op(t, "(") + str(t, `"${esc(line)}"`) + op(t, ");");
}

function patNullish(line: string, words: string[], seed: number, t: ThemePreset): string {
  const v = toVarName(words, seed);
  return kw(t, "const") + " " + id(t, v) + op(t, " = ") +
    id(t, "state") + op(t, ".") + dm(t, "value") + op(t, " ?? ") + str(t, `"${esc(line)}"`) + op(t, ";");
}

function patOptional(line: string, words: string[], seed: number, t: ThemePreset): string {
  const v = toVarName(words, seed);
  return kw(t, "const") + " " + id(t, v) + op(t, " = ") +
    id(t, "ctx") + op(t, "?.") + dm(t, "text") + op(t, " ?? ") + str(t, `"${esc(line)}"`) + op(t, ";");
}

function patTypeAnnotation(line: string, words: string[], seed: number, t: ThemePreset): string {
  const typeName = toTypeName(words, seed);
  return kw(t, "type") + " " + tp(t, typeName) + op(t, " = ") + str(t, `"${esc(line)}"`) + op(t, ";");
}

function patCast(line: string, words: string[], seed: number, t: ThemePreset): string {
  const v = toVarName(words, seed);
  const typeName = toTypeName(words, seed + 1);
  return kw(t, "const") + " " + id(t, v) + op(t, " = ") +
    str(t, `"${esc(line)}"`) + " " + kw(t, "as") + " " + tp(t, typeName) + op(t, ";");
}

function patGenericCall(line: string, words: string[], seed: number, t: ThemePreset): string {
  const f = toFuncName(words, seed);
  const typeName = toTypeName(words, seed + 2);
  return fn_(t, f) + op(t, "<") + tp(t, typeName) + op(t, ">(") +
    str(t, `"${esc(line)}"`) + op(t, ");");
}

function patDestructure(line: string, words: string[], seed: number, t: ThemePreset): string {
  const prop1 = toVarName(words, seed).slice(0, 6);
  const prop2 = toVarName(words, seed + 3, "Id").slice(0, 6);
  const f = toFuncName(words, seed + 1).slice(0, 7);
  return kw(t, "const") + " " + op(t, "{ ") + dm(t, prop1) + op(t, ", ") + dm(t, prop2) +
    op(t, " } = ") + fn_(t, f) + op(t, "(") + str(t, `"${esc(line)}"`) + op(t, ");");
}

function patSpread(line: string, words: string[], seed: number, t: ThemePreset): string {
  const v = toVarName(words, seed);
  const key = toVarName(words, seed + 2).slice(0, 5);
  return kw(t, "const") + " " + id(t, v) + op(t, " = { ...") +
    id(t, "state") + op(t, `, ${key}: `) + str(t, `"${esc(line)}"`) + op(t, " };");
}

function patTernary(line: string, words: string[], seed: number, t: ThemePreset): string {
  const v = toVarName(words, seed);
  const conds = ["isValid", "flag", "active", "ready", "loaded"];
  const cond = conds[seed % conds.length];
  return kw(t, "const") + " " + id(t, v) + op(t, " = ") +
    dm(t, cond) + op(t, " ? ") + str(t, `"${esc(line)}"`) + op(t, " : ") + dm(t, "null") + op(t, ";");
}

// ─── line selection ───────────────────────────────────────────────────────────

const LINE_PATTERNS = [
  patConst, patComment, patConsoleLog, patArrow,
  patReturn, patLet, patExport, patThrow,
  patAwait, patNullish, patOptional, patTypeAnnotation,
  patCast, patGenericCall, patDestructure, patSpread, patTernary,
] as const;

function disguiseLine(line: string, blockIndex: number, lineIndex: number, t: ThemePreset): string {
  const words = extractWords(line);
  const seed = lineHash(blockIndex, lineIndex);
  const pattern = LINE_PATTERNS[seed % LINE_PATTERNS.length];
  return pattern(line, words, seed, t);
}

// ─── block-level special renderers ───────────────────────────────────────────

function renderImportBlock(words: string[], seed: number, t: ThemePreset): string {
  const name = toFuncName(words, seed);
  const mod = toVarName(words, seed + 2).toLowerCase();
  return kw(t, "import") + " " + op(t, "{ ") + id(t, name) + op(t, " }") +
    " " + kw(t, "from") + " " + str(t, `"./${mod}"`);
}

function renderFuncOpen(words: string[], seed: number, t: ThemePreset): string {
  return kw(t, "function") + " " + fn_(t, toFuncName(words, seed)) + op(t, "() {");
}

function renderAsyncOpen(words: string[], seed: number, t: ThemePreset): string {
  return kw(t, "async") + " " + kw(t, "function") + " " + fn_(t, toFuncName(words, seed)) +
    op(t, "(): ") + tp(t, "Promise") + op(t, "<") + tp(t, "void") + op(t, "> {");
}

function renderInterfaceLines(words: string[], seed: number, t: ThemePreset): string[] {
  const typeName = withGenerics(toTypeName(words, seed), seed);
  const prop1 = toVarName(words, seed + 1);
  const prop2 = toVarName(words, seed + 2, "Id");
  const types = ["string", "number", "boolean"];
  return [
    kw(t, "interface") + " " + tp(t, typeName) + op(t, " {"),
    "  " + dm(t, prop1) + op(t, ": ") + tp(t, types[seed % 3]) + op(t, ";"),
    "  " + dm(t, prop2) + op(t, ": ") + tp(t, types[(seed + 1) % 3]) + op(t, ";"),
    op(t, "}"),
  ];
}

function renderEnumBlock(words: string[], seed: number, t: ThemePreset): string {
  const name = toTypeName(words, seed);
  const members = ["Active", "Pending", "Resolved", "Ready", "Loading", "Done", "Error"];
  const m1 = members[seed % members.length];
  const m2 = members[(seed + 2) % members.length];
  const m3 = members[(seed + 4) % members.length];
  return kw(t, "enum") + " " + tp(t, name) + op(t, " { ") +
    id(t, m1) + op(t, ", ") + id(t, m2) + op(t, ", ") + id(t, m3) + op(t, " }");
}

function renderClassLines(words: string[], seed: number, t: ThemePreset): string[] {
  const decorators = ["Injectable", "Component", "Service", "Controller", "Directive"];
  const decorator = decorators[seed % decorators.length];
  const name = withGenerics(toTypeName(words, seed), seed + 5);
  return [
    op(t, "@") + fn_(t, decorator) + op(t, "()"),
    kw(t, "class") + " " + tp(t, name) + op(t, " {"),
  ];
}

function renderGenericFuncOpen(words: string[], seed: number, t: ThemePreset): string {
  const fname = toFuncName(words, seed);
  const retType = toTypeName(words, seed + 1);
  const extType = toTypeName(words, seed + 2);
  return kw(t, "function") + " " + fn_(t, fname) +
    op(t, "<") + tp(t, "T") + " " + kw(t, "extends") + " " + tp(t, extType) + op(t, ">") +
    op(t, "(") + id(t, "item") + op(t, ": ") + tp(t, "T") + op(t, "): ") +
    tp(t, "Promise") + op(t, "<") + tp(t, retType) + op(t, "> {");
}

// ─── main code renderer ───────────────────────────────────────────────────────

// TEXT_OVERHEAD: max visual chars consumed by code boilerplate around the string value.
// Worst case: patSpread = "const " (6) + name (10) + " = { ...state, " (15) + key (5) + ": \"\";" (6) = 42
// +4 buffer for esc() expanding quotes in text.
const TEXT_OVERHEAD = 46;

function renderCode(block: CanonicalBlock, width: number, theme: ThemePreset, blockIndex: number): string[] {
  if (block.type === "heading") {
    return [bold(fg(theme.accent, `// ${block.text.toUpperCase()}`))];
  }
  if (block.type === "scene-break") {
    return [cm(theme, "/* · · · · · */")];
  }
  if (block.type === "image") {
    return [cm(theme, `// [image${block.text ? `: ${block.text}` : ""}]`)];
  }

  const words = extractWords(block.text);
  const seed = lineHash(blockIndex, 0);
  const textWidth = Math.max(width - TEXT_OVERHEAD, 20);

  // If/else block: text split across both branches
  if (blockIndex % 41 === 0) {
    const conds = ["isValid", "flag", "active", "ready", "loaded"];
    const cond = conds[seed % conds.length];
    const wrapped = wrapText(block.text, textWidth);
    const half = Math.ceil(wrapped.length / 2);
    return [
      kw(theme, "if") + op(theme, " (") + id(theme, cond) + op(theme, ") {"),
      ...wrapped.slice(0, half).map((line, i) => "  " + disguiseLine(line, blockIndex, i, theme)),
      op(theme, "} else {"),
      ...wrapped.slice(half).map((line, i) => "  " + disguiseLine(line, blockIndex, half + i, theme)),
      op(theme, "}"),
    ];
  }

  // Occasionally open with a structural line (import / enum / interface / function / class / generic)
  const structLines: string[] = [];
  if (blockIndex % 13 === 0) {
    structLines.push(renderImportBlock(words, seed, theme));
  } else if (blockIndex % 17 === 0) {
    structLines.push(renderEnumBlock(words, seed, theme));
  } else if (blockIndex % 19 === 0) {
    structLines.push(...renderInterfaceLines(words, seed, theme));
  } else if (blockIndex % 23 === 0) {
    structLines.push(renderFuncOpen(words, seed, theme));
  } else if (blockIndex % 29 === 0) {
    structLines.push(renderAsyncOpen(words, seed, theme));
  } else if (blockIndex % 31 === 0) {
    structLines.push(...renderClassLines(words, seed, theme));
  } else if (blockIndex % 37 === 0) {
    structLines.push(renderGenericFuncOpen(words, seed, theme));
  }

  const wrapped = wrapText(block.text, textWidth);
  const indent = structLines.length > 0 ? "  " : "";
  const bodyLines = wrapped.map((line, lineIndex) => {
    const disguised = disguiseLine(line, blockIndex, lineIndex, theme);
    return indent + disguised;
  });

  const result = [...structLines, ...bodyLines];
  const needsClose = blockIndex % 23 === 0 || blockIndex % 29 === 0 ||
    blockIndex % 31 === 0 || blockIndex % 37 === 0;
  if (structLines.length > 0 && needsClose) {
    result.push(op(theme, "}"));
  }
  return result;
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
