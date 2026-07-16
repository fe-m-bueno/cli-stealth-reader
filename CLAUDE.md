# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Run with tsx (no build needed)
npm run build        # Compile TypeScript → dist/
npm start            # Run compiled dist/index.js
npm test             # Run all tests (Node native test runner via tsx)
```

To run a single test file:
```bash
node --import tsx --test test/epub.test.ts
node --import tsx --test test/commands.test.ts
```

## Architecture

A full-screen terminal EPUB reader in TypeScript. Two rendering modes: `plain` (clean text) and `code` (disguises book text as JavaScript code — the "stealth" feature).

### Module Map

| File | Role |
|------|------|
| `src/index.ts` | CLI entry point (shebang binary) |
| `src/tui.ts` | Main TUI event loop, all app state, screen rendering |
| `src/types.ts` | All shared types for the app |
| `src/commands.ts` | Slash-command definitions + tokenizer/parser |
| `src/storage.ts` | SQLite abstraction (WAL, all queries) |
| `src/paths.ts` | XDG directory path resolution |
| `src/discovery.ts` | EPUB file discovery in CWD |
| `src/renderers.ts` | Block rendering for plain vs code modes |
| `src/themes.ts` | Built-in color schemes and appearance themes |
| `src/help.ts` | Keyboard shortcut definitions |
| `src/color.ts` | ANSI color formatting utilities |
| `src/reading-pace.ts` | Learned reading pace, remaining-word estimates, and duration formatting |
| `src/settings-panel.ts` | Tabbed reader settings, draft lifecycle, live preview, and setting definitions |
| `src/parser/epub.ts` | EPUB import pipeline (JSZip → canonical blocks) |
| `src/parser/html.ts` | HTML → canonical block extraction (uses parse5) |
| `src/parser/xml.ts` | XML parsing utilities |

### Data Flow

```
EPUB file → epub.ts (JSZip + XML/HTML parsing) → CanonicalBook (chapters → blocks)
                                                        ↓
                                               storage.ts (SQLite)
                                                        ↓
                  tui.ts (AppState) ←→ commands.ts (slash command parser)
                        ↓
                 renderers.ts → ANSI output
```

### Core Data Model (`types.ts`)

- **`CanonicalBlock`** — unit of content: `heading | paragraph | blockquote | list-item | scene-break | image | anchor`
- **`CanonicalChapter`** — array of blocks + metadata (title, href, word count)
- **`CanonicalBook`** — array of chapters + book metadata + import diagnostics
- **`AppState`** (in `tui.ts`) — runtime state: current book/chapter/block offset, render mode, color scheme, appearance theme, command buffer, overlay state

### Storage (`storage.ts`)

SQLite database in `$XDG_DATA_HOME/cli-stealth-reader/` (WAL mode). Tables: `books`, `chapters` (blocks as JSON), `positions`, `diagnostics`, `settings`, `command_history`, `reading_pace`. Book JSON cache lives in `$XDG_CACHE_HOME/cli-stealth-reader/`.

### EPUB Import Pipeline (`parser/epub.ts`)

1. Validate mimetype + `META-INF/container.xml`
2. Parse OPF manifest/spine
3. Extract TOC: EPUB3 `nav.xhtml` → NCX fallback → spine fallback
4. For each TOC item: parse HTML via parse5, extract blocks, support anchor fragments
5. Normalize to canonical format, calculate word counts, collect diagnostics

### Command System (`commands.ts`)

15 slash commands (e.g. `/next`, `/chapters`, `/mode`, `/colorscheme`, `/theme`). The tokenizer supports quoted arguments and flag variants (`--flag`, `--flag=value`).

### Rendering (`renderers.ts`)

**Plain mode**: headings uppercased in accent color, blockquotes with `> ` prefix, list items with `• `, scene breaks as `· · ·`.

**Code mode**: cycles through 4 JavaScript-like patterns per block:
```js
const fragment0 = "text";
// text
function stage2() { return "text"; }
timeline.push("text");
```

Both modes word-wrap to terminal width and respect the active theme.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues for `fe-m-bueno/cli-stealth-reader`; external PRs are not treated as a triage request surface by default. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default mattpocock/skills label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo: read root `CONTEXT.md` when present and root `docs/adr/` for architectural decisions. See `docs/agents/domain.md`.
