import test from "node:test";
import assert from "node:assert/strict";
import { parseSlashCommand, listCommandSuggestions, applyCommandAutocomplete } from "../src/commands.js";
import { connectToggl, formatRunningTogglTimer, formatTogglRecents, logTogglEntry, refreshCurrentTogglEntry, resolveTogglProject, startTogglEntry, stopTogglEntry, syncToggl } from "../src/toggl.js";
import type { Storage } from "../src/storage.js";

class FakeStorage {
  private settings = new Map<string, string>();
  getSetting(key: string): string | null { return this.settings.get(key) ?? null; }
  setRawSetting(key: string, value: string): void { this.settings.set(key, value); }
}

function fakeStorageWithCache(): Storage {
  const storage = new FakeStorage();
  storage.setRawSetting("togglApiToken", "test-token");
  storage.setRawSetting("togglCache", JSON.stringify({
    defaultWorkspaceId: 1,
    syncedAt: "2026-06-30T12:00:00.000Z",
    projects: [
      { id: 10, workspaceId: 1, name: "Reading books", clientName: "Personal" },
      { id: 11, workspaceId: 1, name: "Reading manga" }
    ],
    descriptions: [
      { description: "O Nome do Vento", projectId: 10, workspaceId: 1, lastUsedAt: "2026-06-29T12:00:00.000Z" },
      { description: "Choujin X", projectId: 11, workspaceId: 1, lastUsedAt: "2026-06-28T12:00:00.000Z" }
    ]
  }));
  return storage as unknown as Storage;
}

test("starting a Toggl timer sends the complete Track API v9 workspace payload", async (t) => {
  const requests: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: JSON.parse(String(init?.body)) as Record<string, unknown>
    });
    return new Response(JSON.stringify({
      id: 42,
      workspace_id: 1,
      project_id: 10,
      description: "O Nome do Vento",
      start: "2026-06-30T12:00:00.000Z",
      stop: null,
      duration: -1
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  });

  await startTogglEntry(fakeStorageWithCache(), "O Nome do Vento", "Reading books");

  assert.equal(requests[0]?.url, "https://api.track.toggl.com/api/v9/workspaces/1/time_entries");
  assert.equal(requests[0]?.method, "POST");
  assert.equal(requests[0]?.body.workspace_id, 1);
  assert.equal(requests[0]?.body.project_id, 10);
  assert.equal(requests[0]?.body.duration, -1);
  assert.equal(typeof requests[0]?.body.start, "string");
  assert.equal(requests[0]?.body.created_with, "cli-stealth-reader");
});

test("starting a Toggl timer rejects an unknown requested project", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("fetch should not be called");
  });

  await assert.rejects(
    startTogglEntry(fakeStorageWithCache(), "O Nome do Vento", "Missing project"),
    /Toggl project "Missing project" was not found/
  );
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("logging completed Toggl time sends the complete Track API v9 workspace payload", async (t) => {
  let url = "";
  let method = "";
  let body: Record<string, unknown> | undefined;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    url = String(input);
    method = init?.method ?? "GET";
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ id: 43, workspace_id: 1, duration: 1500 }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  });

  await logTogglEntry(fakeStorageWithCache(), "Choujin X", "25m", "Reading manga");

  assert.equal(url, "https://api.track.toggl.com/api/v9/workspaces/1/time_entries");
  assert.equal(method, "POST");
  assert.equal(body?.workspace_id, 1);
  assert.equal(body?.project_id, 11);
  assert.equal(body?.duration, 1500);
  assert.equal(typeof body?.start, "string");
  assert.equal(typeof body?.stop, "string");
  assert.equal(body?.created_with, "cli-stealth-reader");
});

test("logging completed Toggl time rejects an unknown requested project", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("fetch should not be called");
  });

  await assert.rejects(
    logTogglEntry(fakeStorageWithCache(), "Choujin X", "25m", "Missing project"),
    /Toggl project "Missing project" was not found/
  );
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("failed Toggl authentication does not persist an invalid token", async (t) => {
  const storage = new FakeStorage();
  t.mock.method(globalThis, "fetch", async () => new Response("Invalid credentials", { status: 401 }));

  await assert.rejects(
    connectToggl(storage as unknown as Storage, "invalid-token"),
    /Toggl API 401/
  );

  assert.equal(storage.getSetting("togglApiToken"), null);
});

