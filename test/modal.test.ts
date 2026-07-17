import test from "node:test";
import assert from "node:assert/strict";
import { composeModal, modalGeometry, modalHitTest, padAnsi, renderModalFrame } from "../src/modal.js";
import { DEFAULT_THEME } from "../src/themes.js";
import { stripAnsi } from "../src/screen.js";

const theme = DEFAULT_THEME;

function frame(rowCount: number, cursor = 0, search: { buffer: string; active: boolean } | null = { buffer: "", active: false }) {
  return renderModalFrame({
    theme,
    title: "Library",
    search: search ? { ...search, placeholder: "/ to search" } : null,
    rowCount,
    cursor,
    renderRow: (index, contentWidth) => `row ${index}`.padEnd(contentWidth).slice(0, contentWidth),
    footerHints: [
      { key: "Enter", label: "open" },
      { key: "Esc", label: "close" }
    ]
  }, 100, 30);
}

test("renderModalFrame draws a bordered modal with title, search, rows, and footer", () => {
  const geometry = modalGeometry(100, 30);
  const lines = frame(3).map(stripAnsi);
  const top = lines[geometry.y]!;
  assert.match(top, /╭─ Library .*\[×\]─╮/);
  assert.match(lines[geometry.y + 1]!, /\/ to search/);
  assert.match(lines[geometry.entriesY]!, /row 0/);
  const footer = lines[geometry.y + geometry.height - 2]!;
  assert.match(footer, /Enter:open/);
  assert.match(footer, /Esc:close/);
  assert.match(lines[geometry.y + geometry.height - 1]!, /╰─+╯/);
});

test("renderModalFrame windows rows around the cursor and shows a scrollbar", () => {
  const geometry = modalGeometry(100, 30);
  const lines = frame(200, 199).map(stripAnsi);
  const lastRow = lines[geometry.entriesY + geometry.visibleRows - 1]!;
  assert.match(lastRow, /row 199/);
  const body = lines.slice(geometry.entriesY, geometry.entriesY + geometry.visibleRows).join("\n");
  assert.match(body, /█/);
});

test("renderModalFrame shows the search buffer with a cursor glyph while searching", () => {
  const geometry = modalGeometry(100, 30);
  const lines = frame(3, 0, { buffer: "dune", active: true }).map(stripAnsi);
  assert.match(lines[geometry.y + 1]!, /dune▏/);
});

test("modalHitTest maps close button, search row, and visible rows", () => {
  const geometry = modalGeometry(100, 30);
  assert.deepEqual(modalHitTest(100, 30, 5, 0, geometry.x + geometry.width - 3, geometry.y), { kind: "close" });
  assert.deepEqual(modalHitTest(100, 30, 5, 0, geometry.x + 4, geometry.y + 1), { kind: "search" });
  assert.deepEqual(modalHitTest(100, 30, 5, 0, geometry.x + 4, geometry.entriesY + 2), { kind: "row", index: 2 });
  assert.equal(modalHitTest(100, 30, 1, 0, geometry.x + 4, geometry.entriesY + 2), null);
  assert.equal(modalHitTest(100, 30, 5, 0, geometry.x - 1, geometry.entriesY), null);
});

test("composeModal dims the background and splices the modal in", () => {
  const geometry = modalGeometry(100, 30);
  const background = Array.from({ length: 30 }, (_, i) => `background line ${i}`);
  const composed = composeModal(theme, frame(2), background, 100, 30);
  assert.equal(composed.length, 30);
  assert.match(stripAnsi(composed[geometry.y]!), /╭─ Library /);
  assert.match(stripAnsi(composed[0]!), /background line 0/);
});

test("padAnsi pads to visible width ignoring ANSI escapes", () => {
  assert.equal(stripAnsi(padAnsi("[31mab[0m", 5)).length, 5);
});
