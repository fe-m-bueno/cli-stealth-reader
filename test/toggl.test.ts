import test from "node:test";
import assert from "node:assert/strict";
import { parseSlashCommand, listCommandSuggestions, applyCommandAutocomplete, commandContextHelp } from "../src/commands.js";
import { TOGGL_REFRESH_INTERVAL_MS, connectToggl, extractTogglOrganizationId, formatRunningTogglTimer, formatTogglRecents, getTogglCache, getTogglQuota, logTogglEntry, refreshCurrentTogglEntry, resolveTogglProject, startTogglEntry, stopTogglEntry, syncToggl } from "../src/toggl.js";
import { executeCommand } from "../src/executor.js";
import type { Storage } from "../src/storage.js";
import type { AppState } from "../src/types.js";

class FakeStorage {
  private settings = new Map<string, string>();
  getSetting(key: string): string | null { return this.settings.get(key) ?? null; }
  setRawSetting(key: string, value: string): void { this.settings.set(key, value); }
  saveCommandHistory(): void {}
}

function fakeStorageWithCache(): Storage {
  const storage = new FakeStorage();
  storage.setRawSetting("togglApiToken", "test-token");
  storage.setRawSetting("togglCache", JSON.stringify({
    defaultOrganizationId: 7,
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

test("starting a Toggl timer uses Focus tracking with Bearer auth", async (t) => {
  const requests: Array<{ url: string; method: string; authorization: string; body: Record<string, unknown> }> = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      authorization: String((init?.headers as Record<string, string> | undefined)?.Authorization ?? ""),
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

  assert.equal(requests[0]?.url, "https://focus.toggl.com/api/organizations/7/workspaces/1/tracking/start");
  assert.equal(requests[0]?.method, "POST");
  assert.equal(requests[0]?.authorization, "Bearer test-token");
  assert.equal(requests[0]?.body.project_id, 10);
  assert.equal(requests[0]?.body.type, "activity");
  assert.equal(typeof requests[0]?.body.start, "string");
  assert.equal(requests[0]?.body.created_with, undefined);
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

test("logging completed Toggl time uses the Focus taskless time-entry payload", async (t) => {
  let url = "";
  let method = "";
  let body: Record<string, unknown> | undefined;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    url = String(input);
    method = init?.method ?? "GET";
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ id: 43, workspace_id: 1, duration: 1500 }), {
      status: 201,
      headers: { "Content-Type": "application/json" }
    });
  });

  await logTogglEntry(fakeStorageWithCache(), "Choujin X", "25m", "Reading manga");

  assert.equal(url, "https://focus.toggl.com/api/organizations/7/workspaces/1/time-entries");
  assert.equal(method, "POST");
  assert.equal(body?.project_id, 11);
  assert.equal(body?.duration, 1500);
  assert.equal(body?.type, "activity");
  assert.equal(typeof body?.start, "string");
  assert.equal(typeof body?.tracked_at, "string");
  assert.equal(body?.stop, undefined);
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
    /authentication failed \(401\).*toggl_sk_/i
  );

  assert.equal(storage.getSetting("togglApiToken"), null);
});

test("successful Toggl authentication uses a Focus Bearer key before persisting", async (t) => {
  const storage = new FakeStorage();
  let authorization = "";
  t.mock.method(globalThis, "fetch", async (_input: string | URL | Request, init?: RequestInit) => {
    authorization = String((init?.headers as Record<string, string> | undefined)?.Authorization ?? "");
    return new Response(JSON.stringify({ current_workspace_id: 1, current_organization_id: 7, theme: "dark" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  });

  const result = await connectToggl(storage as unknown as Storage, "toggl_sk_valid");

  assert.equal(authorization, "Bearer toggl_sk_valid");
  assert.equal(storage.getSetting("togglApiToken"), "toggl_sk_valid");
  assert.equal(result.defaultWorkspaceId, 1);
  assert.equal(result.defaultOrganizationId, 7);
});

test("Toggl authentication automatically uses an explicit organization returned by Focus", async (t) => {
  const storage = new FakeStorage();
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    current_workspace_id: 1,
    current_organization_id: 7,
    theme: "dark"
  }), { status: 200, headers: { "Content-Type": "application/json" } }));

  const result = await connectToggl(storage as unknown as Storage, "toggl_sk_valid");

  assert.equal(result.defaultOrganizationId, 7);
});

test("authenticating a different Toggl key never inherits the previous account scope", async (t) => {
  const storage = fakeStorageWithCache() as unknown as FakeStorage;
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    current_workspace_id: 2,
    theme: "dark"
  }), { status: 200, headers: { "Content-Type": "application/json" } }));

  const result = await connectToggl(storage as unknown as Storage, "toggl_sk_different");

  assert.equal(result.defaultOrganizationId, null);
  assert.equal(result.defaultWorkspaceId, 2);
  assert.deepEqual(getTogglCache(storage as unknown as Storage).projects, []);
});