test("successful Toggl authentication uses API-token Basic Auth before persisting", async (t) => {
  const storage = new FakeStorage();
  let authorization = "";
  t.mock.method(globalThis, "fetch", async (_input: string | URL | Request, init?: RequestInit) => {
    authorization = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? "");
    return new Response(JSON.stringify({ fullname: "Reader", default_workspace_id: 1, workspaces: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  });

  await connectToggl(storage as unknown as Storage, "valid-token");

  assert.equal(authorization, `Basic ${Buffer.from("valid-token:api_token").toString("base64")}`);
  assert.equal(storage.getSetting("togglApiToken"), "valid-token");
});

test("Toggl sync reconciles the account's current running timer", async (t) => {
  const storage = fakeStorageWithCache();
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    const payload = url.endsWith("/me/time_entries/current")
      ? { id: 99, workspace_id: 1, description: "External timer", start: "2026-06-30T12:00:00.000Z", stop: null, duration: -1 }
      : url.endsWith("/me/time_entries")
        ? []
        : { default_workspace_id: 1, workspaces: [] };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  });

  await syncToggl(storage);

  assert.equal(
    formatRunningTogglTimer(storage, new Date("2026-06-30T12:42:00.000Z")),
    "Toggl 42m · External timer"
  );
});

test("stopping with no remote timer clears a stale local footer timer", async (t) => {
  const storage = fakeStorageWithCache();
  storage.setRawSetting("togglCurrentEntry", JSON.stringify({
    id: 99,
    workspace_id: 1,
    description: "Stale timer",
    start: "2026-06-30T12:00:00.000Z",
    stop: null
  }));
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(null), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  }));

  const stopped = await stopTogglEntry(storage);

  assert.equal(stopped, null);
  assert.equal(formatRunningTogglTimer(storage), null);
});

test("stopping a Toggl timer uses the Track API v9 PATCH endpoint", async (t) => {
  const storage = fakeStorageWithCache();
  const requests: Array<{ url: string; method: string }> = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? "GET" });
    const payload = url.endsWith("/current")
      ? { id: 99, workspace_id: 1, description: "Reading", start: "2026-06-30T12:00:00.000Z", stop: null }
      : { id: 99, workspace_id: 1, description: "Reading", start: "2026-06-30T12:00:00.000Z", stop: "2026-06-30T12:42:00.000Z" };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  });

  await stopTogglEntry(storage);

  assert.deepEqual(requests, [
    { url: "https://api.track.toggl.com/api/v9/me/time_entries/current", method: "GET" },
    { url: "https://api.track.toggl.com/api/v9/workspaces/1/time_entries/99/stop", method: "PATCH" }
  ]);
  assert.equal(formatRunningTogglTimer(storage), null);
});

test("a delayed timer refresh cannot overwrite a newer local start or stop", async (t) => {
  const storage = fakeStorageWithCache();
  storage.setRawSetting("togglCurrentEntry", JSON.stringify({
    id: 1,
    workspace_id: 1,
    description: "Old timer",
    start: "2026-06-30T12:00:00.000Z",
    stop: null
  }));
  let resolveResponse!: (response: Response) => void;
  const delayedResponse = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });
  t.mock.method(globalThis, "fetch", async () => delayedResponse);

  const refresh = refreshCurrentTogglEntry(storage);
  storage.setRawSetting("togglCurrentEntry", JSON.stringify({
    id: 2,
    workspace_id: 1,
    description: "New timer",
    start: "2026-06-30T13:00:00.000Z",
    stop: null
  }));
  resolveResponse(new Response(JSON.stringify({
    id: 1,
    workspace_id: 1,
    description: "Old timer",
    start: "2026-06-30T12:00:00.000Z",
    stop: null
  }), { status: 200, headers: { "Content-Type": "application/json" } }));
  await refresh;

  assert.equal(
    formatRunningTogglTimer(storage, new Date("2026-06-30T13:05:00.000Z")),
    "Toggl 5m · New timer"
  );
});

test("parses toggl start and log commands", () => {
  const start = parseSlashCommand('/toggl start "O Nome do Vento" --project "Reading books"');
  assert.equal(start.name, "toggl");
  assert.deepEqual(start.args, ["start", "O Nome do Vento"]);
  assert.equal(start.flags.project, "Reading books");

  const log = parseSlashCommand('/toggl log "Choujin X" --duration 45m --project "Reading manga"');
  assert.equal(log.flags.duration, "45m");
  assert.equal(log.flags.project, "Reading manga");
});

test("toggl command appears as an integration suggestion", () => {
  const suggestions = listCommandSuggestions("tog");
  assert.equal(suggestions[0]?.name, "toggl");
  assert.equal(suggestions[0]?.category, "Integrations");
});

test("toggl cache resolves projects by exact, partial, and client-qualified names", () => {
  const storage = fakeStorageWithCache();
  assert.equal(resolveTogglProject(storage, "Reading books")?.id, 10);
  assert.equal(resolveTogglProject(storage, "manga")?.id, 11);
  assert.equal(resolveTogglProject(storage, "Personal")?.id, 10);
});

test("toggl recent formatter shows cached projects and descriptions", () => {
  const lines = formatTogglRecents(fakeStorageWithCache());
  assert.ok(lines.some((line) => line.includes("Personal / Reading books")));
  assert.ok(lines.some((line) => line.includes("Choujin X")));
});

