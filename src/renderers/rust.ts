import type { CanonicalBlock, ThemePreset } from "../types.js";
import { bold, fg } from "../color.js";
import {
  wrapText, extractWords, lineHash, esc,
  toTypeName, toSnakeName, toSnakeFuncName,
  kw, fn_, str, cm, id, tp, op, dm
} from "./shared.js";

// ─── per-line Rust patterns ───────────────────────────────────────────────────

function patLet(line: string, words: string[], seed: number, t: ThemePreset): string {
  const v = toSnakeName(words, seed);
  return kw(t, "let") + " " + id(t, v) + op(t, " = ") + str(t, `"${esc(line)}"`) + op(t, ";");
}

function patLetMut(line: string, words: string[], seed: number, t: ThemePreset): string {
  const v = toSnakeName(words, seed);
  const types = ["&str", "String", "&[u8]", "i32", "usize"];
  const rsType = types[seed % types.length];
  return kw(t, "let") + " " + kw(t, "mut") + " " + id(t, v) + op(t, ": ") +
    tp(t, rsType) + op(t, " = ") + str(t, `"${esc(line)}"`) + op(t, ";");
}

function patComment(line: string, _words: string[], _seed: number, t: ThemePreset): string {
  return cm(t, `// ${line}`);
}

function patPrintln(line: string, _words: string[], _seed: number, t: ThemePreset): string {
  return fn_(t, "println!") + op(t, "(") + str(t, `"${esc(line)}"`) + op(t, ");");
}

function patEprintln(line: string, _words: string[], _seed: number, t: ThemePreset): string {
  return fn_(t, "eprintln!") + op(t, "(") + str(t, `"${esc(line)}"`) + op(t, ");");
}

function patOk(line: string, _words: string[], _seed: number, t: ThemePreset): string {
  return tp(t, "Ok") + op(t, "(") + str(t, `"${esc(line)}"`) + op(t, ")");
}

function patErr(line: string, _words: string[], _seed: number, t: ThemePreset): string {
  return tp(t, "Err") + op(t, "(") + str(t, `"${esc(line)}"`) + op(t, ")?");
}

function patLetDiscard(line: string, words: string[], seed: number, t: ThemePreset): string {
  const f = toSnakeFuncName(words, seed);
  return kw(t, "let") + " " + id(t, "_") + op(t, " = ") +
    fn_(t, f) + op(t, "(") + str(t, `"${esc(line)}"`) + op(t, ");");
}

function patAssertEq(line: string, _words: string[], _seed: number, t: ThemePreset): string {
  return fn_(t, "assert_eq!") + op(t, "(result, ") + str(t, `"${esc(line)}"`) + op(t, ");");
}

function patFormat(line: string, _words: string[], _seed: number, t: ThemePreset): string {
  return fn_(t, "format!") + op(t, '("{}", ') + str(t, `"${esc(line)}"`) + op(t, ")");
}

function patPush(line: string, words: string[], seed: number, t: ThemePreset): string {
  const v = toSnakeName(words, seed);
  return id(t, v) + op(t, ".") + fn_(t, "push") + op(t, "(") + str(t, `"${esc(line)}"`) + op(t, ");");
}

function patInfo(line: string, _words: string[], _seed: number, t: ThemePreset): string {
  return fn_(t, "info!") + op(t, "(") + str(t, `"${esc(line)}"`) + op(t, ");");
}

function patExpect(line: string, words: string[], seed: number, t: ThemePreset): string {
  const f = toSnakeFuncName(words, seed);
  return fn_(t, f) + op(t, "(") + str(t, `"${esc(line)}"`) + op(t, ")") +
    op(t, ".") + fn_(t, "expect") + op(t, "(") + str(t, '"failed"') + op(t, ")");
}

// ─── line selection ───────────────────────────────────────────────────────────

const LINE_PATTERNS_RS = [
  patLet, patComment, patPrintln, patLetMut,
  patOk, patErr, patLetDiscard, patEprintln,
  patAssertEq, patFormat, patPush, patInfo, patExpect,
] as const;

function disguiseLine(line: string, blockIndex: number, lineIndex: number, t: ThemePreset): string {
  const words = extractWords(line);
  const seed = lineHash(blockIndex, lineIndex);
  const pattern = LINE_PATTERNS_RS[seed % LINE_PATTERNS_RS.length];
  return pattern(line, words, seed, t);
}