test("Toggl auth opens a guided organization prompt when Focus cannot return the id", async (t) => {
  const storage = new FakeStorage();
  const state = {
    storage,
    focusMode: false,
    currentBook: null,
    commandMode: false,
    commandBuffer: "",
    commandCursor: 0,
    commandSuggestionIndex: 0,
    status: "Ready"
  } as unknown as AppState;
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    current_workspace_id: 1,
    theme: "dark"
  }), { status: 200, headers: { "Content-Type": "application/json" } }));

  await executeCommand(state, "/toggl auth toggl_sk_valid");

  assert.equal(state.commandMode, true);
  assert.equal(state.commandBuffer, "toggl setup ");
  assert.equal(state.commandCursor, state.commandBuffer.length);
  assert.match(state.status, /paste.*Focus workspace URL/i);
});

test("Toggl setup accepts the compact Focus URL and syncs its workspace", async (t) => {
  const storage = new FakeStorage();
  storage.setRawSetting("togglApiToken", "toggl_sk_valid");
  storage.setRawSetting("togglCache", JSON.stringify({
    defaultOrganizationId: null,
    defaultWorkspaceId: 999,
    projects: [],
    descriptions: [],
    syncedAt: null
  }));
  const state = {
    storage,
    focusMode: false,
    currentBook: null,
    commandMode: false,
    commandBuffer: "",
    commandCursor: 0,
    commandSuggestionIndex: 0,
    status: "Ready"
  } as unknown as AppState;
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith("/tracking/current")) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ data: [], page: 1, per_page: 25 }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  });

  await executeCommand(state, "/toggl setup https://focus.toggl.com/123456/workspaces/789012/");

  assert.equal(getTogglCache(storage as unknown as Storage).defaultOrganizationId, 123456);
  assert.equal(getTogglCache(storage as unknown as Storage).defaultWorkspaceId, 789012);
  assert.ok(requests.some((url) => url.includes("/api/organizations/123456/workspaces/789012/projects?")));
  assert.ok(requests.some((url) => url.includes("/api/organizations/123456/workspaces/789012/time-entries?")));
  assert.ok(requests.some((url) => url.endsWith("/api/organizations/123456/workspaces/789012/tracking/current")));
  assert.match(state.status, /connected Toggl 2\.0/i);
});

test("Toggl setup keeps the guided prompt open when the URL is missing", async () => {
  const storage = new FakeStorage();
  const state = {
    storage,
    focusMode: false,
    currentBook: null,
    commandMode: false,
    commandBuffer: "",
    commandCursor: 0,
    commandSuggestionIndex: 0,
    status: "Ready"
  } as unknown as AppState;

  await executeCommand(state, "/toggl setup");

  assert.equal(state.commandMode, true);
  assert.equal(state.commandBuffer, "toggl setup ");
  assert.match(state.status, /paste.*workspace URL/i);
});

test("Toggl setup stays saved when the first sync is blocked by quota", async (t) => {
  const storage = new FakeStorage();
  storage.setRawSetting("togglApiToken", "toggl_sk_valid");
  storage.setRawSetting("togglCache", JSON.stringify({
    defaultOrganizationId: null,
    defaultWorkspaceId: 1,
    projects: [],
    descriptions: [],
    syncedAt: null
  }));
  const state = {
    storage,
    focusMode: false,
    currentBook: null,
    commandMode: false,
    commandBuffer: "",
    commandCursor: 0,
    commandSuggestionIndex: 0,
    status: "Ready"
  } as unknown as AppState;
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: "quota_exhausted" }), {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      "X-Toggl-Quota-Remaining": "0",
      "X-Toggl-Quota-Resets-In": "60"
    }
  }));

  await executeCommand(state, "/toggl setup 7");

  assert.equal(getTogglCache(storage as unknown as Storage).defaultOrganizationId, 7);
  assert.equal(state.commandMode, false);
  assert.match(state.status, /organization saved.*quota exhausted/i);
});

test("Toggl setup accepts an organization id or extracts it from a Focus URL", () => {
  assert.equal(extractTogglOrganizationId("123456"), 123456);
  assert.equal(extractTogglOrganizationId("https://focus.toggl.com/organizations/123456/workspaces/42"), 123456);
  assert.equal(extractTogglOrganizationId("https://focus.toggl.com/timer?organization_id=123456&workspace_id=42"), 123456);
  assert.throws(
    () => extractTogglOrganizationId("https://focus.toggl.com/workspaces/42"),
    /organization/i
  );
});

