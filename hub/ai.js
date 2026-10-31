// Local-AI summaries for SpiritHUB: each student's own Ollama, called straight from their browser.
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
const SETTINGS_KEY = "spirithub-hub:ai";
export const AI_DEFAULTS = { url: "http://localhost:11434", model: "qwen3.5:4b" };
const MAX_IMAGE_EDGE = 1280; // keeps one image to roughly 1.5k vision tokens
const MAX_SCANNED_PAGES = 4;
const MAX_PARTS = 8;
const SYSTEM = "You are SpiritHUB's study assistant for Kalvium students. Write clear, accurate, compact study notes in Markdown. Use only what is in the material you are given. If part of it is unreadable or missing, say so instead of guessing.";
const SUMMARY_FORMAT = `Use exactly this format:
**In short:** 2–3 sentences on what it covers.

#### Key points
- 4–8 bullets with the important ideas, in the order they appear

#### Worth remembering
- definitions, rules, commands or code patterns, with code in backticks (leave this section out if there are none)`;
const IMAGE_FORMAT = `Use exactly this format:
**What it shows:** 1–2 sentences.

#### Key points
- the important text, ideas or instructions in it

#### Code notes
- only if there is code: what it does, any bug or error you can see, and how to fix it (leave this section out if there is no code)`;

export const aiSettings = {
  load() {
    try {
      return { ...AI_DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) };
    } catch {
      return { ...AI_DEFAULTS };
    }
  },
  save(settings) {
    const clean = { url: (settings.url || AI_DEFAULTS.url).replace(/\/+$/, ""), model: settings.model || AI_DEFAULTS.model };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(clean));
    } catch {
      // Private mode: the settings last until the tab closes.
    }
    return clean;
  },
};

// Ollama answers only pages it trusts, so a blocked origin looks the same as Ollama not running.
export async function checkAi({ url, model }) {
  const base = url.replace(/\/+$/, "");
  try {
    const { version } = await (await fetch(`${base}/api/version`)).json();
    const show = await fetch(`${base}/api/show`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model }) });
    if (show.status === 404) return { ok: false, reason: "missing-model", model };
    if (!show.ok) return { ok: false, reason: "error", message: `Ollama answered ${show.status}.` };
    const capabilities = (await show.json()).capabilities || [];
    const ps = await fetch(`${base}/api/ps`).then((response) => response.json()).catch(() => ({}));
    const loaded = ps.models?.find((entry) => entry.name === model || entry.model === model);
    return {
      ok: true,
      version,
      model,
      vision: capabilities.includes("vision"),
      thinking: capabilities.includes("thinking"),
      contextLength: loaded?.context_length || 4096,
    };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

/* ---------- Markdown (model output is escaped before any formatting is applied) ---------- */

const escapeHtml = (text) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

function inline(text) {
  return text.split(/(`[^`\n]+`)/).map((part, index) => index % 2
    ? `<code>${escapeHtml(part.slice(1, -1))}</code>`
    : escapeHtml(part).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[\s(])\*(\S(?:.*?\S)?)\*(?=[\s).,:;!?]|$)/g, "$1<em>$2</em>"),
  ).join("");
}

export function markdown(source) {
  const html = [];
  let list = null;
  let table = false;
  let code = null;
  const closeBlocks = () => {
    if (list) html.push(`</${list}>`);
    if (table) html.push("</table>");
    list = null;
    table = false;
  };
  for (const line of source.replace(/\r/g, "").split("\n")) {
    if (code) {
      if (/^\s*```/.test(line)) {
        html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = null;
      } else code.push(line);
      continue;
    }
    if (/^\s*```/.test(line)) {
      closeBlocks();
      code = [];
      continue;
    }
    const row = line.match(/^\s*\|(.*)\|\s*$/);
    const heading = line.match(/^\s*#{1,6}\s+(.*)$/);
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (row) {
      if (/^[\s|:-]+$/.test(row[1])) continue; // the |---|---| line under a table header
      if (!table) {
        closeBlocks();
        html.push("<table>");
        table = true;
      }
      html.push(`<tr>${row[1].split("|").map((cell) => `<td>${inline(cell.trim())}</td>`).join("")}</tr>`);
    } else if (heading) {
      closeBlocks();
      html.push(`<h4>${inline(heading[1])}</h4>`);
    } else if (bullet || numbered) {
      const type = bullet ? "ul" : "ol";
      if (list !== type) {
        closeBlocks();
        html.push(`<${type}>`);
        list = type;
      }
      html.push(`<li>${inline((bullet || numbered)[1])}</li>`);
    } else if (line.trim()) {
      closeBlocks();
      html.push(`<p>${inline(line.trim())}</p>`);
    } else if (!table) closeBlocks(); // models often leave blank lines between table rows
  }
  if (code) html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`); // still streaming in
  closeBlocks();
  return html.join("");
}

/* ---------- Talking to Ollama ---------- */

