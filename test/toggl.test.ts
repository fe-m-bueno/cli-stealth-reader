import test from "node:test";
import assert from "node:assert/strict";
import { parseSlashCommand, listCommandSuggestions, applyCommandAutocomplete } from "../src/commands.js";
import { formatRunningTogglTimer, formatTogglRecents, resolveTogglProject } from "../src/toggl.js";
import type { Storage } from "../src/storage.js";

class FakeStorage {
  private settings = new Map<string, string>();
  getSetting(key: string): string | null { return this.settings.get(key) ?? null; }
  setRawSetting(key: string, value: string): void { this.settings.set(key, value); }
}

function fakeStorageWithCache(): Storage {
  const storage = new FakeStorage();
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

test("toggl autocomplete completes recent descriptions inside quotes", () => {
  const suggestions = listCommandSuggestions('toggl start "O', fakeStorageWithCache());
  assert.equal(suggestions[0]?.usage, '"O Nome do Vento"');
  assert.equal(applyCommandAutocomplete('toggl start "O', suggestions[0]), 'toggl start "O Nome do Vento" ');
});

test("toggl autocomplete completes project flag values", () => {
  const suggestions = listCommandSuggestions('toggl start "O Nome do Vento" --project Read', fakeStorageWithCache());
  assert.equal(suggestions[0]?.usage, '"Reading books"');
  assert.equal(applyCommandAutocomplete('toggl start "O Nome do Vento" --project Read', suggestions[0]), 'toggl start "O Nome do Vento" --project "Reading books"');
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
