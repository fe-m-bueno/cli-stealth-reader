export const DEFAULT_WPM = 230;
export const IDLE_MS = 120_000;
export const COLD_START_MS = 240_000;
export const BOOK_BLEND_MS = 600_000;
export const MIN_INSTANT_WPM = 50;
export const MAX_INSTANT_WPM = 800;

export interface PaceState {
  globalWpm: number;
  globalActiveMs: number;
  bookId: string | null;
  bookWpm: number;
  bookActiveMs: number;
  /** Absolute word cursor at last sample (for forward-only delta). */
  lastWordCursor: number | null;
  lastSampleAt: number | null;
}

export interface PaceSample {
  wordsAdvanced: number;
  activeMs: number;
}

export interface ChapterWordInfo {
  wordCount: number;
}

export function createEmptyPaceState(partial?: Partial<PaceState>): PaceState {
  return {
    globalWpm: DEFAULT_WPM,
    globalActiveMs: 0,
    bookId: null,
    bookWpm: DEFAULT_WPM,
    bookActiveMs: 0,
    lastWordCursor: null,
    lastSampleAt: null,
    ...partial
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function massWeightedWpm(prevWpm: number, prevMs: number, sampleWpm: number, sampleMs: number): number {
  const total = prevMs + sampleMs;
  if (total <= 0) {
    return sampleWpm;
  }
  return (prevWpm * prevMs + sampleWpm * sampleMs) / total;
}

export function applySample(state: PaceState, sample: PaceSample): PaceState {
  const activeMs = Math.min(Math.max(0, sample.activeMs), IDLE_MS);
  const wordsAdvanced = Math.max(0, sample.wordsAdvanced);
  if (wordsAdvanced <= 0 || activeMs <= 0) {
    return state;
  }
  const minutes = activeMs / 60_000;
  const instantWpm = wordsAdvanced / minutes;
  if (instantWpm < MIN_INSTANT_WPM || instantWpm > MAX_INSTANT_WPM) {
    return state;
  }

  return {
    ...state,
    globalWpm: massWeightedWpm(state.globalWpm, state.globalActiveMs, instantWpm, activeMs),
    globalActiveMs: state.globalActiveMs + activeMs,
    bookWpm: massWeightedWpm(state.bookWpm, state.bookActiveMs, instantWpm, activeMs),
    bookActiveMs: state.bookActiveMs + activeMs
  };
}

export function effectiveWpm(state: PaceState): number {
  let base: number;
  if (state.globalActiveMs < COLD_START_MS) {
    const t = state.globalActiveMs / COLD_START_MS;
    base = (1 - t) * DEFAULT_WPM + t * state.globalWpm;
  } else {
    base = state.globalWpm;
  }
  const bookWeight = clamp(state.bookActiveMs / BOOK_BLEND_MS, 0, 1);
  return (1 - bookWeight) * base + bookWeight * state.bookWpm;
}

export function absoluteWordCursor(
  chapters: ChapterWordInfo[],
  chapterIndex: number,
  chapterProgress: number
): number {
  if (chapters.length === 0) {
    return 0;
  }
  let words = 0;
  const safeIndex = clamp(chapterIndex, 0, chapters.length - 1);
  for (let i = 0; i < safeIndex; i += 1) {
    words += Math.max(0, chapters[i]?.wordCount ?? 0);
  }
  const chapterWords = Math.max(0, chapters[safeIndex]?.wordCount ?? 0);
  words += clamp(chapterProgress, 0, 1) * chapterWords;
  return words;
}

export function remainingWordsInChapter(
  chapters: ChapterWordInfo[],
  chapterIndex: number,
  chapterProgress: number
): number {
  const chapterWords = Math.max(0, chapters[chapterIndex]?.wordCount ?? 0);
  return Math.max(0, chapterWords * (1 - clamp(chapterProgress, 0, 1)));
}

export function remainingWordsInBook(
  chapters: ChapterWordInfo[],
  chapterIndex: number,
  chapterProgress: number
): number {
  let remaining = remainingWordsInChapter(chapters, chapterIndex, chapterProgress);
  for (let i = chapterIndex + 1; i < chapters.length; i += 1) {
    remaining += Math.max(0, chapters[i]?.wordCount ?? 0);
  }
  return remaining;
}

export function estimateMinutes(remainingWords: number, wpm: number): number {
  if (remainingWords <= 0 || wpm <= 0) {
    return 0;
  }
  return remainingWords / wpm;
}

/** Format a duration in seconds for the footer. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, totalSeconds);
  const totalMinutes = Math.max(1, Math.ceil(seconds / 60));
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}

export function formatTimeLeft(
  remainingWords: number,
  wpm: number,
  scope: "chapter" | "book"
): string {
  if (remainingWords <= 0 || wpm <= 0) {
    return "—";
  }
  const minutes = estimateMinutes(remainingWords, wpm);
  const label = formatDuration(minutes * 60);
  return scope === "chapter" ? `${label} left in chapter` : `${label} left in book`;
}

/**
 * Given prior tracker fields + new position, produce sample deltas and updated cursor clocks.
 * Pure helper for syncPosition wiring.
 */
export function prepareSample(args: {
  state: PaceState;
  now: number;
  wordCursor: number;
  readingActive: boolean;
}): { sample: PaceSample | null; nextMeta: Pick<PaceState, "lastWordCursor" | "lastSampleAt"> } {
  const { state, now, wordCursor, readingActive } = args;
  if (!readingActive) {
    return {
      sample: null,
      nextMeta: { lastWordCursor: wordCursor, lastSampleAt: state.lastSampleAt }
    };
  }
  if (state.lastWordCursor === null || state.lastSampleAt === null) {
    return {
      sample: null,
      nextMeta: { lastWordCursor: wordCursor, lastSampleAt: now }
    };
  }
  const wordsAdvanced = Math.max(0, wordCursor - state.lastWordCursor);
  const activeMs = Math.max(0, now - state.lastSampleAt);
  return {
    sample: { wordsAdvanced, activeMs },
    nextMeta: { lastWordCursor: wordCursor, lastSampleAt: now }
  };
}
