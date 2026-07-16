import { bold, fg } from "./color.js";
import { getTogglCache } from "./toggl.js";
import type { Storage } from "./storage.js";
import type { CommandDefinition, CommandSuggestion, ParsedCommandResult, ThemePreset } from "./types.js";

export const COMMANDS: CommandDefinition[] = [
  {
    name: "prev",
    description: "Go to previous chapter.",
    args: [{ name: "count" }],
    usage: "/prev [count]",
    details: ["Moves backward by one chapter, or by count chapters when count is provided."],
    examples: ["/prev", "/prev 3"]
  },
  {
    name: "next",
    description: "Go to next chapter.",
    args: [{ name: "count" }],
    usage: "/next [count]",
    details: ["Moves forward by one chapter, or by count chapters when count is provided."],
    examples: ["/next", "/next 2"]
  },
  {
    name: "chapters",
    description: "Open the table of contents.",
    args: [{ name: "query" }],
    flags: [{ name: "current" }, { name: "flat" }],
    usage: "/chapters [query] [--current] [--flat]",
    details: [
      "Opens the chapter picker. With a query, the list is filtered to matching chapter titles.",
      "--current starts the picker at the current chapter. --flat shows a flattened table of contents."
    ],
    examples: ["/chapters", "/chapters introduction", "/chapters --current", "/chapters appendix --flat"]
  },
  {
    name: "changebook",
    aliases: ["book"],
    description: "Switch books from the library or current folder.",
    args: [{ name: "query" }],
    flags: [{ name: "recent" }, { name: "cwd" }, { name: "sort", takesValue: true }],
    usage: "/changebook [query] [--recent] [--cwd] [--sort lastOpened|title|author|progress]",
    details: [
      "Opens the book library and optionally filters it by title, author, or file name.",
      "--recent prioritizes recently opened books. --cwd shows books discovered in the current folder.",
      "--sort changes the library sort key for this picker."
    ],
    examples: ["/changebook", "/book dune", "/changebook --recent", "/changebook --sort progress"]
  },
  {
    name: "colorscheme",
    description: "Change the active color scheme.",
    args: [{ name: "scheme" }],
    flags: [{ name: "preview" }, { name: "list" }],
    usage: "/colorscheme [scheme] [--preview] [--list]",
    details: [
      "Without a scheme, opens the colorscheme picker. With a scheme id, applies that colorscheme.",
      "Color schemes control the accent hue family and remain separate from light/dark theming.",
      "--preview is accepted for compatibility. --list opens the full colorscheme list."
    ],
    examples: ["/colorscheme", "/colorscheme amber", "/colorscheme forest --preview", "/colorscheme --list"]
  },
  {
    name: "theme",
    description: "Change the active appearance theme.",
    args: [{ name: "theme" }],
    flags: [{ name: "list" }],
    usage: "/theme [theme] [--list]",
    details: [
      "Without a theme, opens the appearance theme picker. With a theme id, applies that appearance.",
      "Themes control dark/light, colorblind-friendly, and ANSI-only rendering without changing the active colorscheme."
    ],
    examples: ["/theme", "/theme light", "/theme dark-colorblind", "/theme light-ansi", "/theme --list"]
  },
  {
    name: "resume",
    description: "Resume the latest or a specific book.",
    args: [{ name: "book-query" }],
    flags: [{ name: "latest" }],
    usage: "/resume [book-query] [--latest]",
    details: ["Reopens a book from the library at its saved reading position."],
    examples: ["/resume", "/resume --latest", "/resume hobbit"]
  },
  {
    name: "add",
    description: "Import an EPUB, CBZ, or PDF from cwd or an explicit path.",
    args: [{ name: "path" }],
    flags: [{ name: "cwd" }, { name: "force" }],
    usage: "/add [path] [--cwd] [--force]",
    details: [
      "Imports a supported book file into the local library and opens it.",
      "Without a path, opens a file picker for supported files in the current folder.",
      "--force reimports even when the file hash already exists in the library."
    ],
    examples: ["/add", "/add ./books/example.epub", "/add --cwd", "/add ./comic.cbz --force"]
  },
  {
    name: "remove",
    description: "Remove a book from the library.",
    args: [{ name: "book-query" }],
    flags: [{ name: "current" }],
    usage: "/remove [book-query] [--current]",
    details: [
      "Removes a matching book from the library database.",
      "--current removes the book currently open in the reader."
    ],
    examples: ["/remove dune", "/remove --current"]
  },
  {
    name: "removecurrent",
    description: "Remove the current book from the library.",
    flags: [{ name: "confirm" }],
    usage: "/removecurrent [--confirm]",
    details: ["Removes the active book. The command requires --confirm to avoid accidental deletion."],
    examples: ["/removecurrent --confirm"]
  },
  {
    name: "toggleprogress",
    description: "Set progress display mode.",
    args: [{ name: "mode" }],
    usage: "/toggleprogress [time-chapter|time-book|book|both|chapter|hidden]",
    details: [
      "With no argument, cycles through progress display modes.",
      "time-chapter and time-book show estimated remaining reading time from learned pace.",
      "book/chapter/both show percentage bars; hidden disables the footer progress line."
    ],
    examples: ["/toggleprogress", "/toggleprogress time-chapter", "/toggleprogress both", "/toggleprogress hidden"]
  },
  {
    name: "mode",
    description: "Switch rendering mode or code language.",
    args: [{ name: "mode", required: true }],
    usage: "/mode [plain|typescript|python|rust]",
    details: [
      "plain renders the book as prose. typescript, python, and rust render the text through the selected code-like stealth style.",
      "The selected mode is saved and reused the next time the app starts."
    ],
    examples: ["/mode plain", "/mode typescript", "/mode python", "/mode rust"]
  },
  {
    name: "highlight",
    description: "Toggle plain-mode dialogue highlight.",
    args: [{ name: "state", required: true }],
    usage: "/highlight <on|off>",
    details: ["Enables or disables dialogue highlighting while using plain render mode."],
    examples: ["/highlight on", "/highlight off"]
  },
  {
    name: "mouse",
    description: "Toggle mouse capture for the draggable scrollbar.",
    args: [{ name: "state" }],
    usage: "/mouse [on|off]",
    details: [
      "off keeps native terminal text selection and wheel scrolling. on enables app mouse capture so the in-app scrollbar can be clicked and dragged.",
      "Terminal protocols cannot provide native drag selection and app scrollbar dragging from the same unmodified mouse gesture."
    ],
    examples: ["/mouse on", "/mouse off"],
    notes: ["When mouse capture is on, most terminals still allow text selection with Shift-drag."]
  },
  {
    name: "settings",
    aliases: ["config"],
    description: "Open the reader settings panel.",
    usage: "/settings",
    details: [
      "Opens a searchable settings panel for reader-specific options.",
      "Inside the panel, Space changes the selected setting, Enter saves, / searches, and Esc cancels."
    ],
    examples: ["/settings", "/config"],
    notes: ["Shortcut: press S from the reader to open settings."]
  },
  {
    name: "toggl",
    description: "Log reading time directly to Toggl Track.",
    args: [{ name: "action" }, { name: "description" }],
    flags: [{ name: "project", takesValue: true }, { name: "duration", takesValue: true }, { name: "open" }, { name: "disconnect" }],
    usage: "/toggl auth|sync|recent|start|stop|log [description] [--project name] [--duration 25m]",
    details: [
      "auth opens the Toggl API token page; paste the token as /toggl auth <token> to connect.",
      "sync caches recent projects and descriptions from Toggl for fuzzy project lookup.",
      "start creates a running timer, stop stops the current timer, and log creates a finished entry ending now."
    ],
    examples: [
      "/toggl auth",
      "/toggl auth <api-token>",
      "/toggl sync",
      "/toggl start \"O Nome do Vento\" --project \"Reading books\"",
      "/toggl log \"Choujin X\" --project \"Reading manga\" --duration 45m",
      "/toggl stop"
    ],
    notes: ["Uses Toggl Track API v9 with API-token basic auth. The token is stored in the local app settings database."]
  },
  {
    name: "help",
    description: "Show help for commands.",
    args: [{ name: "command" }],
    flags: [{ name: "all" }],
    usage: "/help [command] [--all]",
    details: [
      "Opens a full-page manual. With a command name or alias, opens the manual entry for that command.",
      "--all is accepted for compatibility and shows the complete command manual."
    ],
    examples: ["/help", "/help mode", "/help theme", "/help --all"],
    notes: ["Use ? or /keyboardshortcuts for keyboard shortcut help."]
  },
  {
    name: "keyboardshortcuts",
    aliases: ["keys"],
    description: "Show keyboard shortcuts.",
    flags: [{ name: "category", takesValue: true }],
    usage: "/keyboardshortcuts [--category navigation|commands|view]",
    details: [
      "Shows keyboard shortcuts. Use --category to focus navigation, command, or view shortcuts."
    ],
    examples: ["/keyboardshortcuts", "/keys", "/keys --category navigation", "/keyboardshortcuts --category commands"]
  },
  {
    name: "density",
    description: "Set code density (1=max comments, 5=max code). Tecla d cicla entre 1→3→5.",
    args: [{ name: "level" }],
    usage: "/density [1-5]",
    details: [
      "Controls how dense the code-style renderers are. Lower values favor explanatory comment-like text; higher values favor compact code-like output."
    ],
    examples: ["/density 1", "/density 3", "/density 5"],
    notes: ["In code mode, the d key cycles through 1, 3, and 5."]
  },
  {
    name: "goto",
    description: "Jump by book %, chapter %, or chapter number.",
    args: [{ name: "position", required: true }],
    flags: [{ name: "chapter" }],
    usage: "/goto <n|%> [--chapter]",
    details: [
      "Jumps to a chapter number or a percentage position.",
      "A bare number is treated as a chapter number. A value ending in % is treated as whole-book progress.",
      "Use --chapter, or the shorthand %c form, to treat a percentage as progress within the current chapter."
    ],
    examples: ["/goto 5", "/goto 42%", "/goto 30% --chapter", "/goto 30%c"]
  },
  {
    name: "search",
    description: "Search in the current chapter; use -g or --global for the whole book.",
    args: [{ name: "term" }],
    flags: [{ name: "global", alias: "g" }],
    usage: "/search [-g|--global] <term>",
    details: [
      "Searches for text and highlights matches. By default the search is limited to the current chapter.",
      "-g or --global searches the entire book."
    ],
    examples: ["/search ring", "/search \"chapter one\"", "/search -g mordor", "/search --global \"needle in a haystack\""],
    notes: ["After a search, use n and N to move between matches."]
  },
  {
    name: "mark",
    description: "Save a bookmark at the current reading position.",
    args: [{ name: "label" }],
    usage: "/mark [label]",
    details: ["Creates a bookmark at the current chapter and block offset. The optional label makes it easier to find later."],
    examples: ["/mark", "/mark important reveal", "/mark \"return here\""]
  },
  {
    name: "marks",
    description: "Open bookmarks for the current book.",
    usage: "/marks",
    details: ["Opens the bookmark picker for the current book."],
    examples: ["/marks"],
    notes: ["Inside the bookmark picker, press Enter to jump to a bookmark or d to delete the selected bookmark."]
  },
  {
    name: "delmark",
    description: "Delete a bookmark by id or label.",
    args: [{ name: "id-or-label", required: true }],
    usage: "/delmark <id|label>",
    details: ["Deletes the bookmark whose id or label matches the argument."],
    examples: ["/delmark 01HR...", "/delmark \"return here\""]
  },
  {
    name: "export",
    description: "Export reading state (positions, bookmarks, notes, tags) to JSON.",
    args: [{ name: "path" }],
    usage: "/export [path]",
    details: [
      "Writes reading positions, bookmarks, notes, and tags to a JSON file.",
      "When no path is supplied, the app chooses a default export path."
    ],
    examples: ["/export", "/export ./reader-backup.json"]
  },
  {
    name: "import",
    description: "Import and merge reading state from a JSON export file.",
    args: [{ name: "path" }],
    usage: "/import [path]",
    details: ["Reads a JSON export and merges matching positions, bookmarks, notes, and tags into the local library."],
    examples: ["/import ./reader-backup.json"]
  },
  {
    name: "tag",
    description: "Add, remove, or list tags for the current book.",
    args: [{ name: "tag" }],
    flags: [{ name: "delete", alias: "d" }],
    usage: "/tag [tag] [-d <tag>]",
    details: [
      "With no argument, lists tags for the current book. With a tag argument, adds that tag.",
      "-d or --delete removes a tag from the current book."
    ],
    examples: ["/tag", "/tag favorite", "/tag sci-fi", "/tag -d favorite"]
  },
  {
    name: "tags",
    description: "List tags for the current book.",
    usage: "/tags",
    details: ["Lists all tags assigned to the current book."],
    examples: ["/tags"]
  },
  {
    name: "note",
    description: "Add a note at current position, list notes (-l), or delete a note (-d <id>).",
    args: [{ name: "text" }],
    flags: [{ name: "list", alias: "l" }, { name: "delete", alias: "d" }],
    usage: "/note [text] [-l] [-d <id>]",
    details: [
      "With text, creates a note at the current reading position.",
      "-l or --list opens the notes list. -d or --delete deletes a note by id."
    ],
    examples: ["/note remember this", "/note \"check this quote later\"", "/note -l", "/note -d 01HR..."],
    notes: ["Inside the notes list, press Enter to jump to a note or d to delete the selected note."]
  }
];

