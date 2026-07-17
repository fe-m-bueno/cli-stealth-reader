import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compareText } from "./locale.js";
import type { FolderDiscovery } from "./types.js";

const SUPPORTED_EXTENSIONS = new Set([".epub", ".cbz", ".pdf"]);

export function resolveLibraryDirectory(
  configured: string | null | undefined,
  cwd = process.cwd(),
  home = os.homedir()
): string {
  const value = configured?.trim();
  if (!value) return path.resolve(cwd);
  const expanded = value === "~"
    ? home
    : value.startsWith("~/") || value.startsWith("~\\")
      ? path.join(home, value.slice(2))
      : value;
  return path.resolve(cwd, expanded);
}

export async function discoverBooks(root: string): Promise<FolderDiscovery[]> {
  const absoluteRoot = path.resolve(root);
  const discoveries: FolderDiscovery[] = [];

  async function visit(directory: string, isRoot = false): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isRoot) throw error;
      return;
    }
    await Promise.all(entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        discoveries.push({
          path: entryPath,
          fileName: path.relative(absoluteRoot, entryPath)
        });
      }
    }));
  }

  await visit(absoluteRoot, true);
  return discoveries.sort((a, b) => compareText(a.fileName, b.fileName));
}