async function chat({ settings, caps, signal, onText }, messages, maxTokens) {
  const response = await fetch(`${settings.url}/api/chat`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: settings.model,
      messages,
      stream: true,
      keep_alive: "30m",
      ...(caps.thinking ? { think: false } : {}),
      options: { temperature: 0.7, top_p: 0.8, num_predict: maxTokens },
    }),
  });
  if (!response.ok) throw new Error(`Ollama answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let text = "";
  const take = (line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.error) throw new Error(event.error);
    if (event.message?.content) {
      text += event.message.content;
      onText?.(text);
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop();
    lines.forEach(take);
  }
  take(buffer);
  if (!text.trim()) throw new Error("The model returned an empty answer. Try again.");
  return text.trim();
}

/* ---------- Reading files ---------- */

let pdfjsPromise;
function loadPdfJs() {
  pdfjsPromise ||= import(PDFJS).then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    return pdfjs;
  });
  return pdfjsPromise;
}

function toBase64(source, width, height) {
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff"; // transparent PNGs would otherwise turn black as JPEG
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.9).split(",")[1];
}

async function readPdf(file) {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const content = await (await pdf.getPage(number)).getTextContent();
    pages.push(content.items.map((part) => (part.str || "") + (part.hasEOL ? "\n" : " ")).join("").replace(/[ \t]+/g, " ").trim());
  }
  const text = pages.join("\n\n").trim();
  if (text.replace(/\s/g, "").length >= 40 * Math.min(pdf.numPages, 3)) return { text };
  // No text layer (a scanned PDF), so the vision model reads the first pages as images instead.
  const images = [];
  for (let number = 1; number <= Math.min(pdf.numPages, MAX_SCANNED_PAGES); number += 1) {
    const page = await pdf.getPage(number);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2, MAX_IMAGE_EDGE / Math.max(base.width, base.height)) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    images.push(toBase64(canvas, canvas.width, canvas.height));
  }
  return { images };
}

async function readImage(file) {
  const bitmap = await createImageBitmap(file);
  const image = toBase64(bitmap, bitmap.width, bitmap.height);
  bitmap.close();
  return { images: [image] };
}

/* ---------- Summaries ---------- */

function splitText(text, size) {
  const parts = [];
  let rest = text.trim();
  while (rest.length > size) {
    let cut = rest.lastIndexOf("\n", size);
    if (cut < size * 0.6) cut = rest.lastIndexOf(" ", size);
    if (cut < size * 0.6) cut = size;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

const userMessage = (content, images) => ({ role: "user", content, ...(images?.length ? { images } : {}) });
// How much text fits in one request, from the model's context window (~3.2 characters per token, with room for the answer).
export const textBudget = (caps) => Math.max(4000, Math.floor(((caps.contextLength || 4096) - 1300) * 3.2));

// A file's text (or, for images and scanned PDFs, its pictures) for the Ask AI chat.
export function readForAi(file) {
  return file.type === "application/pdf" ? readPdf(file) : readImage(file);
}

// A free-form question with whatever context the caller put in messages. options: { settings, caps, signal, onText }
export function askLocalAi(options, messages) {
  return chat(options, messages, 900);
}

async function notesThenMerge(name, inputs, describe, options) {
  const notes = [];
  for (const [index, input] of inputs.entries()) {
    options.onStatus(`${describe} ${index + 1} of ${inputs.length}…`);
    notes.push(await chat({ ...options, onText: null }, [{ role: "system", content: SYSTEM }, input], 250));
  }
  options.onStatus("Combining the notes…");
  const merged = notes.map((note, index) => `Part ${index + 1}:\n${note}`).join("\n\n");
  return chat(options, [{ role: "system", content: SYSTEM }, userMessage(`Here are notes from each part of "${name}", in order:\n\n${merged}\n\nCombine them into one summary of the whole document.\n\n${SUMMARY_FORMAT}`)], 700);
}

// options: { settings, caps, signal, onStatus(text), onText(markdownSoFar) }
export async function summarizeFile(file, options) {
  options.onStatus("Reading the file…");
  const content = file.type === "application/pdf" ? await readPdf(file) : await readImage(file);
  options.onStatus("Summarizing…");
  if (content.text) {
    const parts = splitText(content.text, textBudget(options.caps));
    if (parts.length === 1) {
      return chat(options, [{ role: "system", content: SYSTEM }, userMessage(`Summarize this study material from "${file.name}".\n\n${SUMMARY_FORMAT}\n\nMaterial:\n"""\n${parts[0]}\n"""`)], 700);
    }
    const used = parts.slice(0, MAX_PARTS);
    const inputs = used.map((part, index) => userMessage(`Part ${index + 1} of ${used.length} of "${file.name}":\n"""\n${part}\n"""\n\nWrite 3–6 short bullet notes on the key ideas, definitions and code in this part. No intro.`));
    const summary = await notesThenMerge(file.name, inputs, "Reading part", options);
    return parts.length > MAX_PARTS ? `${summary}\n\n*This covers the first ${MAX_PARTS} of ${parts.length} parts of the PDF.*` : summary;
  }
  if (!options.caps.vision) throw new Error(`${options.settings.model} can't read images. Use a vision model such as qwen3.5:4b.`);
  if (content.images.length === 1) {
    const what = file.type === "application/pdf" ? `a scanned page from "${file.name}"` : `a screenshot a student shared ("${file.name}")`;
    return chat(options, [{ role: "system", content: SYSTEM }, userMessage(`This is ${what}. Summarize what it shows.\n\n${IMAGE_FORMAT}`, content.images)], 700);
  }
  const inputs = content.images.map((image, index) => userMessage(`This is page ${index + 1} of the scanned PDF "${file.name}". Write 3–6 short bullet notes on what it says. No intro.`, [image]));
  return notesThenMerge(file.name, inputs, "Reading page", options);
}