const aliasLookup = new Map<string, string>();
for (const command of COMMANDS) {
  aliasLookup.set(command.name, command.name);
  for (const alias of command.aliases ?? []) {
    aliasLookup.set(alias, command.name);
  }
}

const COMMAND_CATEGORIES: Record<string, string> = {
  prev: "Navigation",
  next: "Navigation",
  chapters: "Navigation",
  goto: "Navigation",
  search: "Navigation",
  changebook: "Library",
  resume: "Library",
  add: "Library",
  remove: "Library",
  removecurrent: "Library",
  mark: "Annotations",
  marks: "Annotations",
  delmark: "Annotations",
  note: "Annotations",
  tag: "Annotations",
  tags: "Annotations",
  export: "Data",
  import: "Data",
  colorscheme: "Appearance",
  theme: "Appearance",
  toggleprogress: "Appearance",
  mode: "Appearance",
  highlight: "Appearance",
  density: "Appearance",
  mouse: "Settings",
  settings: "Settings",
  toggl: "Integrations",
  help: "Help",
  keyboardshortcuts: "Help"
};

function commandCategory(command: CommandDefinition): string {
  return COMMAND_CATEGORIES[command.name] ?? "Other";
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

export function parseSlashCommand(input: string): ParsedCommandResult {
  const tokens = tokenize(input.trim());
  if (tokens.length === 0 || !tokens[0].startsWith("/")) {
    throw new Error("Command must start with /");
  }
  const commandName = tokens[0].slice(1);
  const normalized = aliasLookup.get(commandName);
  if (!normalized) {
    throw new Error(`Unknown command: ${commandName}`);
  }
  const definition = COMMANDS.find((command) => command.name === normalized)!;
  const args: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.startsWith("--")) {
      const rawFlag = token.slice(2);
      const [flagName, inlineValue] = rawFlag.split("=", 2);
      const flagSpec = definition.flags?.find((flag) => flag.name === flagName);
      if (!flagSpec) {
        throw new Error(`Unknown flag --${flagName} for /${normalized}`);
      }
      if (flagSpec.takesValue) {
        const nextToken = inlineValue ?? tokens[index + 1];
        if (!nextToken || nextToken.startsWith("--")) {
          throw new Error(`Flag --${flagName} expects a value`);
        }
        flags[flagName] = nextToken;
        if (inlineValue == null) {
          index += 1;
        }
      } else {
        flags[flagName] = true;
      }
    } else if (token.startsWith("-") && token.length > 1) {
      for (let flagIndex = 1; flagIndex < token.length; flagIndex += 1) {
        const ch = token[flagIndex]!;
        const flagSpec = definition.flags?.find((flag) => flag.alias === ch);
        if (!flagSpec) {
          throw new Error(`Unknown flag -${ch} for /${normalized}`);
        }
        if (flagSpec.takesValue) {
          throw new Error(`Flag -${ch} must be written as --${flagSpec.name}=...`);
        }
        flags[flagSpec.name] = true;
      }
    } else {
      args.push(token);
    }
  }

  return { name: normalized, args, flags };
}

