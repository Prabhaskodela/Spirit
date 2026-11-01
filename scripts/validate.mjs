import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const read = (path) => readFileSync(path, "utf8");
const app = read("app.js");
const schema = read("supabase/schema.sql");

function inspectHtml(path) {
  const html = read(path);
  const ids = [...html.matchAll(/\\bid=["']([^"']+)["']/g)].map((match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicates, [], path + " has duplicate element IDs");

  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const value = match[1];
    if (/^(?:https?:|data:|#|mailto:|tel:|javascript:)/i.test(value)) continue;
    const withoutQuery = value.split(/[?#]/)[0];
    const localPath = withoutQuery.startsWith("/")
      ? withoutQuery.replace(/^\\/+/, "")
      : resolve(dirname(path), withoutQuery);
    assert.ok(existsSync(localPath), path + " references missing local asset: " + value);
  }
  return { html, ids: new Set(ids) };
}

const { html, ids } = inspectHtml("index.html");
const staticSelectors = [...app.matchAll(/\\$\\(["']#([a-zA-Z0-9_-]+)["']\\)/g)].map((match) => match[1]);
const generatedIds = new Set(["message-list", "file-list", "channel-list", "workspace-list"]);
const missing = [...new Set(staticSelectors.filter((id) => !ids.has(id) && !generatedIds.has(id)))];
assert.deepEqual(missing, [], "app.js references IDs absent from the root page");

const redirect = read("hub/index.html");
assert.match(redirect, /location\\.replace\\(destination\\.href\\)/, "legacy /hub/ URL must redirect to the root app");
assert.match(redirect, /destination\\.search = location\\.search/, "legacy redirect must preserve query parameters");
JSON.parse(read("manifest.json"));
assert.match(html, /Spirited Workspace/);
assert.match(html, /spirited-workspace-logo|assets\\/icons/);
for (const table of ["hub_profiles", "hub_workspaces", "hub_members", "hub_channels", "hub_files", "hub_messages"]) {
  assert.match(schema, new RegExp("create table(?: if not exists)? public\\." + table + "\\b", "i"), "schema must define public." + table);
}
assert.match(schema, /enable row level security/i, "workspace schema must enable row-level security");
assert.match(app, /createSignedUrl/);
console.log("Spirited Workspace static validation passed.");
