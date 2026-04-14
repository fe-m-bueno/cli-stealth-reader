import type { CanonicalBlock, ThemePreset } from "../types.js";
import { bold, fg } from "../color.js";
import {
  wrapText, extractWords, lineHash, esc,
  toTypeName, toSnakeName, toSnakeFuncName,
  kw, fn_, str, cm, id, tp, op, dm
} from "./shared.js";

// ─── per-line Python patterns ─────────────────────────────────────────────────

function patAssign(line: string, words: string[], seed: number, t: ThemePreset): string {
  const v = toSnakeName(words, seed);
  return id(t, v) + op(t, " = ") + str(t, `"${esc(line)}"`);
}

function patTypedAssign(line: string, words: string[], seed: number, t: ThemePreset): string {
  const v = toSnakeName(words, seed);
  const types = ["str", "int", "bool", "list[str]", "dict"];
  const pyType = types[seed % types.length];
  return id(t, v) + op(t, ": ") + tp(t, pyType) + op(t, " = ") + str(t, `"${esc(line)}"`);
}

function patPyComment(line: string, _words: string[], _seed: number, t: ThemePreset): string {
  return cm(t, `# ${line}`);
}

function patPrint(line: string, _words: string[], _seed: number, t: ThemePreset): string {
  return fn_(t, "print") + op(t, "(") + str(t, `f"${esc(line)}"`) + op(t, ")");
}

function patPlainPrint(line: string, _words: string[], _seed: number, t: ThemePreset): string {
  return fn_(t, "print") + op(t, "(") + str(t, `"${esc(line)}"`) + op(t, ")");
}

function patReturn(line: string, _words: string[], _seed: number, t: ThemePreset): string {
  return kw(t, "return") + " " + str(t, `"${esc(line)}"`);
}

function patRaise(line: string, _words: string[], _seed: number, t: ThemePreset): string {
  return kw(t, "raise") + " " + tp(t, "ValueError") + op(t, "(") + str(t, `"${esc(line)}"`) + op(t, ")");
}

function patFuncCall(line: string, words: string[], seed: number, t: ThemePreset): string {
  const v = toSnakeName(words, seed);
  const f = toSnakeFuncName(words, seed + 1);
  return id(t, v) + op(t, " = ") + fn_(t, f) + op(t, "(") + str(t, `"${esc(line)}"`) + op(t, ")");
}

function patLogging(line: string, _words: string[], seed: number, t: ThemePreset): string {
  const levels = ["info", "debug", "warning", "error"];
  const level = levels[seed % levels.length];
  return id(t, "logging") + op(t, ".") + fn_(t, level) + op(t, "(") + str(t, `"${esc(line)}"`) + op(t, ")");
}

function patFString(line: string, words: string[], seed: number, t: ThemePreset): string {
  const v = toSnakeName(words, seed);
  return id(t, v) + op(t, " = ") + id(t, "f") + str(t, `"${esc(line)}"`);
}

function patDictAssign(line: string, words: string[], seed: number, t: ThemePreset): string {
  const d = toSnakeName(words, seed);
  const key = toSnakeName(words, seed + 2).slice(0, 6);
  return id(t, d) + op(t, `["${key}"] = `) + str(t, `"${esc(line)}"`);
}

function patAssert(line: string, _words: string[], _seed: number, t: ThemePreset): string {
  return kw(t, "assert") + " " + id(t, "result") + op(t, ", ") + str(t, `"${esc(line)}"`);
}

// ─── line selection ───────────────────────────────────────────────────────────

const LINE_PATTERNS_PY = [
  patAssign, patPyComment, patPrint, patTypedAssign,
  patReturn, patPlainPrint, patFuncCall, patRaise,
  patLogging, patFString, patDictAssign, patAssert,
] as const;

function disguiseLine(line: string, blockIndex: number, lineIndex: number, t: ThemePreset): string {
  const words = extractWords(line);
  const seed = lineHash(blockIndex, lineIndex);
  const pattern = LINE_PATTERNS_PY[seed % LINE_PATTERNS_PY.length];
  return pattern(line, words, seed, t);
}

// ─── block-level structural renderers ────────────────────────────────────────

function renderDefOpen(words: string[], seed: number, t: ThemePreset): string {
  const fname = toSnakeFuncName(words, seed);
  return kw(t, "def") + " " + fn_(t, fname) + op(t, "(self) -> ") + tp(t, "str") + op(t, ":");
}

