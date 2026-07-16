import { execFile } from "node:child_process";
import type { Storage } from "./storage.js";

const API_BASE = "https://api.track.toggl.com/api/v9";
const TOKEN_PAGE = "https://track.toggl.com/profile";

export interface TogglProject {
  id: number;
  workspaceId: number;
  name: string;
  clientName?: string;
  color?: string;
}

export interface TogglRecentDescription {
  description: string;
  projectId?: number;
  workspaceId: number;
  lastUsedAt: string;
}

export interface TogglCache {
  defaultWorkspaceId: number | null;
  projects: TogglProject[];
  descriptions: TogglRecentDescription[];
  syncedAt: string | null;
}

export interface TogglTimeEntry {
  id: number;
  workspace_id?: number;
  wid?: number;
  project_id?: number | null;
  pid?: number | null;
  description?: string;
  start?: string;
  stop?: string | null;
  duration?: number;
}

export function togglTokenPage(): string {
  return TOKEN_PAGE;
}

export function openTogglTokenPage(): void {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", TOKEN_PAGE] : [TOKEN_PAGE];
  execFile(opener, args, () => {});
}

function authHeader(token: string): string {
  return `Basic ${Buffer.from(`${token}:api_token`).toString("base64")}`;
}

async function togglRequest<T>(storage: Storage, path: string, init: RequestInit = {}, tokenOverride?: string): Promise<T> {
  const token = tokenOverride ?? storage.getSetting("togglApiToken");
  if (!token) {
    throw new Error(`Toggl is not connected. Run /toggl auth and paste your API token from ${TOKEN_PAGE}.`);
  }
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Authorization": authHeader(token),
      ...(init.headers ?? {})
    }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Toggl API ${response.status}: ${text || response.statusText}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return await response.json() as T;
}

function readCache(storage: Storage): TogglCache {
  const raw = storage.getSetting("togglCache");
  if (!raw) {
    return { defaultWorkspaceId: null, projects: [], descriptions: [], syncedAt: null };
  }
  try {
    const parsed = JSON.parse(raw) as TogglCache;
    return {
      defaultWorkspaceId: parsed.defaultWorkspaceId ?? null,
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      descriptions: Array.isArray(parsed.descriptions) ? parsed.descriptions : [],
      syncedAt: parsed.syncedAt ?? null
    };
  } catch {
    return { defaultWorkspaceId: null, projects: [], descriptions: [], syncedAt: null };
  }
}

function writeCache(storage: Storage, cache: TogglCache): void {
  storage.setRawSetting("togglCache", JSON.stringify(cache));
}

export function getTogglCache(storage: Storage): TogglCache {
  return readCache(storage);
}

export async function connectToggl(storage: Storage, token: string): Promise<{ fullName?: string; defaultWorkspaceId: number | null }> {
  const candidateToken = token.trim();
  const me = await togglRequest<{ fullname?: string; default_workspace_id?: number; workspaces?: Array<{ id: number }> }>(
    storage,
    "/me?with_related_data=true",
    {},
    candidateToken
  );
  storage.setRawSetting("togglApiToken", candidateToken);
  const defaultWorkspaceId = me.default_workspace_id ?? me.workspaces?.[0]?.id ?? null;
  const cache = readCache(storage);
  cache.defaultWorkspaceId = defaultWorkspaceId;
  writeCache(storage, cache);
  return { fullName: me.fullname, defaultWorkspaceId };
}

export function disconnectToggl(storage: Storage): void {
  storage.setRawSetting("togglApiToken", "");
  storage.setRawSetting("togglCurrentEntry", "");
  writeCache(storage, { defaultWorkspaceId: null, projects: [], descriptions: [], syncedAt: null });
}

function saveCurrentEntry(storage: Storage, entry: TogglTimeEntry | null): void {
  storage.setRawSetting("togglCurrentEntry", entry ? JSON.stringify(entry) : "");
}

export async function refreshCurrentTogglEntry(storage: Storage): Promise<TogglTimeEntry | null> {
  const previousEntry = storage.getSetting("togglCurrentEntry") ?? "";
  const current = await togglRequest<TogglTimeEntry | null>(storage, "/me/time_entries/current");
  if ((storage.getSetting("togglCurrentEntry") ?? "") === previousEntry) {
    saveCurrentEntry(storage, current?.id ? current : null);
  }
  return current?.id ? current : null;
}

export function formatRunningTogglTimer(storage: Storage | undefined, now = new Date()): string | null {
  const raw = storage?.getSetting("togglCurrentEntry");
  if (!raw) return null;
  try {
    const entry = JSON.parse(raw) as TogglTimeEntry;
    if (!entry.start || entry.stop) return null;
    const elapsedMs = Math.max(0, now.getTime() - new Date(entry.start).getTime());
    const elapsedMinutes = Math.max(0, Math.floor(elapsedMs / 60000));
    const hours = Math.floor(elapsedMinutes / 60);
    const minutes = elapsedMinutes % 60;
    const elapsed = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
    const description = entry.description?.trim() || `#${entry.id}`;
    return `Toggl ${elapsed} · ${description}`;
  } catch {
    return null;
  }
}

function uniqueDescriptions(entries: TogglTimeEntry[]): TogglRecentDescription[] {
  const seen = new Map<string, TogglRecentDescription>();
  for (const entry of entries) {
    const description = entry.description?.trim();
    const workspaceId = entry.workspace_id ?? entry.wid;
    if (!description || !workspaceId) continue;
    if (!seen.has(description.toLowerCase())) {
      seen.set(description.toLowerCase(), {
        description,
        projectId: entry.project_id ?? entry.pid ?? undefined,
        workspaceId,
        lastUsedAt: entry.start ?? new Date().toISOString()
      });
    }
  }
  return Array.from(seen.values()).slice(0, 25);
}

