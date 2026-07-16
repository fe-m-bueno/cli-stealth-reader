import { execFile } from "node:child_process";
import type { Storage } from "./storage.js";

const API_BASE = "https://focus.toggl.com/api";
const TOKEN_PAGE = "https://focus.toggl.com/settings";

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

export interface TogglQuota {
  remaining: number;
  resetsInSeconds: number;
  observedAt: string;
}

export interface TogglCache {
  defaultOrganizationId: number | null;
  defaultWorkspaceId: number | null;
  projects: TogglProject[];
  descriptions: TogglRecentDescription[];
  syncedAt: string | null;
}

export interface TogglTimeEntry {
  id: number;
  workspace_id?: number;
  project_id?: number | null;
  description?: string;
  start?: string;
  duration?: number;
  stop?: string | null;
}

interface FocusPage<T> {
  data?: T[];
  page?: number;
  per_page?: number;
  total?: number;
}

class TogglApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "TogglApiError";
  }
}

export function togglTokenPage(): string {
  return TOKEN_PAGE;
}

export function openTogglTokenPage(): void {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", TOKEN_PAGE] : [TOKEN_PAGE];
  execFile(opener, args, () => {});
}

function emptyCache(): TogglCache {
  return { defaultOrganizationId: null, defaultWorkspaceId: null, projects: [], descriptions: [], syncedAt: null };
}

function readCache(storage: Storage): TogglCache {
  const raw = storage.getSetting("togglCache");
  if (!raw) return emptyCache();
  try {
    const parsed = JSON.parse(raw) as Partial<TogglCache>;
    return {
      defaultOrganizationId: parsed.defaultOrganizationId ?? null,
      defaultWorkspaceId: parsed.defaultWorkspaceId ?? null,
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      descriptions: Array.isArray(parsed.descriptions) ? parsed.descriptions : [],
      syncedAt: parsed.syncedAt ?? null
    };
  } catch {
    return emptyCache();
  }
}

function writeCache(storage: Storage, cache: TogglCache): void {
  storage.setRawSetting("togglCache", JSON.stringify(cache));
}

export function getTogglCache(storage: Storage): TogglCache {
  return readCache(storage);
}

function saveQuota(storage: Storage, response: Response): void {
  const remainingHeader = response.headers.get("X-Toggl-Quota-Remaining");
  const resetHeader = response.headers.get("X-Toggl-Quota-Resets-In");
  if (remainingHeader === null || resetHeader === null) return;
  const remaining = Number(remainingHeader);
  const resetsInSeconds = Number(resetHeader);
  if (!Number.isFinite(remaining) || !Number.isFinite(resetsInSeconds)) return;
  const quota: TogglQuota = {
    remaining: Math.max(0, remaining),
    resetsInSeconds: Math.max(0, resetsInSeconds),
    observedAt: new Date().toISOString()
  };
  storage.setRawSetting("togglQuota", JSON.stringify(quota));
}