function findCommand(commandName: string): CommandDefinition | undefined {
  return COMMANDS.find((item) => item.name === commandName || item.aliases?.includes(commandName));
}

function formatArgument(arg: NonNullable<CommandDefinition["args"]>[number]): string {
  return `${arg.required ? "<" : "["}${arg.name}${arg.required ? ">" : "]"}`;
}

function formatFlag(flag: NonNullable<CommandDefinition["flags"]>[number]): string {
  const names = [flag.alias ? `-${flag.alias}` : null, `--${flag.name}`].filter(Boolean).join(", ");
  return flag.takesValue ? `${names} <value>` : names;
}

function commandSuggestionDetail(command: CommandDefinition, matchedAlias?: string): string {
  const parts: string[] = [];
  if (matchedAlias && matchedAlias !== command.name) {
    parts.push(`alias /${matchedAlias}`);
  } else if (command.aliases?.length) {
    parts.push(`alias ${command.aliases.map((alias) => `/${alias}`).join(", ")}`);
  }
  if (command.flags?.length) {
    parts.push(`flags ${command.flags.map(formatFlag).join(", ")}`);
  }
  if (command.examples?.[0]) {
    parts.push(`try ${command.examples[0]}`);
  }
  return parts.join(" · ");
}

function commandManual(command: CommandDefinition): string[] {
  const lines = [
    `/${command.name.toUpperCase()}(1)`,
    "",
    "NAME",
    `  /${command.name} - ${command.description}`,
    "",
    "SYNOPSIS",
    `  ${command.usage}`,
    ""
  ];

  if (command.aliases?.length) {
    lines.push("ALIASES", `  ${command.aliases.map((alias) => `/${alias}`).join(", ")}`, "");
  }

  if (command.args?.length) {
    lines.push("ARGUMENTS");
    for (const arg of command.args) {
      lines.push(`  ${formatArgument(arg)}`);
    }
    lines.push("");
  }

  if (command.flags?.length) {
    lines.push("FLAGS");
    for (const flag of command.flags) {
      lines.push(`  ${formatFlag(flag)}`);
    }
    lines.push("");
  }

  if (command.details?.length) {
    lines.push("DESCRIPTION");
    for (const detail of command.details) {
      lines.push(`  ${detail}`);
    }
    lines.push("");
  }

  if (command.examples?.length) {
    lines.push("EXAMPLES");
    for (const example of command.examples) {
      lines.push(`  ${example}`);
    }
    lines.push("");
  }

  if (command.notes?.length) {
    lines.push("NOTES");
    for (const note of command.notes) {
      lines.push(`  ${note}`);
    }
    lines.push("");
  }

  return lines;
}

