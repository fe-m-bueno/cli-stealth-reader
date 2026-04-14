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

export function bg(hex: string, text: string): string {
  const { r, g, b } = hexToRgb(hex);
  return wrap(`48;2;${r};${g};${b}`, text);
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
        const { r, g, b } = hexToRgb(warningHex);
        const { r: tr, g: tg, b: tb } = hexToRgb(textOnWarningHex);
        out += `\x1b[48;2;${r};${g};${b}m\x1b[38;2;${tr};${tg};${tb}m${slice}\x1b[0m`;
        i += qLen;
        continue;
      }
    }
    out += full[i];
    i += 1;
  }
  return out;
}