export function getTogglQuota(storage: Storage): TogglQuota | null {
  const raw = storage.getSetting("togglQuota");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TogglQuota;
    if (!Number.isFinite(parsed.remaining) || !Number.isFinite(parsed.resetsInSeconds) || !parsed.observedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

function formatSeconds(seconds: number): string {
  const rounded = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = rounded % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainder}s`;
  return `${remainder}s`;
}

export function formatTogglQuota(storage: Storage, now = new Date()): string | null {
  const quota = getTogglQuota(storage);
  if (!quota) return null;
  const elapsed = Math.max(0, (now.getTime() - new Date(quota.observedAt).getTime()) / 1000);
  const resetsIn = Math.max(0, quota.resetsInSeconds - elapsed);
  return `quota ${quota.remaining} · resets in ${formatSeconds(resetsIn)}`;
}

function errorDetail(raw: string): string {
  if (!raw.trim()) return "";
  try {
    const parsed = JSON.parse(raw) as { error?: unknown; message?: unknown; details?: unknown };
    const value = parsed.message ?? parsed.error ?? parsed.details;
    return typeof value === "string" ? value : "";
  } catch {
    return raw.trim().slice(0, 180);
  }
}

function apiError(storage: Storage, status: number, raw: string, statusText: string): TogglApiError {
  const detail = errorDetail(raw);
  if (status === 401) {
    return new TogglApiError(status, `Toggl authentication failed (401). Create a Toggl 2.0 key at ${TOKEN_PAGE}, then run /toggl auth <toggl_sk_...> --organization <id>.`);
  }
  if (status === 402) {
    const quota = getTogglQuota(storage);
    const reset = quota ? formatSeconds(quota.resetsInSeconds) : "the quota window resets";
    return new TogglApiError(status, `Toggl quota exhausted (402). Try again in ${reset}.`);
  }
  if (status === 403) {
    return new TogglApiError(status, `Toggl denied this request (403). Check --organization <id> and your workspace permissions${detail ? `: ${detail}` : "."}`);
  }
  return new TogglApiError(status, `Toggl Focus API ${status}: ${detail || statusText}`);
}

async function togglRequest<T>(storage: Storage, path: string, init: RequestInit = {}, tokenOverride?: string): Promise<T> {
  const token = tokenOverride ?? storage.getSetting("togglApiToken");
  if (!token) {
    throw new Error(`Toggl is not connected. Run /toggl auth <toggl_sk_...> --organization <id>. Key: ${TOKEN_PAGE}`);
  }
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      ...(init.headers ?? {})
    }
  });
  saveQuota(storage, response);
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw apiError(storage, response.status, raw, response.statusText);
  }
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

function positiveId(value: number | undefined): number | null {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}

export async function connectToggl(
  storage: Storage,
  token: string,
  organizationId?: number
): Promise<{ defaultOrganizationId: number | null; defaultWorkspaceId: number | null }> {
  const candidateToken = token.trim();
  const settings = await togglRequest<{ current_workspace_id?: number }>(storage, "/users/me/settings", {}, candidateToken);
  const cache = readCache(storage);
  cache.defaultOrganizationId = positiveId(organizationId) ?? cache.defaultOrganizationId;
  cache.defaultWorkspaceId = positiveId(settings.current_workspace_id) ?? cache.defaultWorkspaceId;
  storage.setRawSetting("togglApiToken", candidateToken);
  writeCache(storage, cache);
  return {
    defaultOrganizationId: cache.defaultOrganizationId,
    defaultWorkspaceId: cache.defaultWorkspaceId
  };
}

export function disconnectToggl(storage: Storage): void {
  storage.setRawSetting("togglApiToken", "");
  storage.setRawSetting("togglCurrentEntry", "");
  storage.setRawSetting("togglQuota", "");
  writeCache(storage, emptyCache());
}

function saveCurrentEntry(storage: Storage, entry: TogglTimeEntry | null): void {
  storage.setRawSetting("togglCurrentEntry", entry ? JSON.stringify(entry) : "");
}

function scope(storage: Storage, workspaceOverride?: number): { organizationId: number; workspaceId: number } {
  const cache = readCache(storage);
  const organizationId = cache.defaultOrganizationId;
  const workspaceId = workspaceOverride ?? cache.defaultWorkspaceId;
  if (!organizationId) throw new Error("Toggl organization is not configured. Run /toggl auth --organization <id>.");
  if (!workspaceId) throw new Error("No Toggl workspace found. Reconnect with /toggl auth <toggl_sk_...> --organization <id>.");
  return { organizationId, workspaceId };
}

function scopedPath(storage: Storage, suffix: string, workspaceOverride?: number): string {
  const { organizationId, workspaceId } = scope(storage, workspaceOverride);
  return `/organizations/${organizationId}/workspaces/${workspaceId}${suffix}`;
}

export async function refreshCurrentTogglEntry(storage: Storage): Promise<TogglTimeEntry | null> {
  const previousEntry = storage.getSetting("togglCurrentEntry") ?? "";
  const current = await togglRequest<TogglTimeEntry | undefined>(storage, scopedPath(storage, "/tracking/current"));
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
    const workspaceId = entry.workspace_id;
    if (!description || !workspaceId) continue;
    if (!seen.has(description.toLowerCase())) {
      seen.set(description.toLowerCase(), {
        description,
        projectId: entry.project_id ?? undefined,
        workspaceId,
        lastUsedAt: entry.start ?? new Date().toISOString()
      });
    }
  }
  return Array.from(seen.values()).slice(0, 25);
}

export async function syncToggl(storage: Storage): Promise<TogglCache> {
  const { workspaceId } = scope(storage);
  const projectPage = await togglRequest<FocusPage<{
    id: number;
    workspace_id: number;
    name: string;
    client?: { name?: string };
    color?: string;
    active?: boolean;
  }>>(storage, `${scopedPath(storage, "/projects")}?page=1&per_page=200`);
  const projects = (projectPage.data ?? [])
    .filter((project) => project.active !== false)
    .map((project) => ({
      id: project.id,
      workspaceId: project.workspace_id ?? workspaceId,
      name: project.name,
      clientName: project.client?.name,
      color: project.color
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const now = new Date();
  const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const query = new URLSearchParams({
    date_from: from.toISOString(),
    date_to: now.toISOString(),
    page: "1",
    per_page: "25",
    order_by: "-start",
    include_taskless: "true"
  });
  const entriesPage = await togglRequest<FocusPage<TogglTimeEntry>>(storage, `${scopedPath(storage, "/time-entries")}?${query}`);
  const previous = readCache(storage);
  const cache: TogglCache = {
    defaultOrganizationId: previous.defaultOrganizationId,
    defaultWorkspaceId: workspaceId,
    projects,
    descriptions: uniqueDescriptions(entriesPage.data ?? []),
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
  const { workspaceId } = scope(storage, project?.workspaceId);
  const entry = await togglRequest<TogglTimeEntry>(storage, scopedPath(storage, "/tracking/start", workspaceId), {
    method: "POST",
    body: JSON.stringify({
      description,
      project_id: project?.id,
      start: new Date().toISOString(),
      type: "activity"
    })
  });
  saveCurrentEntry(storage, entry);
  return entry;
}

export async function logTogglEntry(storage: Storage, description: string, duration: string, projectQuery?: string): Promise<TogglTimeEntry> {
  const project = resolveRequestedProject(storage, projectQuery);
  const { workspaceId } = scope(storage, project?.workspaceId);
  const seconds = parseDurationToSeconds(duration);
  const trackedAt = new Date();
  const start = new Date(trackedAt.getTime() - seconds * 1000);
  return await togglRequest<TogglTimeEntry>(storage, scopedPath(storage, "/time-entries", workspaceId), {
    method: "POST",
    body: JSON.stringify({
      description,
      project_id: project?.id,
      start: start.toISOString(),
      tracked_at: trackedAt.toISOString(),
      duration: seconds,
      type: "activity"
    })
  });
}

export async function stopTogglEntry(storage: Storage): Promise<TogglTimeEntry | null> {
  try {
    const stopped = await togglRequest<TogglTimeEntry>(storage, scopedPath(storage, "/tracking/stop"), {
      method: "POST",
      body: JSON.stringify({ end: new Date().toISOString() })
    });
    saveCurrentEntry(storage, null);
    return stopped;
  } catch (error) {
    if (error instanceof TogglApiError && error.status === 404) {
      saveCurrentEntry(storage, null);
      return null;
    }
    throw error;
  }
}

export function formatTogglRecents(storage: Storage): string[] {
  const cache = readCache(storage);
  const lines = [
    `Organization ${cache.defaultOrganizationId ?? "not configured"} · Workspace ${cache.defaultWorkspaceId ?? "not configured"}`,
    `Projects (${cache.projects.length})`
  ];
  lines.push(...cache.projects.slice(0, 10).map((project) => `  ${project.clientName ? `${project.clientName} / ` : ""}${project.name}`));
  lines.push(`Descriptions (${cache.descriptions.length})`);
  lines.push(...cache.descriptions.slice(0, 10).map((item) => `  ${item.description}`));
  const quota = formatTogglQuota(storage);
  if (quota) lines.push(`API ${quota}`);
  if (cache.syncedAt) lines.push(`Synced ${cache.syncedAt}`);
  return lines;
}
