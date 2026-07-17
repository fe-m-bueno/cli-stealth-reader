import test from "node:test";
import assert from "node:assert/strict";
import { APP_LOCALE, RELATIVE_TIME_LOCALE, compareText, formatRelativeTime } from "../src/locale.js";

test("locale policy keeps app text English and relative time Portuguese", () => {
  assert.equal(APP_LOCALE, "en");
  assert.equal(RELATIVE_TIME_LOCALE, "pt-BR");
  assert.equal(formatRelativeTime(1_000_000, 1_000_000), "agora");
  assert.equal(formatRelativeTime(1_000_000 - 2 * 60_000, 1_000_000), "há 2 minutos");
  assert.equal(formatRelativeTime(1_000_000 - 3 * 60 * 60_000, 1_000_000), "há 3 horas");
  assert.equal(formatRelativeTime(1_000_000 - 2 * 24 * 60 * 60_000, 1_000_000), "há 2 dias");
});

test("English app collation is stable and numeric-aware", () => {
  assert.deepEqual(["Book 10", "Book 2", "apple"].sort(compareText), ["apple", "Book 2", "Book 10"]);
});