export async function syncToggl(storage: Storage): Promise<TogglCache> {
  const me = await togglRequest<{ default_workspace_id?: number; workspaces?: Array<{ id: number }> }>(storage, "/me?with_related_data=true");
  const workspaceIds = (me.workspaces ?? []).map((workspace) => workspace.id);
  const defaultWorkspaceId = me.default_workspace_id ?? workspaceIds[0] ?? null;
  const projects: TogglProject[] = [];
  for (const workspaceId of workspaceIds) {
    const workspaceProjects = await togglRequest<Array<{ id: number; wid?: number; workspace_id?: number; name: string; client_name?: string; color?: string; active?: boolean }>>(
      storage,
      `/workspaces/${workspaceId}/projects`
    );
    for (const project of workspaceProjects) {
      if (project.active === false) continue;
      projects.push({
        id: project.id,
        workspaceId: project.workspace_id ?? project.wid ?? workspaceId,
        name: project.name,
        clientName: project.client_name,
        color: project.color
      });
    }
  }
  const recentEntries = await togglRequest<TogglTimeEntry[]>(storage, "/me/time_entries");
  const cache: TogglCache = {
    defaultWorkspaceId,
    projects: projects.sort((a, b) => a.name.localeCompare(b.name)),
    descriptions: uniqueDescriptions(recentEntries),
    syncedAt: new Date().toISOString()
  };
  writeCache(storage, cache);
  await refreshCurrentTogglEntry(storage);
  return cache;
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

export function resolveTogglProject(storage: Storage, query: string | undefined): TogglProject | undefined {
  if (!query?.trim()) return undefined;
  const cache = readCache(storage);
  const q = normalize(query);
  return cache.projects.find((project) => normalize(project.name) === q)
    ?? cache.projects.find((project) => normalize(`${project.clientName ?? ""} ${project.name}`).includes(q))
    ?? cache.projects.find((project) => normalize(project.name).includes(q));
}

function resolveRequestedProject(storage: Storage, query: string | undefined): TogglProject | undefined {
  const project = resolveTogglProject(storage, query);
  if (query?.trim() && !project) {
    throw new Error(`Toggl project "${query}" was not found. Run /toggl sync and try again.`);
  }
  return project;
}

function parseDurationToSeconds(input: string): number {
  const match = input.trim().match(/^(\d+(?:\.\d+)?)(m|h|s)?$/i);
  if (!match) throw new Error("Duration must look like 25m, 1.5h, or 900s.");
  const value = Number(match[1]);
  const unit = (match[2] ?? "m").toLowerCase();
  if (unit === "h") return Math.round(value * 3600);
  if (unit === "s") return Math.round(value);
  return Math.round(value * 60);
}

export async function startTogglEntry(storage: Storage, description: string, projectQuery?: string): Promise<TogglTimeEntry> {
  const project = resolveRequestedProject(storage, projectQuery);
  const cache = readCache(storage);
  const workspaceId = project?.workspaceId ?? cache.defaultWorkspaceId;
  if (!workspaceId) throw new Error("No Toggl workspace found. Run /toggl sync after connecting.");
  const entry = await togglRequest<TogglTimeEntry>(storage, `/workspaces/${workspaceId}/time_entries`, {
    method: "POST",
    body: JSON.stringify({
      description,
      workspace_id: workspaceId,
      project_id: project?.id,
      start: new Date().toISOString(),
      duration: -1,
      created_with: "cli-stealth-reader"
    })
  });
  saveCurrentEntry(storage, entry);
  return entry;
}

export async function logTogglEntry(storage: Storage, description: string, duration: string, projectQuery?: string): Promise<TogglTimeEntry> {
  const project = resolveRequestedProject(storage, projectQuery);
  const cache = readCache(storage);
  const workspaceId = project?.workspaceId ?? cache.defaultWorkspaceId;
  if (!workspaceId) throw new Error("No Toggl workspace found. Run /toggl sync after connecting.");
  const seconds = parseDurationToSeconds(duration);
  const stop = new Date();
  const start = new Date(stop.getTime() - seconds * 1000);
  return await togglRequest<TogglTimeEntry>(storage, `/workspaces/${workspaceId}/time_entries`, {
    method: "POST",
    body: JSON.stringify({
      description,
      workspace_id: workspaceId,
      project_id: project?.id,
      start: start.toISOString(),
      stop: stop.toISOString(),
      duration: seconds,
      created_with: "cli-stealth-reader"
    })
  });
}

export async function stopTogglEntry(storage: Storage): Promise<TogglTimeEntry | null> {
  const current = await refreshCurrentTogglEntry(storage);
  if (!current) return null;
  const workspaceId = current.workspace_id ?? current.wid;
  if (!workspaceId) throw new Error("Current Toggl entry has no workspace id.");
  const stopped = await togglRequest<TogglTimeEntry>(storage, `/workspaces/${workspaceId}/time_entries/${current.id}/stop`, { method: "PATCH" });
  saveCurrentEntry(storage, null);
  return stopped;
}

export function formatTogglRecents(storage: Storage): string[] {
  const cache = readCache(storage);
  const lines = [`Projects (${cache.projects.length})`];
  lines.push(...cache.projects.slice(0, 10).map((project) => `  ${project.clientName ? `${project.clientName} / ` : ""}${project.name}`));
  lines.push(`Descriptions (${cache.descriptions.length})`);
  lines.push(...cache.descriptions.slice(0, 10).map((item) => `  ${item.description}`));
  if (cache.syncedAt) lines.push(`Synced ${cache.syncedAt}`);
  return lines;
}