function wrapManualLine(line: string, width: number): string[] {
  if (width <= 0 || line.length <= width) {
    return [line];
  }
  if (!line.trim()) {
    return [""];
  }

  const indent = line.match(/^\s*/)?.[0] ?? "";
  const continuationIndent = indent || "  ";
  const words = line.trim().split(/\s+/);
  const lines: string[] = [];
  let current = indent;
  let currentHasText = false;

  for (const word of words) {
    const separator = currentHasText ? " " : "";
    if (current.length + separator.length + word.length <= width) {
      current += `${separator}${word}`;
      currentHasText = true;
      continue;
    }

    if (currentHasText) {
      lines.push(current);
      current = continuationIndent;
      currentHasText = false;
    }

    if (continuationIndent.length + word.length <= width) {
      current = `${continuationIndent}${word}`;
      currentHasText = true;
      continue;
    }

    const chunkWidth = Math.max(1, width - continuationIndent.length);
    for (let index = 0; index < word.length; index += chunkWidth) {
      const chunk = word.slice(index, index + chunkWidth);
      if (index + chunkWidth >= word.length) {
        current = `${continuationIndent}${chunk}`;
        currentHasText = true;
      } else {
        lines.push(`${continuationIndent}${chunk}`);
      }
    }
  }

  if (currentHasText) {
    lines.push(current);
  }
  return lines.length > 0 ? lines : [line.slice(0, width)];
}

