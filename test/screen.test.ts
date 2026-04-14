import test from "node:test";
import assert from "node:assert/strict";
import { fg } from "../src/color.js";
import { truncate } from "../src/screen.js";

test("truncate preserves visible colored text instead of cutting it at ansi boundaries", () => {
  const colored = `${fg("#88ccff", "›")} ${fg("#8b949e", "[ ]")} ${fg("#88ccff", "alpha.epub")}`;
  const truncated = truncate(colored, 18);
  assert.match(truncated, /alpha/);
});
