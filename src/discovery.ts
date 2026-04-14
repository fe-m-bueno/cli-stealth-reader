import fs from "node:fs/promises";
import path from "node:path";
import type { FolderDiscovery } from "./types.js";

export async function discoverEpubs(cwd: string): Promise<FolderDiscovery[]> {
  const entries = await fs.readdir(cwd, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".epub"))
    .map((entry) => ({
      path: path.join(cwd, entry.name),
      fileName: entry.name
    }))
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
}