function wrapManual(lines: string[], width?: number): string[] {
  if (!width || width <= 0) {
    return lines;
  }
  return lines.flatMap((line) => wrapManualLine(line, width));
}

function styleManualLine(line: string, theme?: ThemePreset): string {
  if (!theme || !line) {
    return line;
  }

  if (/^(\/[A-Z][A-Z0-9-]*\(1\)|[A-Z][A-Z ]+)$/.test(line)) {
    return bold(line);
  }

  return line
    .replace(/(^|[\s[(|,])(--[a-z][a-z0-9-]*|-[a-z])(?=$|[\s,\]|)])/g, (_match, lead: string, flag: string) => (
      `${lead}${fg(theme.warning, flag)}`
    ))
    .replace(/(^|\s)(\/[a-z][a-z0-9]*)(?=$|[\s,)])/g, (_match, lead: string, command: string) => (
      `${lead}${bold(fg(theme.accent, command))}`
    ));
}

function styleManual(lines: string[], theme?: ThemePreset): string[] {
  return theme ? lines.map((line) => styleManualLine(line, theme)) : lines;
}

export function commandHelp(commandName?: string, width?: number, theme?: ThemePreset): string[] {
  if (commandName) {
    const command = findCommand(commandName);
    if (!command) {
      return styleManual(wrapManual([
        "HELP(1)",
        "",
        "No manual entry",
        `  No help available for /${commandName}.`,
        "",
        "Try",
        "  /help",
        "  /help --all"
      ], width), theme);
    }
    return styleManual(wrapManual(commandManual(command), width), theme);
  }

  const lines = [
    "CLI-STEALTH-READER(1)",
    "",
    "NAME",
    "  /help - full command manual",
    "",
    "SYNOPSIS",
    "  /help",
    "  /help <command>",
    "  /help --all",
    "",
    "DESCRIPTION",
    "  Opens the complete slash-command manual. Each entry includes usage, aliases, arguments, flags, examples, and notes.",
    "",
    "NAVIGATION",
    "  Scroll this page with j/k, arrow keys, Space, PageUp/PageDown, g, G, Home, and End.",
    "  Press Esc to close it. Use ? or /keyboardshortcuts for key bindings.",
    "",
    "COMMANDS",
    ...COMMANDS.map((command) => `  ${command.usage.padEnd(48)} ${command.description}`),
    ""
  ];

  for (const command of COMMANDS) {
    lines.push(...commandManual(command), "");
  }

  return styleManual(wrapManual(lines, width), theme);
}