test("toggl autocomplete completes subcommands", () => {
  const suggestions = listCommandSuggestions("toggl st", fakeStorageWithCache());
  assert.equal(suggestions[0]?.usage, "start");
  assert.equal(applyCommandAutocomplete("toggl st", suggestions[0]), "toggl start");
});

test("toggl autocomplete replaces the full token under a mid-command cursor", () => {
  const input = 'toggl strt "O Nome do Vento"';
  const cursor = "toggl st".length;
  const suggestions = listCommandSuggestions(input, fakeStorageWithCache(), cursor);

  assert.equal(suggestions[0]?.usage, "start");
  assert.equal(
    applyCommandAutocomplete(input, suggestions[0]),
    'toggl start "O Nome do Vento"'
  );
});

test("toggl description completion preserves a following flag with one separator", () => {
  const input = 'toggl start O Noxx --project "Reading books"';
  const cursor = "toggl start O No".length;
  const suggestions = listCommandSuggestions(input, fakeStorageWithCache(), cursor);

  assert.equal(
    applyCommandAutocomplete(input, suggestions[0]),
    'toggl start "O Nome do Vento" --project "Reading books"'
  );
});

test("toggl autocomplete completes recent descriptions inside quotes", () => {
  const suggestions = listCommandSuggestions('toggl start "O', fakeStorageWithCache());
  assert.equal(suggestions[0]?.usage, '"O Nome do Vento"');
  assert.equal(applyCommandAutocomplete('toggl start "O', suggestions[0]), 'toggl start "O Nome do Vento" ');
});

test("toggl autocomplete replaces an entire unquoted multiword description", () => {
  const input = "toggl start O Nome";
  const suggestions = listCommandSuggestions(input, fakeStorageWithCache());

  assert.equal(suggestions[0]?.usage, '"O Nome do Vento"');
  assert.equal(applyCommandAutocomplete(input, suggestions[0]), 'toggl start "O Nome do Vento" ');
});

test("toggl autocomplete completes project flag values", () => {
  const suggestions = listCommandSuggestions('toggl start "O Nome do Vento" --project Read', fakeStorageWithCache());
  assert.equal(suggestions[0]?.usage, '"Reading books"');
  assert.equal(applyCommandAutocomplete('toggl start "O Nome do Vento" --project Read', suggestions[0]), 'toggl start "O Nome do Vento" --project "Reading books"');
});

test("toggl autocomplete replaces an entire unquoted multiword project", () => {
  const input = 'toggl start "O Nome do Vento" --project Reading b';
  const suggestions = listCommandSuggestions(input, fakeStorageWithCache());

  assert.equal(suggestions[0]?.usage, '"Reading books"');
  assert.equal(
    applyCommandAutocomplete(input, suggestions[0]),
    'toggl start "O Nome do Vento" --project "Reading books"'
  );
});

test("toggl autocomplete does not rewrite the project while editing duration", () => {
  const input = "toggl log Choujin --project Read --duration 25";
  const suggestions = listCommandSuggestions(input, fakeStorageWithCache(), input.length);

  assert.deepEqual(suggestions, []);
});

test("toggl autocomplete waits for an explicit description token", () => {
  const suggestions = listCommandSuggestions("toggl start ", fakeStorageWithCache());
  assert.deepEqual(suggestions, []);
});

test("toggl autocomplete completes after an opening quote and adds a trailing space", () => {
  const suggestions = listCommandSuggestions('toggl start "', fakeStorageWithCache());
  assert.equal(suggestions[0]?.usage, '"O Nome do Vento"');
  assert.equal(applyCommandAutocomplete('toggl start "', suggestions[0]), 'toggl start "O Nome do Vento" ');
});

test("toggl autocomplete treats --project without a value as project completion", () => {
  const suggestions = listCommandSuggestions('toggl start "O Nome do Vento" --project', fakeStorageWithCache());
  assert.equal(suggestions[0]?.usage, '"Reading books"');
  assert.equal(applyCommandAutocomplete('toggl start "O Nome do Vento" --project', suggestions[0]), 'toggl start "O Nome do Vento" --project "Reading books"');
});

test("toggl autocomplete matches projects by partial client text", () => {
  const suggestions = listCommandSuggestions('toggl start "O Nome do Vento" --project Pers', fakeStorageWithCache());
  assert.equal(suggestions[0]?.usage, '"Reading books"');
});

test("running Toggl timer is formatted for the footer", () => {
  const storage = new FakeStorage();
  storage.setRawSetting("togglCurrentEntry", JSON.stringify({ description: "O Nome do Vento", start: "2026-06-30T12:00:00.000Z" }));
  assert.equal(formatRunningTogglTimer(storage as unknown as Storage, new Date("2026-06-30T12:42:00.000Z")), "Toggl 42m · O Nome do Vento");
});
