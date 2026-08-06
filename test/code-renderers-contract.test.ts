import test from "node:test";
import assert from "node:assert/strict";
import { renderBlocks } from "../src/renderers.js";
import { stripAnsi } from "../src/screen.js";
import { DEFAULT_THEME } from "../src/themes.js";
import type { CanonicalBlock, CodeDensity, CodeLanguage } from "../src/types.js";

const prose: CanonicalBlock = {
  id: "contract-paragraph",
  type: "paragraph",
  text: 'She said "hello" before crossing the narrow bridge under C:\\moonlight'
};

function renderAt(language: CodeLanguage, blockIndex: number, density: CodeDensity = 5): string[] {
  return renderBlocks(
    [prose],
    "code",
    80,
    DEFAULT_THEME,
    language,
    density,
    undefined,
    true,
    blockIndex,
    false
  ).map(stripAnsi);
}

test("code rendering is deterministic, width-bounded, and exercises each language's public syntax contract", () => {
  const expectedSyntax: Record<CodeLanguage, string[]> = {
    typescript: [
      "if (", "} else {", "for (const item of", "try {", "catch (", "import {", "enum ",
      "interface ", "function ", "async function ", "@", "class ", "extends ", "console.log(",
      "throw new Error(", "await ", "?.text ?? ", " as ", "...state", " ? "
    ],
    python: [
      "if ", "else:", "try:", "except Exception as e:", "def ", "class ", "with ",
      "print(", "raise ValueError(", "logging.", "assert result, "
    ],
    rust: [
      "if ", "} else {", "#[derive(Debug, Clone)]", "struct ", "fn ", "pub fn ",
      "impl ", "match ", "println!(", "eprintln!(", "assert_eq!(", "format!(", ".expect("
    ]
  };

  for (const language of ["typescript", "python", "rust"] as const) {
    const rendered = Array.from({ length: 600 }, (_, offset) => renderAt(language, offset + 1)).flat();
    const output = rendered.join("\n");

    assert.deepEqual(renderAt(language, 137), renderAt(language, 137));
    assert.ok(rendered.every((line) => line.length <= 80), `${language} emitted a line wider than 80 columns`);
    for (const syntax of expectedSyntax[language]) {
      assert.ok(output.includes(syntax), `${language} never emitted ${JSON.stringify(syntax)}`);
    }
  }
});

test("code languages preserve the canonical heading, scene-break, and image meanings", () => {
  const blocks: CanonicalBlock[] = [
    { id: "heading", type: "heading", text: "A quiet chapter" },
    { id: "break", type: "scene-break", text: "" },
    { id: "image", type: "image", text: "Map of Arrakis" },
    { id: "empty-image", type: "image", text: "" }
  ];

  const render = (language: CodeLanguage) => renderBlocks(
    blocks,
    "code",
    80,
    DEFAULT_THEME,
    language,
    3,
    undefined,
    true,
    0,
    false,
    "compact"
  ).map(stripAnsi);

  assert.deepEqual(render("typescript"), [
    "// A QUIET CHAPTER",
    "/* · · · · · */",
    "// [image: Map of Arrakis]",
    "// [image]"
  ]);
  assert.deepEqual(render("python"), [
    "# A QUIET CHAPTER",
    "# · · · · ·",
    "# [image: Map of Arrakis]",
    "# [image]"
  ]);
  assert.deepEqual(render("rust"), [
    "// A QUIET CHAPTER",
    "/* · · · · · */",
    "// [image: Map of Arrakis]",
    "// [image]"
  ]);
});

test("code rendering escapes quotes and backslashes without losing readable text", () => {
  for (const language of ["typescript", "python", "rust"] as const) {
    const dense = renderAt(language, 11, 5).join("\n");
    assert.ok(dense.includes("\\\"hello\\\""), `${language} did not escape embedded quotes`);
    assert.ok(dense.includes("C:\\\\moonlight"), `${language} did not escape a backslash`);
    assert.ok(dense.includes("narrow") && dense.includes("bridge"), `${language} lost prose while disguising it`);
  }

  const readableTypescript = renderAt("typescript", 11, 1).join("\n");
  assert.match(readableTypescript, /\/\/ |return `/);
});