function matchesPrefix(command: CommandDefinition, prefix: string): string | undefined {
  if (!prefix) {
    return command.name;
  }
  if (command.name.startsWith(prefix)) {
    return command.name;
  }
  return command.aliases?.find((alias) => alias.startsWith(prefix));
}

type BufferToken = { text: string; start: number; end: number; quote?: '"' | "'" };

function bufferTokens(input: string): BufferToken[] {
  const tokens: BufferToken[] = [];
  let token = "";
  let start = -1;
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (start < 0 && !/\s/.test(char)) {
      start = index;
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
    }
    if (quote) {
      if (char === quote) {
        tokens.push({ text: token, start, end: index + 1, quote });
        token = "";
        start = -1;
        quote = undefined;
      } else {
        token += char;
      }
      continue;
    }
    if (/\s/.test(char)) {
      if (start >= 0) {
        tokens.push({ text: token, start, end: index });
        token = "";
        start = -1;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    token += char;
  }
  if (start >= 0) {
    tokens.push({ text: token, start, end: input.length, quote });
  }
  return tokens;
}

function quoteCompletion(value: string): string {
  return `"${value.replace(/"/g, "\\\"")}"`;
}

function fuzzyStarts(value: string, query: string): boolean {
  return value.toLowerCase().includes(query.toLowerCase());
}

function makeTogglSuggestion(usage: string, description: string, completion: string, start: number, end: number): CommandSuggestion {
  return {
    name: "toggl",
    usage,
    description,
    category: "Integrations",
    detail: "Tab complete",
    aliases: [],
    completion,
    completionStart: start,
    completionEnd: end
  };
}

function listTogglSuggestions(buffer: string, storage?: Storage): CommandSuggestion[] {
  const tokens = bufferTokens(buffer);
  const command = tokens[0];
  if (command?.text !== "toggl") return [];
  const subcommands = ["auth", "sync", "recent", "start", "stop", "log"];
  const action = tokens[1];
  if (!storage && !action) return [];
  if (!action || (tokens.length === 2 && !buffer.endsWith(" ") && !subcommands.includes(action.text))) {
    const query = action?.text ?? "";
    const start = action?.start ?? buffer.length;
    const end = action?.end ?? buffer.length;
    return subcommands
      .filter((subcommand) => fuzzyStarts(subcommand, query))
      .map((subcommand) => makeTogglSuggestion(subcommand, `Toggl ${subcommand}`, subcommand, start, end));
  }
  if (!storage || !["start", "log"].includes(action.text)) return [];

  const projectFlagIndex = tokens.findIndex((token) => token.text === "--project");
  if (projectFlagIndex >= 0) {
    const valueToken = tokens[projectFlagIndex + 1];
    const query = valueToken?.text ?? "";
    const start = valueToken?.start ?? buffer.length;
    const end = valueToken?.end ?? buffer.length;
    const prefix = valueToken ? "" : buffer.endsWith(" ") ? "" : " ";
    return getTogglCache(storage).projects
      .filter((project) => fuzzyStarts(project.name, query) || fuzzyStarts(`${project.clientName ?? ""} ${project.name}`.trim(), query))
      .map((project) => makeTogglSuggestion(quoteCompletion(project.name), project.clientName ? `${project.clientName} / ${project.name}` : project.name, `${prefix}${quoteCompletion(project.name)}`, start, end));
  }

  const descriptionToken = tokens[2];
  if (!descriptionToken) return [];
  const query = descriptionToken.text;
  const start = descriptionToken.start;
  const end = descriptionToken.end;
  return getTogglCache(storage).descriptions
    .filter((item) => fuzzyStarts(item.description, query))
    .map((item) => makeTogglSuggestion(quoteCompletion(item.description), "Recent Toggl description", `${quoteCompletion(item.description)} `, start, end));
}

export function listCommandSuggestions(buffer: string, storage?: Storage): CommandSuggestion[] {
  const togglSuggestions = listTogglSuggestions(buffer, storage);
  if (togglSuggestions.length > 0) {
    return togglSuggestions;
  }
  if (storage && /^\s*toggl\s+/.test(buffer)) {
    return [];
  }
  const trimmed = buffer.trimStart();
  const [rawCommand, ...rest] = trimmed.split(/\s+/).filter(Boolean);
  const prefix = rest.length > 0 || trimmed.endsWith(" ")
    ? rawCommand ?? ""
    : rawCommand ?? "";
  const suggestions: CommandSuggestion[] = [];

  for (const command of COMMANDS) {
    const matchedAlias = matchesPrefix(command, prefix);
    if (!matchedAlias) {
      continue;
    }
    suggestions.push({
      name: command.name,
      usage: command.usage,
      description: command.description,
      category: commandCategory(command),
      detail: commandSuggestionDetail(command, matchedAlias),
      aliases: command.aliases ?? [],
      matchedAlias: matchedAlias === command.name ? undefined : matchedAlias
    });
  }

  return suggestions.sort((left, right) => left.name.localeCompare(right.name));
}

export function applyCommandAutocomplete(buffer: string, suggestion: CommandSuggestion): string {
  if (suggestion.completion !== undefined && suggestion.completionStart !== undefined && suggestion.completionEnd !== undefined) {
    return `${buffer.slice(0, suggestion.completionStart)}${suggestion.completion}${buffer.slice(suggestion.completionEnd)}`;
  }
  const trimmedStart = buffer.match(/^\s*/)?.[0] ?? "";
  const trimmed = buffer.trimStart();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return `${trimmedStart}${suggestion.name}`;
  }
  return `${trimmedStart}${suggestion.name} ${parts.slice(1).join(" ")}`;
}

export function commandAutocompleteIndex(buffer: string, selectedIndex: number, suggestions: CommandSuggestion[]): number {
  if (suggestions.length === 0) {
    return 0;
  }
  const currentIndex = Math.max(0, Math.min(selectedIndex, suggestions.length - 1));
  if (buffer.trim().length === 0) {
    return currentIndex;
  }

  const currentSuggestion = suggestions[currentIndex];
  const parts = buffer.trimStart().split(/\s+/).filter(Boolean);
  const currentCommand = parts[0] ?? "";
  if (parts.length > 1) {
    return currentIndex;
  }
  if (currentCommand === currentSuggestion?.name || currentCommand === currentSuggestion?.matchedAlias) {
    return currentIndex >= suggestions.length - 1 ? 0 : currentIndex + 1;
  }

  return currentIndex;
}
