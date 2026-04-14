import type { CommandDefinition, CommandSuggestion, ParsedCommandResult } from "./types.js";

export const COMMANDS: CommandDefinition[] = [
  { name: "prev", description: "Go to previous chapter.", args: [{ name: "count" }], usage: "/prev [count]" },
  { name: "next", description: "Go to next chapter.", args: [{ name: "count" }], usage: "/next [count]" },
  {
    name: "chapters",
    description: "Open the table of contents.",
    args: [{ name: "query" }],
    flags: [{ name: "current" }, { name: "flat" }],
    usage: "/chapters [query] [--current] [--flat]"
  },
  {
    name: "changebook",
    aliases: ["book"],
    description: "Switch books from the library or current folder.",
    args: [{ name: "query" }],
    flags: [{ name: "recent" }, { name: "cwd" }, { name: "sort", takesValue: true }],
    usage: "/changebook [query] [--recent] [--cwd] [--sort lastOpened|title|author|progress]"
  },
  {
    name: "colorscheme",
    aliases: ["theme"],
    description: "Change or preview the active colorscheme.",
    args: [{ name: "theme" }],
    flags: [{ name: "preview" }, { name: "list" }],
    usage: "/colorscheme [theme] [--preview] [--list]"
  },
  {
    name: "resume",
    description: "Resume the latest or a specific book.",
    args: [{ name: "book-query" }],
    flags: [{ name: "latest" }],
    usage: "/resume [book-query] [--latest]"
  },
  {
    name: "add",
    description: "Import an EPUB, CBZ, or PDF from cwd or an explicit path.",
    args: [{ name: "path" }],
    flags: [{ name: "cwd" }, { name: "force" }],
    usage: "/add [path] [--cwd] [--force]"
  },
  {
    name: "remove",
    description: "Remove a book from the library.",
    args: [{ name: "book-query" }],
    flags: [{ name: "current" }],
    usage: "/remove [book-query] [--current]"
  },
  {
    name: "removecurrent",
    description: "Remove the current book from the library.",
    flags: [{ name: "confirm" }],
    usage: "/removecurrent [--confirm]"
  },
  {
    name: "toggleprogress",
    description: "Set progress display mode.",
    args: [{ name: "mode" }],
    usage: "/toggleprogress [book|both|chapter|hidden]"
  },
  {
    name: "mode",
    description: "Switch rendering mode or code language.",
    args: [{ name: "mode", required: true }],
    usage: "/mode [plain|typescript|python|rust]"
  },
  {
    name: "highlight",
    description: "Toggle plain-mode dialogue highlight (required flag).",
    flags: [{ name: "on" }, { name: "off" }],
    usage: "/highlight --on|--off"
  },
  {
    name: "help",
    description: "Show help for commands.",
    args: [{ name: "command" }],
    flags: [{ name: "all" }],
    usage: "/help [command] [--all]"
  },
  {
    name: "keyboardshortcuts",
    aliases: ["keys"],
    description: "Show keyboard shortcuts.",
    flags: [{ name: "category", takesValue: true }],
    usage: "/keyboardshortcuts [--category navigation|commands|view]"
  },
  {
    name: "density",
    description: "Set code density (1=max comments, 5=max code). Tecla d cicla entre 1→3→5.",
    args: [{ name: "level" }],
    usage: "/density [1-5]"
  },
  {
    name: "goto",
    description: "Jump by book %, chapter %, or chapter number.",
    args: [{ name: "position", required: true }],
    flags: [{ name: "chapter" }],
    usage: "/goto <n|%> [--chapter]  (ex: /goto 42%  /goto 30%c  /goto 5)"
  },
  {
    name: "search",
    description: "Search in the current chapter; use -g or --global for the whole book.",
    args: [{ name: "term" }],
    flags: [{ name: "global", alias: "g" }],
    usage: "/search [-g|--global] <term>"
  },
  {
    name: "mark",
    description: "Save a bookmark at the current reading position.",
    args: [{ name: "label" }],
    usage: "/mark [label]"
  },
  {
    name: "marks",
    description: "Open bookmarks for the current book.",
    usage: "/marks"
  },
  {
    name: "delmark",
    description: "Delete a bookmark by id or label.",
    args: [{ name: "id-or-label", required: true }],
    usage: "/delmark <id|label>"
  },
  {
    name: "export",
    description: "Export reading state (positions, bookmarks, notes, tags) to JSON.",
    args: [{ name: "path" }],
    usage: "/export [path]"
  },
  {
    name: "import",
    description: "Import and merge reading state from a JSON export file.",
    args: [{ name: "path" }],
    usage: "/import [path]"
  },
  {
    name: "tag",
    description: "Add, remove, or list tags for the current book.",
    args: [{ name: "tag" }],
    flags: [{ name: "delete", alias: "d" }],
    usage: "/tag [tag] [-d <tag>]"
  },
  {
    name: "tags",
    description: "List tags for the current book.",
    usage: "/tags"
  },
  {
    name: "note",
    description: "Add a note at current position, list notes (-l), or delete a note (-d <id>).",
    args: [{ name: "text" }],
    flags: [{ name: "list", alias: "l" }, { name: "delete", alias: "d" }],
    usage: "/note [text] [-l] [-d <id>]"
  }
];

const aliasLookup = new Map<string, string>();
for (const command of COMMANDS) {
  aliasLookup.set(command.name, command.name);
  for (const alias of command.aliases ?? []) {
    aliasLookup.set(alias, command.name);
  }
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

export function commandHelp(commandName?: string): string[] {
  if (!commandName) {
    return COMMANDS.map((command) => `${command.usage.padEnd(42)} ${command.description}`);
  }
  const command = COMMANDS.find((item) => item.name === commandName || item.aliases?.includes(commandName));
  if (!command) {
    return [`No help available for ${commandName}.`];
  }
  const lines = [command.usage, command.description];
  if (command.aliases?.length) {
    lines.push(`Aliases: ${command.aliases.join(", ")}`);
  }
  return lines;
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

export function listCommandSuggestions(buffer: string): CommandSuggestion[] {
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
      aliases: command.aliases ?? [],
      matchedAlias: matchedAlias === command.name ? undefined : matchedAlias
    });
  }

  return suggestions.sort((left, right) => left.name.localeCompare(right.name));
}

export function applyCommandAutocomplete(buffer: string, suggestion: CommandSuggestion): string {
  const trimmedStart = buffer.match(/^\s*/)?.[0] ?? "";
  const trimmed = buffer.trimStart();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return `${trimmedStart}${suggestion.name}`;
  }
  return `${trimmedStart}${suggestion.name} ${parts.slice(1).join(" ")}`;
}
