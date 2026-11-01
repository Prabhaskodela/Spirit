import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const read = (path) => readFileSync(path, "utf8");
const app = read("app.js");
const schema = read("schema.sql");

function inspectHtml(path, rootPrefix = "/Spirit/") {
  const html = read(path);
  const ids = [...html.matchAll(/\b id=["']([^"']+)["']/g)].map((match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicates, [], `${path} has duplicate element IDs`);

  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const value = match[1];
    if (/^(?:https?:|data:|#|mailto:|tel:|javascript:)/i.test(value)) continue;
    const withoutQuery = value.split(/[?#]/)[0];
    const localPath = withoutQuery.startsWith(rootPrefix)
      ? withoutQuery.slice(rootPrefix.length)
      : resolve(dirname(path), withoutQuery);
    const normalized = localPath.startsWith(".") ? resolve(localPath) : localPath;
    assert.ok(existsSync(normalized), `${path} references missing local asset: ${value}`);
  }
  return new Set(ids);
}

const rootIds = inspectHtml("index.html");
const hubIds = inspectHtml("hub/index.html");
assert.deepEqual([...hubIds].sort(), [...rootIds].sort(), "root and installed-app HTML must expose the same controls");

const generatedIds = new Set([
  "subject-message-list",
  "subject-reply-label",
  "subject-reply-context",
  "subject-chat-input",
  "subject-chat-attachment",
  "current-files"
]);
const staticSelectors = [...app.matchAll(/\$\(["']#([a-zA-Z0-9_-]+)["']\)/g)].map((match) => match[1]);
const missing = [...new Set(staticSelectors.filter((id) => !rootIds.has(id) && !generatedIds.has(id)))];
assert.deepEqual(missing, [], "app.js references IDs that are absent from both page templates");

JSON.parse(read("manifest.json"));
JSON.parse(read("hub/manifest.json"));
assert.equal((schema.match(/create trigger .*_room_quota before insert on public\./gi) || []).length, 3, "schema must define one quota trigger for each room upload table");
assert.match(schema, /create trigger messages_room_quota before insert on public\.messages/i);
assert.match(schema, /create trigger subject_files_room_quota before insert on public\.subject_files/i);
assert.match(schema, /create trigger memories_room_quota before insert on public\.memories/i);
assert.match(schema, /storage\.objects[\s\S]*spirit-files[\s\S]*spirit-memories/i);
assert.match(app, /createSignedUrl/);
assert.match(app, /roomSelectionVersion/);
assert.match(app, /file_size: file\.size/);
console.log("SpiritHUB static validation passed.");
