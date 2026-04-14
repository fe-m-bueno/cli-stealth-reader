import type { CanonicalBlock, CodeDensity, ThemePreset } from "../types.js";
import { bold, fg } from "../color.js";
import {
  wrapText, extractWords, lineHash, esc,
  toVarName, toTypeName, toFuncName, MAX_NAME,
  kw, fn_, str, cm, id, tp, op, dm
} from "./shared.js";

function withGenerics(typeName: string, seed: number): string {
  if (seed % 10 >= 3) return typeName;
  const suffixes = ["<T>", "<T, K>", "<T extends Base>"];
  return typeName + suffixes[seed % 3];
}

// ─── per-line code patterns ───────────────────────────────────────────────────

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

// "Legíveis": o texto aparece claramente como comentário ou return
const COMMENT_PATTERNS = [patComment, patReturn] as const;

// "Densos": apenas assignments e chamadas
const CODE_PATTERNS = [
  patConst, patLet, patArrow, patConsoleLog, patExport,
  patThrow, patAwait, patNullish, patOptional, patTypeAnnotation,
  patCast, patGenericCall, patDestructure, patSpread, patTernary,
] as const;

function disguiseLine(
  line: string,
  blockIndex: number,
  lineIndex: number,
  t: ThemePreset,
  density: CodeDensity
): string {
  const words = extractWords(line);
  const seed = lineHash(blockIndex, lineIndex);
  // density 1 → 80% comment_patterns; density 5 → 0% comment_patterns
  const commentThreshold = (5 - density) * 20; // 0..80
  const pool = (seed % 100) < commentThreshold ? COMMENT_PATTERNS : CODE_PATTERNS;
  const pattern = pool[seed % pool.length];
  return pattern(line, words, seed, t);
}

// ─── block-level structural renderers ────────────────────────────────────────

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

// ─── main renderer ────────────────────────────────────────────────────────────

// Max visual chars consumed by code boilerplate around the string value.
// Worst case: patSpread = "const " (6) + name (10) + " = { ...state, " (15) + key (5) + ": \"\";" (6) = 42
// +4 buffer for esc() expanding quotes in text.
const TEXT_OVERHEAD = 46;

// Produces body lines for a struct block with variable indentation.
// ~30% of lines get double indent (simulates nested if/for inside the function).
function makeBodyLines(
  wrapped: string[],
  blockIndex: number,
  lineOffset: number,
  baseIndent: string,
  theme: ThemePreset,
  density: CodeDensity
): string[] {
  return wrapped.map((line, i) => {
    const lineIndex = lineOffset + i;
    const disguised = disguiseLine(line, blockIndex, lineIndex, theme, density);
    const isNested = lineHash(blockIndex, lineIndex + 50) % 3 === 0;
    const indent = isNested ? "    " : baseIndent;
    return indent + disguised;
  });
}

export function renderCodeTypescript(
  block: CanonicalBlock,
  width: number,
  theme: ThemePreset,
  blockIndex: number,
  density: CodeDensity = 3
): string[] {
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
    const wrapped = wrapText(block.text, textWidth - 2);
    const half = Math.ceil(wrapped.length / 2);
    return [
      kw(theme, "if") + op(theme, " (") + id(theme, cond) + op(theme, ") {"),
      ...makeBodyLines(wrapped.slice(0, half), blockIndex, 0, "  ", theme, density),
      op(theme, "} else {"),
      ...makeBodyLines(wrapped.slice(half), blockIndex, half, "  ", theme, density),
      op(theme, "}"),
    ];
  }

  // For loop block
  if (blockIndex % 43 === 0) {
    const arrays = ["items", "entries", "records", "nodes", "chunks"];
    const arr = arrays[seed % arrays.length];
    const wrapped = wrapText(block.text, textWidth - 2);
    return [
      kw(theme, "for") + op(theme, " (") + kw(theme, "const") + " " + id(theme, "item") +
        " " + kw(theme, "of") + " " + id(theme, arr) + op(theme, ") {"),
      ...makeBodyLines(wrapped, blockIndex, 0, "  ", theme, density),
      op(theme, "}"),
    ];
  }

  // Try/catch block: text split across both branches
  if (blockIndex % 47 === 0) {
    const errNames = ["err", "error", "e", "ex"];
    const errName = errNames[seed % errNames.length];
    const wrapped = wrapText(block.text, textWidth - 2);
    const half = Math.ceil(wrapped.length / 2);
    return [
      kw(theme, "try") + " " + op(theme, "{"),
      ...makeBodyLines(wrapped.slice(0, half), blockIndex, 0, "  ", theme, density),
      op(theme, "} ") + kw(theme, "catch") + " " + op(theme, "(") + id(theme, errName) + op(theme, ") {"),
      ...makeBodyLines(wrapped.slice(half), blockIndex, half, "  ", theme, density),
      op(theme, "}"),
    ];
  }

  // Occasionally open with a structural line
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

  // Reduce textWidth for struct blocks (indent eats into line width)
  const innerTextWidth = structLines.length > 0 ? Math.max(textWidth - 4, 20) : textWidth;
  const wrapped = wrapText(block.text, innerTextWidth);
  const baseIndent = structLines.length > 0 ? "  " : "";
  const bodyLines = makeBodyLines(wrapped, blockIndex, 0, baseIndent, theme, density);

  const result = [...structLines, ...bodyLines];
  const needsClose = blockIndex % 23 === 0 || blockIndex % 29 === 0 ||
    blockIndex % 31 === 0 || blockIndex % 37 === 0;
  if (structLines.length > 0 && needsClose) {
    result.push(op(theme, "}"));
  }
  return result;
}
