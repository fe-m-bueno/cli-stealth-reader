import type { LineSpacing } from "./types.js";

export const FONT_SCALES = [1, 1.15, 1.3, 1.5] as const;
export const MARGIN_SIZES = [0, 4, 8, 12, 16, 24] as const;
export const LINE_SPACINGS: readonly LineSpacing[] = ["compact", "normal", "relaxed"];

export function isFontScale(value: number): boolean {
  return FONT_SCALES.some((candidate) => candidate === value);
}

export function isMarginSize(value: number): boolean {
  return MARGIN_SIZES.some((candidate) => candidate === value);
}

export function isLineSpacing(value: string): value is LineSpacing {
  return LINE_SPACINGS.some((candidate) => candidate === value);
}
