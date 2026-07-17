export const APP_LOCALE = "en";
export const RELATIVE_TIME_LOCALE = "pt-BR";

const appCollator = new Intl.Collator(APP_LOCALE, {
  usage: "sort",
  sensitivity: "base",
  numeric: true
});

const relativeTime = new Intl.RelativeTimeFormat(RELATIVE_TIME_LOCALE, {
  numeric: "always",
  style: "long"
});

export function compareText(left: string, right: string): number {
  return appCollator.compare(left, right);
}

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const elapsedMs = Math.max(0, now - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (elapsedMs < minute) return "agora";
  if (elapsedMs < hour) return relativeTime.format(-Math.floor(elapsedMs / minute), "minute");
  if (elapsedMs < day) return relativeTime.format(-Math.floor(elapsedMs / hour), "hour");
  return relativeTime.format(-Math.floor(elapsedMs / day), "day");
}
