import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const SPIRIT_AI_MAX_FILE_BYTES = 4 * 1024 * 1024;
const SPIRIT_AI_FILE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

async function encodeFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export async function askSpiritAi(client, { workspaceId, prompt, history = [], file = null, signal }) {
  if (!client) throw new Error("Spirit AI isn't connected to this project yet.");
  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.access_token) throw new Error("Sign in again to use Spirit AI.");
  if (file && !SPIRIT_AI_FILE_TYPES.has(file.type)) throw new Error("Attach a PDF, PNG, JPEG, or WebP file.");
  if (file && file.size > SPIRIT_AI_MAX_FILE_BYTES) throw new Error("Spirit AI accepts files up to 4 MB for now.");

  const attachment = file ? {
    name: file.name,
    mime: file.type,
    data: await encodeFile(file),
  } : null;
  const response = await fetch(SUPABASE_URL + "/functions/v1/spirit-ai", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + data.session.access_token,
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ workspaceId, prompt, history, attachment }),
    signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 429) throw new Error("The free Spirit AI limit is reached. Try again after the limit resets.");
    throw new Error(payload.error || "Spirit AI couldn't answer right now.");
  }
  if (typeof payload.text !== "string" || !payload.text.trim()) throw new Error("Spirit AI returned an empty answer. Please try again.");
  return payload.text;
}
