# cli-stealth-reader

A full-screen terminal EPUB reader with a stealth-oriented shell UI, strict import pipeline, persistent resume state, and slash commands.

## Run

```bash
npm install
npm run dev
```

Build the CLI:

```bash
npm run build
node dist/index.js
```

## Commands

- `/prev [count]`
- `/next [count]`
- `/chapters [query] [--current] [--flat]`
- `/changebook [query] [--recent] [--cwd]`
- `/colorscheme [theme] [--preview] [--list]`
- `/resume [book-query] [--latest]`
- `/add [path] [--cwd] [--force]`
- `/remove [book-query] [--current]`
- `/removecurrent [--confirm]`
- `/toggleprogress [book|both|chapter|hidden]`
- `/mode [code|plain]`
- `/help [command] [--all]`
- `/keyboardshortcuts [--category navigation|commands|view]`

## Notes

- Library state is stored globally in XDG-style app directories.
- EPUBs found in the current working directory are surfaced in the startup screen and `/add`.
- Removing a book only removes it from the library; it does not delete the source `.epub` file.