// ─── block-level structural renderers ────────────────────────────────────────

function renderFnOpen(words: string[], seed: number, t: ThemePreset): string {
  const fname = toSnakeFuncName(words, seed);
  return kw(t, "fn") + " " + fn_(t, fname) + op(t, "() -> ") + tp(t, "&'static str") + op(t, " {");
}

function renderPubFnOpen(words: string[], seed: number, t: ThemePreset): string {
  const fname = toSnakeFuncName(words, seed);
  const retTypes = ["String", "Result<(), Box<dyn Error>>", "Option<String>"];
  const ret = retTypes[seed % retTypes.length];
  return kw(t, "pub fn") + " " + fn_(t, fname) + op(t, "() -> ") + tp(t, ret) + op(t, " {");
}

function renderImplOpen(words: string[], seed: number, t: ThemePreset): string {
  const name = toTypeName(words, seed);
  return kw(t, "impl") + " " + tp(t, name) + op(t, " {");
}

function renderMatchOpen(words: string[], seed: number, t: ThemePreset): string {
  const v = toSnakeName(words, seed);
  return kw(t, "match") + " " + id(t, v) + op(t, " {");
}

function renderStructLines(words: string[], seed: number, t: ThemePreset): string[] {
  const name = toTypeName(words, seed);
  const field1 = toSnakeName(words, seed + 1);
  const field2 = toSnakeName(words, seed + 2, "id");
  const types = ["String", "u32", "bool", "Vec<String>"];
  return [
    op(t, "#[derive(Debug, Clone)]"),
    kw(t, "struct") + " " + tp(t, name) + op(t, " {"),
    "    " + dm(t, field1) + op(t, ": ") + tp(t, types[seed % 4]) + op(t, ","),
    "    " + dm(t, field2) + op(t, ": ") + tp(t, types[(seed + 1) % 4]) + op(t, ","),
    op(t, "}"),
  ];
}

// ─── main renderer ────────────────────────────────────────────────────────────

// Worst case: patLetMut = "let mut " (8) + name(13) + ": Vec<String> = " (16) + `""` (2) + ";" (1) = 40
const TEXT_OVERHEAD_RS = 44;

export function renderCodeRust(
  block: CanonicalBlock,
  width: number,
  theme: ThemePreset,
  blockIndex: number
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
  const textWidth = Math.max(width - TEXT_OVERHEAD_RS, 20);

  // if/else split
  if (blockIndex % 41 === 0) {
    const conds = ["is_valid", "flag", "active", "ready", "loaded"];
    const cond = conds[seed % conds.length];
    const wrapped = wrapText(block.text, textWidth);
    const half = Math.ceil(wrapped.length / 2);
    return [
      kw(theme, "if") + " " + id(theme, cond) + op(theme, " {"),
      ...wrapped.slice(0, half).map((line, i) => "    " + disguiseLine(line, blockIndex, i, theme)),
      op(theme, "} else {"),
      ...wrapped.slice(half).map((line, i) => "    " + disguiseLine(line, blockIndex, half + i, theme)),
      op(theme, "}"),
    ];
  }

  // Struct definition (with closing brace at end, no body lines inside)
  if (blockIndex % 19 === 0) {
    const structLines = renderStructLines(words, seed, theme);
    return structLines;
  }

  // Structural openers
  const structLines: string[] = [];
  if (blockIndex % 13 === 0) {
    structLines.push(renderFnOpen(words, seed, theme));
  } else if (blockIndex % 17 === 0) {
    structLines.push(renderPubFnOpen(words, seed, theme));
  } else if (blockIndex % 23 === 0) {
    structLines.push(renderImplOpen(words, seed, theme));
  } else if (blockIndex % 29 === 0) {
    structLines.push(renderMatchOpen(words, seed, theme));
  }

  const wrapped = wrapText(block.text, textWidth);
  const indent = structLines.length > 0 ? "    " : "";
  const bodyLines = wrapped.map((line, lineIndex) =>
    indent + disguiseLine(line, blockIndex, lineIndex, theme)
  );

  const result = [...structLines, ...bodyLines];
  if (structLines.length > 0) {
    result.push(op(theme, "}"));
  }
  return result;
}
