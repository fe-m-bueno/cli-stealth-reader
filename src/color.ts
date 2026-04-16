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

const ANSI_FG_CODES: Record<string, number> = {
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  brightblack: 90,
  brightred: 91,
  brightgreen: 92,
  brightyellow: 93,
  brightblue: 94,
  brightmagenta: 95,
  brightcyan: 96,
  brightwhite: 97,
  gray: 90,
  grey: 90
};

function wrap(code: string, text: string): string {
  return `\x1b[${code}m${text}\x1b[0m`;
}

function ansiName(color: string): string | null {
  if (!color.startsWith("ansi:")) {
    return null;
  }
  return color.slice("ansi:".length).replace(/[\s_-]/g, "").toLowerCase();
}

function ansiCode(color: string, target: "fg" | "bg"): number | null {
  const name = ansiName(color);
  if (!name) {
    return null;
  }
  const fgCode = ANSI_FG_CODES[name];
  if (fgCode === undefined) {
    throw new Error(`Unknown ANSI color: ${color}`);
  }
  return target === "fg" ? fgCode : fgCode + 10;
}

function fgOpen(color: string): string {
  const code = ansiCode(color, "fg");
  if (code !== null) {
    return `\x1b[${code}m`;
  }
  const { r, g, b } = hexToRgb(color);
  return `\x1b[38;2;${r};${g};${b}m`;
}

function bgOpen(color: string): string {
  const code = ansiCode(color, "bg");
  if (code !== null) {
    return `\x1b[${code}m`;
  }
  const { r, g, b } = hexToRgb(color);
  return `\x1b[48;2;${r};${g};${b}m`;
}

export function fg(hex: string, text: string): string {
  return `${fgOpen(hex)}${text}\x1b[0m`;
}

export function bold(text: string): string {
  return wrap("1", text);
}

export function inverse(text: string): string {
  return wrap("7", text);
}

export function bg(hex: string, text: string): string {
  return `${bgOpen(hex)}${text}\x1b[0m`;
}

export function paintBackground(color: string, text: string, foreground?: string): string {
  const reopen = `${bgOpen(color)}${foreground ? fgOpen(foreground) : ""}`;
  return `${reopen}${text.replace(/\x1b\[0m/g, `\x1b[0m${reopen}`)}\x1b[0m`;
}

/** Highlight case-insensitive matches without splitting inside CSI `\\x1b[...m` sequences. */
export function highlightPreservingCSI(full: string, query: string, warningHex: string, textOnWarningHex: string): string {
  if (!query) {
    return full;
  }
  const qLower = query.toLowerCase();
  const qLen = query.length;
  let out = "";
  let i = 0;
  while (i < full.length) {
    if (full[i] === "\x1b") {
      const match = /^\x1b\[[0-9;]*m/.exec(full.slice(i));
      if (match) {
        out += match[0];
        i += match[0].length;
        continue;
      }
    }
    if (i + qLen <= full.length && full.slice(i, i + qLen).toLowerCase() === qLower) {
      let crosses = false;
      for (let j = i + 1; j < i + qLen; j += 1) {
        if (full[j] === "\x1b") {
          crosses = true;
          break;
        }
      }
      if (!crosses) {
        const slice = full.slice(i, i + qLen);
        out += `${bgOpen(warningHex)}${fgOpen(textOnWarningHex)}${slice}\x1b[0m`;
        i += qLen;
        continue;
      }
    }
    out += full[i];
    i += 1;
  }
  return out;
}
