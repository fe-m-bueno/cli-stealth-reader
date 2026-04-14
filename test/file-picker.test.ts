import test from "node:test";
import assert from "node:assert/strict";
import { executeCommand } from "../src/executor.js";
import { handleInput } from "../src/input.js";
import type { AppState, FolderDiscovery, ThemePreset } from "../src/types.js";

const theme: ThemePreset = {
  id: "codex",
  label: "Codex",
  accent: "#88ccff",
  accentMuted: "#6699cc",
  foreground: "#d0d7de",
  dim: "#8b949e",
  background: "#0d1117",
  border: "#30363d",
  warning: "#d29922",
  keyword: "#ff7b72",
  codeString: "#a5d6ff",
  subtle: "#6e7681"
};

const discoveries: FolderDiscovery[] = [
  { path: "/tmp/alpha.epub", fileName: "alpha.epub" },
  { path: "/tmp/beta.epub", fileName: "beta.epub" },
  { path: "/tmp/gamma.epub", fileName: "gamma.epub" }
];

function makeStorage() {
  return {
    getPosition: () => null,
    saveBook: () => {},
    listBooks: () => [],
    getBook: () => null,
    removeBook: () => {},
    getLatestBookId: () => null,
    setSetting: () => {},
    saveCommandHistory: () => {},
    savePosition: () => {},
    getSettings: () => ({
      themeId: "codex",
      progressVisibility: "book",
      renderMode: "plain"
    })
  } as AppState["storage"];
}

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    storage: makeStorage(),
    cwd: "/tmp",
    theme,
    renderMode: "plain",
    progressVisibility: "book",
    currentBook: null,
    chapterIndex: 0,
    blockOffset: 0,
    commandBuffer: "",
    commandMode: false,
    status: "",
    overlay: "file-picker",
    discoveries,
    shouldQuit: false,
    filePickerCursor: 0,
    filePickerItems: discoveries,
    filePickerSelected: new Set(),
    filePickerForce: false,
    ...overrides
  };
}

const redraw = () => {};
const noop = async () => {};

test("arrow down moves cursor", async () => {
  const state = makeState();
  await handleInput("\u001b[B", state, redraw, noop, () => {}, noop);
  assert.equal(state.filePickerCursor, 1);
});

test("arrow up does not go below 0", async () => {
  const state = makeState();
  await handleInput("\u001b[A", state, redraw, noop, () => {}, noop);
  assert.equal(state.filePickerCursor, 0);
});

test("j moves cursor down and k moves it up", async () => {
  const state = makeState();
  await handleInput("j", state, redraw, noop, () => {}, noop);
  assert.equal(state.filePickerCursor, 1);
  await handleInput("k", state, redraw, noop, () => {}, noop);
  assert.equal(state.filePickerCursor, 0);
});

test("space toggles the current selection", async () => {
  const state = makeState();
  await handleInput(" ", state, redraw, noop, () => {}, noop);
  assert.ok(state.filePickerSelected.has(0));
  await handleInput(" ", state, redraw, noop, () => {}, noop);
  assert.ok(!state.filePickerSelected.has(0));
});

test("cursor does not move past the last item", async () => {
  const state = makeState({ filePickerCursor: 2 });
  await handleInput("\u001b[B", state, redraw, noop, () => {}, noop);
  assert.equal(state.filePickerCursor, 2);
});

test("escape closes the picker", async () => {
  const state = makeState();
  await handleInput("\u001b", state, redraw, noop, () => {}, noop);
  assert.equal(state.overlay, "none");
});

test("enter with no selection confirms the cursor item", async () => {
  const confirmed: Array<{ paths: string[]; force: boolean }> = [];
  const state = makeState({ filePickerCursor: 1, filePickerForce: true });
  await handleInput("\r", state, redraw, noop, () => {}, async (paths, force) => {
    confirmed.push({ paths, force });
  });
  assert.deepEqual(confirmed, [{ paths: ["/tmp/beta.epub"], force: true }]);
  assert.equal(state.overlay, "none");
});

test("enter with selected items confirms all selections in order", async () => {
  const confirmed: Array<{ paths: string[]; force: boolean }> = [];
  const state = makeState({ filePickerSelected: new Set([2, 0]) });
  await handleInput("\r", state, redraw, noop, () => {}, async (paths, force) => {
    confirmed.push({ paths, force });
  });
  assert.deepEqual(confirmed, [{ paths: ["/tmp/alpha.epub", "/tmp/gamma.epub"], force: false }]);
  assert.equal(state.overlay, "none");
});

test("enter on the empty startup screen opens add flow when discoveries exist", async () => {
  const state = makeState({ overlay: "none" });
  const commands: string[] = [];
  await handleInput("\r", state, redraw, async (cmd) => {
    commands.push(cmd);
  }, () => {}, noop);
  assert.deepEqual(commands, ["/add"]);
});

test("add with no args opens the file picker instead of importing the first item", async () => {
  const state = makeState({ overlay: "none", status: "Ready" });
  await executeCommand(state, "/add");
  assert.equal(state.overlay, "file-picker");
  assert.deepEqual(state.filePickerItems, discoveries);
  assert.equal(state.filePickerCursor, 0);
  assert.equal(state.filePickerSelected.size, 0);
});

test("add query with multiple matches opens a filtered picker", async () => {
  const state = makeState({
    overlay: "none",
    discoveries: [
      { path: "/tmp/alpine.epub", fileName: "alpine.epub" },
      { path: "/tmp/alpha.epub", fileName: "alpha.epub" },
      { path: "/tmp/beta.epub", fileName: "beta.epub" }
    ]
  });
  await executeCommand(state, "/add alp");
  assert.equal(state.overlay, "file-picker");
  assert.deepEqual(state.filePickerItems.map((item) => item.fileName), ["alpine.epub", "alpha.epub"]);
});

test("add query with no matches opens an empty picker state", async () => {
  const state = makeState({ overlay: "none" });
  await executeCommand(state, "/add zeta");
  assert.equal(state.overlay, "file-picker");
  assert.deepEqual(state.filePickerItems, []);
  assert.match(state.status, /No EPUBs matched "zeta"\./);
});
