import type { ThemePreset } from "../types.js";
import { bold, fg } from "../color.js";

export function wrapText(text: string, width: number): string[] {
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

export function extractWords(text: string): string[] {
  return text
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && /^[a-zA-Z]/.test(w));
}

export const MAX_NAME = 10;

export function lineHash(blockIndex: number, lineIndex: number): number {
  const h = (blockIndex * 53 + lineIndex * 17 + 7) & 0xffff;
  return Math.abs(h);
}

export function esc(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function toVarName(words: string[], seed: number, suffix = ""): string {
  const fallbacks = ["data", "result", "value", "content", "item", "output", "state", "ctx"];
  const w = words.length ? words[seed % words.length] : fallbacks[seed % fallbacks.length];
  return (w.charAt(0).toLowerCase() + w.slice(1) + suffix).slice(0, MAX_NAME);
}

export function toTypeName(words: string[], seed: number, suffix = ""): string {
  const fallbacks = ["Data", "Config", "State", "Result", "Options"];
  const w = words.length ? words[seed % words.length] : fallbacks[seed % fallbacks.length];
  return (w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() + suffix).slice(0, MAX_NAME);
}

export function toFuncName(words: string[], seed: number): string {
  const prefixes = ["handle", "process", "render", "format", "get", "create", "build", "parse"];
  const prefix = prefixes[seed % prefixes.length];
  const w = words.length ? words[(seed + 1) % words.length] : "Content";
  return (prefix + w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).slice(0, MAX_NAME + 4);
}

export function toSnakeName(words: string[], seed: number, suffix = ""): string {
  const fallbacks = ["data", "result", "value", "content", "item", "output", "state", "ctx"];
  const w = words.length ? words[seed % words.length] : fallbacks[seed % fallbacks.length];
  const base = w.toLowerCase() + (suffix ? `_${suffix.toLowerCase()}` : "");
  return base.slice(0, MAX_NAME + 3);
}

export function toSnakeFuncName(words: string[], seed: number): string {
  const prefixes = ["handle", "process", "render", "format", "get", "create", "build", "parse"];
  const prefix = prefixes[seed % prefixes.length];
  const w = words.length ? words[(seed + 1) % words.length] : "content";
  return `${prefix}_${w.toLowerCase()}`.slice(0, MAX_NAME + 5);
}

// ─── color helpers ────────────────────────────────────────────────────────────
export function kw(t: ThemePreset, s: string)  { return fg(t.keyword, s); }
export function fn_(t: ThemePreset, s: string) { return bold(fg(t.accent, s)); }
export function str(t: ThemePreset, s: string) { return fg(t.codeString, s); }
export function cm(t: ThemePreset, s: string)  { return fg(t.subtle, s); }
export function id(t: ThemePreset, s: string)  { return fg(t.foreground, s); }
export function tp(t: ThemePreset, s: string)  { return fg(t.accentMuted, s); }
export function op(t: ThemePreset, s: string)  { return fg(t.border, s); }
export function dm(t: ThemePreset, s: string)  { return fg(t.dim, s); }