function renderClassOpen(words: string[], seed: number, t: ThemePreset): string {
  const name = toTypeName(words, seed);
  const bases = ["BaseModel", "Exception", "Enum", "Protocol"];
  const base = bases[seed % bases.length];
  return kw(t, "class") + " " + tp(t, name) + op(t, "(") + tp(t, base) + op(t, "):");
}

function renderWithBlock(words: string[], seed: number, t: ThemePreset): string {
  const fname = toSnakeFuncName(words, seed);
  return kw(t, "with") + " " + fn_(t, fname) + op(t, "(") + str(t, `"data"`) + op(t, ")") +
    " " + kw(t, "as") + " " + id(t, "f") + op(t, ":");
}

function renderIfBlock(words: string[], seed: number, t: ThemePreset): string {
  const conds = ["is_valid", "flag", "active", "ready", "loaded"];
  const cond = conds[seed % conds.length];
  return kw(t, "if") + " " + id(t, cond) + op(t, ":");
}

function renderTryBlock(_words: string[], _seed: number, t: ThemePreset): string[] {
  return [
    kw(t, "try") + op(t, ":"),
  ];
}

// ─── main renderer ────────────────────────────────────────────────────────────

// Worst case: patDictAssign = name(13) + `["key"] = ` (11) + `""` (2) = 26 + buffer
const TEXT_OVERHEAD_PY = 32;

export function renderCodePython(
  block: CanonicalBlock,
  width: number,
  theme: ThemePreset,
  blockIndex: number
): string[] {
  if (block.type === "heading") {
    return [bold(fg(theme.accent, `# ${block.text.toUpperCase()}`))];
  }
  if (block.type === "scene-break") {
    return [cm(theme, "# · · · · ·")];
  }
  if (block.type === "image") {
    return [cm(theme, `# [image${block.text ? `: ${block.text}` : ""}]`)];
  }

  const words = extractWords(block.text);
  const seed = lineHash(blockIndex, 0);
  const textWidth = Math.max(width - TEXT_OVERHEAD_PY, 20);

  // if/else split
  if (blockIndex % 41 === 0) {
    const conds = ["is_valid", "flag", "active", "ready", "loaded"];
    const cond = conds[seed % conds.length];
    const wrapped = wrapText(block.text, textWidth);
    const half = Math.ceil(wrapped.length / 2);
    return [
      kw(theme, "if") + " " + id(theme, cond) + op(theme, ":"),
      ...wrapped.slice(0, half).map((line, i) => "    " + disguiseLine(line, blockIndex, i, theme)),
      kw(theme, "else") + op(theme, ":"),
      ...wrapped.slice(half).map((line, i) => "    " + disguiseLine(line, blockIndex, half + i, theme)),
    ];
  }

  // try/except split
  if (blockIndex % 43 === 0) {
    const wrapped = wrapText(block.text, textWidth);
    const half = Math.ceil(wrapped.length / 2);
    return [
      ...renderTryBlock(words, seed, theme),
      ...wrapped.slice(0, half).map((line, i) => "    " + disguiseLine(line, blockIndex, i, theme)),
      kw(theme, "except") + " " + tp(theme, "Exception") + " " + kw(theme, "as") + " " + id(theme, "e") + op(theme, ":"),
      ...wrapped.slice(half).map((line, i) => "    " + disguiseLine(line, blockIndex, half + i, theme)),
    ];
  }

  // Structural openers
  const structLines: string[] = [];
  if (blockIndex % 13 === 0) {
    structLines.push(renderDefOpen(words, seed, theme));
  } else if (blockIndex % 17 === 0) {
    structLines.push(renderClassOpen(words, seed, theme));
  } else if (blockIndex % 23 === 0) {
    structLines.push(renderWithBlock(words, seed, theme));
  } else if (blockIndex % 29 === 0) {
    structLines.push(renderIfBlock(words, seed, theme));
  }

  const wrapped = wrapText(block.text, textWidth);
  const indent = structLines.length > 0 ? "    " : "";
  const bodyLines = wrapped.map((line, lineIndex) =>
    indent + disguiseLine(line, blockIndex, lineIndex, theme)
  );

  return [...structLines, ...bodyLines];
}
