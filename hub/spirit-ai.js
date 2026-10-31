import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const SPIRIT_AI_MAX_FILE_BYTES = 4 * 1024 * 1024;
const SPIRIT_AI_FILE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

export function spiritAiMimeType(file) {
  const declared = String(file?.type || "").toLowerCase().split(";")[0].trim();
  if (SPIRIT_AI_FILE_TYPES.has(declared)) return declared;
  if (declared) return "";
  const extension = String(file?.name || "").toLowerCase().split(".").pop();
  return ({
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
  })[extension] || "";
}

function readFileAsBase64(file, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    reader.onerror = () => reject(new Error("Spirit AI couldn't read this file. Try choosing it again."));
    reader.onabort = () => reject(new Error("File reading was interrupted. Try again."));
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      if (comma < 0) return reject(new Error("Spirit AI couldn't prepare this file. Try again."));
      resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

function postWithProgress(url, accessToken, payload, signal, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => {
      request.abort();
      finish(reject, new Error("Spirit AI request was cancelled."));
    };
    if (signal?.aborted) return onAbort();

    request.open("POST", url);
    request.setRequestHeader("Authorization", "Bearer " + accessToken);
    request.setRequestHeader("apikey", SUPABASE_ANON_KEY);
    request.setRequestHeader("Content-Type", "application/json");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    request.onerror = () => finish(reject, new Error("Couldn't upload the file. Check your connection and try again."));
    request.onabort = () => finish(reject, new Error("Spirit AI request was cancelled."));
    request.onload = () => {
      let body = {};
      try { body = JSON.parse(request.responseText || "{}"); } catch {}
      if (request.status < 200 || request.status >= 300) {
        if (request.status === 429) return finish(reject, new Error("The free Spirit AI limit is reached. Try again after the limit resets."));
        return finish(reject, new Error(body.error || "Spirit AI couldn't answer right now."));
      }
      if (typeof body.text !== "string" || !body.text.trim()) {
        return finish(reject, new Error("Spirit AI returned an empty answer. Please try again."));
      }
      finish(resolve, body.text);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      request.send(JSON.stringify(payload));
    } catch {
      finish(reject, new Error("Couldn't upload the file. Check your connection and try again."));
    }
  });
}

export async function askSpiritAi(client, { workspaceId, prompt, history = [], file = null, signal, onProgress }) {
  if (!client) throw new Error("Spirit AI isn't connected to this project yet.");
  const { data, error } = await client.auth.getSession();
  if (error || !data.session?.access_token) throw new Error("Sign in again to use Spirit AI.");
  let attachment = null;
  if (file) {
    const mime = spiritAiMimeType(file);
    if (!mime) throw new Error("Attach a PDF, PNG, JPEG, or WebP file.");
    if (!file.size) throw new Error("This file is empty. Choose another file.");
    if (file.size > SPIRIT_AI_MAX_FILE_BYTES) throw new Error("Spirit AI accepts files up to 4 MB for now.");
    onProgress?.({ stage: "preparing", percent: 0 });
    const encoded = await readFileAsBase64(file, (percent) =>
      onProgress?.({ stage: "preparing", percent: Math.round(percent * 100) }));
    attachment = { name: file.name, mime, data: encoded };
  }
  onProgress?.({ stage: "uploading", percent: 0 });
  return postWithProgress(
    SUPABASE_URL + "/functions/v1/spirit-ai",
    data.session.access_token,
    { workspaceId, prompt, history, attachment },
    signal,
    (percent) => onProgress?.({ stage: "uploading", percent: Math.round(percent * 100) }),
  ).then((text) => {
    onProgress?.({ stage: "processing", percent: 100 });
    return text;
  });
}
