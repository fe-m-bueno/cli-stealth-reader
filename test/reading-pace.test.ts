import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_WPM,
  IDLE_MS,
  COLD_START_MS,
  BOOK_BLEND_MS,
  createEmptyPaceState,
  applySample,
  effectiveWpm,
  remainingWordsInChapter,
  remainingWordsInBook,
  estimateMinutes,
  formatDuration,
  formatTimeLeft,
  absoluteWordCursor,
  type PaceState,
  type ChapterWordInfo
} from "../src/reading-pace.js";

test("formatDuration ceils sub-minute and formats hours", () => {
  assert.equal(formatDuration(0), "1 min");
  assert.equal(formatDuration(30), "1 min");
  assert.equal(formatDuration(90), "2 min");
  assert.equal(formatDuration(3600), "1h");
  assert.equal(formatDuration(3720), "1h 2m");
});

test("applySample ignores zero words and zero active time", () => {
  const base = createEmptyPaceState();
  const same = applySample(base, { wordsAdvanced: 0, activeMs: 60_000 });
  assert.equal(same.globalWpm, base.globalWpm);
  assert.equal(same.globalActiveMs, base.globalActiveMs);

  const same2 = applySample(base, { wordsAdvanced: 100, activeMs: 0 });
  assert.equal(same2.globalActiveMs, base.globalActiveMs);
});

test("applySample caps activeMs at IDLE_MS", () => {
  const base = createEmptyPaceState();
  const next = applySample(base, { wordsAdvanced: 400, activeMs: IDLE_MS * 3 });
  // Instantaneous WPM uses capped activeMs: 400 words / 2 min = 200 wpm
  assert.ok(next.globalActiveMs <= IDLE_MS);
  assert.ok(next.globalWpm > 0);
});

test("applySample rejects outlier instantaneous WPM", () => {
  const base = createEmptyPaceState();
  // 5000 words in 1 second => absurd WPM
  const next = applySample(base, { wordsAdvanced: 5000, activeMs: 1000 });
  assert.equal(next.globalWpm, base.globalWpm);
  assert.equal(next.globalActiveMs, base.globalActiveMs);
});

test("applySample mass-weights WPM toward observed speed", () => {
  let state = createEmptyPaceState();
  // 400 words in 2 minutes = 200 wpm
  state = applySample(state, { wordsAdvanced: 400, activeMs: 120_000 });
  assert.ok(Math.abs(state.globalWpm - 200) < 1);
  assert.equal(state.globalActiveMs, 120_000);
  assert.ok(Math.abs(state.bookWpm - 200) < 1);
  assert.equal(state.bookActiveMs, 120_000);
});

test("effectiveWpm uses default during cold start then global", () => {
  const cold: PaceState = {
    ...createEmptyPaceState(),
    globalWpm: 100,
    globalActiveMs: 0,
    bookWpm: 100,
    bookActiveMs: 0
  };
  assert.ok(Math.abs(effectiveWpm(cold) - DEFAULT_WPM) < 1);

  const warm: PaceState = {
    ...createEmptyPaceState(),
    globalWpm: 180,
    globalActiveMs: COLD_START_MS,
    bookWpm: 180,
    bookActiveMs: 0
  };
  assert.ok(Math.abs(effectiveWpm(warm) - 180) < 1);
});

test("effectiveWpm blends book pace as bookActiveMs grows", () => {
  const state: PaceState = {
    ...createEmptyPaceState(),
    globalWpm: 200,
    globalActiveMs: COLD_START_MS,
    bookWpm: 100,
    bookActiveMs: BOOK_BLEND_MS
  };
  assert.ok(Math.abs(effectiveWpm(state) - 100) < 1);
});

test("remaining words and estimates", () => {
  const chapters: ChapterWordInfo[] = [
    { wordCount: 1000 },
    { wordCount: 2000 },
    { wordCount: 500 }
  ];
  assert.equal(remainingWordsInChapter(chapters, 0, 0.25), 750);
  assert.equal(remainingWordsInBook(chapters, 0, 0.25), 750 + 2000 + 500);
  assert.equal(estimateMinutes(750, 250), 3);
});

test("absoluteWordCursor accumulates prior chapters", () => {
  const chapters: ChapterWordInfo[] = [
    { wordCount: 1000 },
    { wordCount: 2000 }
  ];
  assert.equal(absoluteWordCursor(chapters, 1, 0.5), 1000 + 1000);
});

test("formatTimeLeft returns em dash when words unavailable", () => {
  assert.equal(formatTimeLeft(0, 200, "chapter"), "—");
  assert.equal(formatTimeLeft(500, 0, "chapter"), "—");
  assert.match(formatTimeLeft(500, 250, "chapter"), /left in chapter/);
  assert.match(formatTimeLeft(500, 250, "book"), /left in book/);
});
