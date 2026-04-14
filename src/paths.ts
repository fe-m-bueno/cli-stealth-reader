import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export interface AppPaths {
  dataDir: string;
  cacheDir: string;
  dbPath: string;
}

function ensure(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getAppPaths(): AppPaths {
  const xdgData = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  const xdgCache = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  const dataDir = ensure(path.join(xdgData, "cli-stealth-reader"));
  const cacheDir = ensure(path.join(xdgCache, "cli-stealth-reader"));
  return {
    dataDir,
    cacheDir,
    dbPath: path.join(dataDir, "library.db")
  };
}