test("Toggl sync reconciles the account's current running timer", async (t) => {
  const storage = fakeStorageWithCache();
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    const payload = url.endsWith("/tracking/current")
      ? { id: 99, workspace_id: 1, description: "External timer", start: "2026-06-30T12:00:00.000Z", stop: null, duration: -1 }
      : url.includes("/time-entries?")
        ? { data: [], page: 1, per_page: 25 }
        : { data: [], page: 1, per_page: 200 };
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

test("Toggl sync fetches every project page using the API page-size limit", async (t) => {
  const storage = fakeStorageWithCache();
  const projectPages: number[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/projects")) {
      const page = Number(url.searchParams.get("page"));
      const perPage = Number(url.searchParams.get("per_page"));
      if (perPage > 100) {
        return Response.json({ error: "validation" }, { status: 400 });
      }
      projectPages.push(page);
      const start = (page - 1) * 100 + 1;
      const count = page < 3 ? 100 : 1;
      return Response.json({
        data: Array.from({ length: count }, (_, index) => ({
          id: start + index,
          workspace_id: 1,
          name: `Project ${start + index}`,
          active: true
        })),
        page,
        per_page: 100,
        total: 201
      });
    }
    if (url.pathname.endsWith("/time-entries")) {
      return Response.json({ data: [], page: 1, per_page: 25, total: 0 });
    }
    return Response.json(null);
  });

  const cache = await syncToggl(storage);

  assert.deepEqual(projectPages, [1, 2, 3]);
  assert.equal(cache.projects.length, 201);
  assert.equal(cache.projects.some((project) => project.id === 201), true);
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

test("stopping a Toggl timer uses the Focus tracking stop endpoint", async (t) => {
  const storage = fakeStorageWithCache();
  const requests: Array<{ url: string; method: string }> = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? "GET" });
    const payload = { id: 99, workspace_id: 1, description: "Reading", start: "2026-06-30T12:00:00.000Z", stop: "2026-06-30T12:42:00.000Z" };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  });

  await stopTogglEntry(storage);

  assert.deepEqual(requests, [
    { url: "https://focus.toggl.com/api/organizations/7/workspaces/1/tracking/stop", method: "POST" }
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

  const setup = listCommandSuggestions("toggl set", fakeStorageWithCache());
  assert.equal(setup[0]?.usage, "setup");
});

test("toggl flag autocomplete only suggests flags valid for the active action", () => {
  const rootFlags = listCommandSuggestions("toggl --", fakeStorageWithCache());
  assert.deepEqual(rootFlags.map((item) => item.usage), ["--disconnect"]);

  const startFlags = listCommandSuggestions("toggl start --", fakeStorageWithCache());
  assert.deepEqual(startFlags.map((item) => item.usage), ["--project"]);
  assert.equal(applyCommandAutocomplete("toggl start --", startFlags[0]), "toggl start --project ");

  const projectValues = listCommandSuggestions("toggl start --project ", fakeStorageWithCache());
  assert.ok(projectValues.some((item) => item.usage === '"Reading books"'));
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

test("Toggl quota headers are persisted and explain a 402 reset", async (t) => {
  const storage = fakeStorageWithCache();
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: "quota_exhausted" }), {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      "X-Toggl-Quota-Remaining": "0",
      "X-Toggl-Quota-Resets-In": "125"
    }
  }));

  await assert.rejects(syncToggl(storage), /quota exhausted.*2m 5s/i);
  assert.deepEqual(getTogglQuota(storage), {
    remaining: 0,
    resetsInSeconds: 125,
    observedAt: getTogglQuota(storage)?.observedAt
  });
});

test("recognized Toggl commands show contextual next-step help", () => {
  const authHelp = commandContextHelp("toggl auth", fakeStorageWithCache());
  assert.ok(authHelp.some((line) => line.includes("toggl_sk_")));
  assert.ok(authHelp.every((line) => !line.includes("--organization")));
  assert.ok(authHelp.some((line) => line.includes("focus.toggl.com/settings")));

  const setupHelp = commandContextHelp("toggl setup", fakeStorageWithCache());
  assert.ok(setupHelp.some((line) => line.includes("workspace URL")));

  const startHelp = commandContextHelp("toggl start ", fakeStorageWithCache());
  assert.ok(startHelp.some((line) => line.includes("<description>")));
  assert.ok(startHelp.some((line) => line.includes("Tab")));
});

test("background Toggl polling interval stays well under the Free-plan quota (30 req/h)", () => {
  // 30 req/h quota → background polling must use at most half of it,
  // leaving headroom for user-initiated commands.
  assert.ok(TOGGL_REFRESH_INTERVAL_MS >= 240_000, `interval ${TOGGL_REFRESH_INTERVAL_MS}ms allows more than 15 req/h`);
});
