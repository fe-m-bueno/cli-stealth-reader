import fs from "node:fs/promises";
import path from "node:path";
import type { FolderDiscovery } from "./types.js";

const SUPPORTED_EXTENSIONS = new Set([".epub", ".cbz", ".pdf"]);

export async function discoverBooks(cwd: string): Promise<FolderDiscovery[]> {
  const entries = await fs.readdir(cwd, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => ({
      path: path.join(cwd, entry.name),
      fileName: entry.name
    }))
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
}
