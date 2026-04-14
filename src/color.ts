function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((char) => `${char}${char}`).join("")
    : normalized;
  const numeric = Number.parseInt(value, 16);
  return {
    r: (numeric >> 16) & 255,
    g: (numeric >> 8) & 255,
    b: numeric & 255
  };
}

function wrap(code: string, text: string): string {
  return `\x1b[${code}m${text}\x1b[0m`;
}

export function fg(hex: string, text: string): string {
  const { r, g, b } = hexToRgb(hex);
  return wrap(`38;2;${r};${g};${b}`, text);
}

export function bold(text: string): string {
  return wrap("1", text);
}

export function inverse(text: string): string {
  return wrap("7", text);
}
