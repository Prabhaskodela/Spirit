const allowedOrigins = new Set([
  "https://prabhaskodela.github.io",
  "http://localhost:8790",
  "http://127.0.0.1:8790",
]);
const allowedMimeTypes = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
const maxFileBytes = 4 * 1024 * 1024;
const maxEncodedBytes = Math.ceil(maxFileBytes * 4 / 3) + 8;
const model = "gemini-3.5-flash-lite";
const systemInstruction = [
  "You are Spirit AI, a clear study and coding helper.",
  "Explain solutions in understandable steps and provide correct Python code when a question asks for code.",
  "For screenshots and PDFs, read the visible problem carefully. If text or details are unreadable, say what is unclear and ask for a clearer upload instead of guessing.",
  "When useful, show the final answer first, then a short explanation. Format code in fenced code blocks.",
].join(" ");

function response(req, body, status = 200) {
  const origin = req.headers.get("origin") || "";
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  });
  if (origin && allowedOrigins.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  }
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

function publishableKey() {
  const legacy = Deno.env.get("SUPABASE_ANON_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    return keys.default || "";
  } catch {
    return "";
  }
}

function validBase64(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maxEncodedBytes
    && value.length % 4 === 0
    && /^[A-Za-z0-9+/]*={0,2}$/.test(value);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  if (origin && !allowedOrigins.has(origin)) return response(req, { error: "This site isn't allowed to use Spirit AI." }, 403);
  if (req.method === "OPTIONS") return response(req, {}, 204);
  if (req.method !== "POST") return response(req, { error: "Use POST to ask Spirit AI." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseKey = publishableKey();
  const geminiKey = Deno.env.get("GEMINI_API_KEY") || "";
  if (!supabaseUrl || !supabaseKey) return response(req, { error: "Spirit AI's secure room access isn't configured yet." }, 503);
  if (!geminiKey) return response(req, { error: "Spirit AI hasn't been connected to its free AI service yet." }, 503);

  const authorization = req.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return response(req, { error: "Sign in to use Spirit AI." }, 401);
  const authHeaders = { apikey: supabaseKey, authorization };
  let userResponse;
  try {
    userResponse = await fetch(supabaseUrl + "/auth/v1/user", { headers: authHeaders });
  } catch {
    return response(req, { error: "Couldn't verify your Spirited Workspace account. Try again." }, 503);
  }
  if (!userResponse.ok) return response(req, { error: "Your sign-in expired. Sign in again to use Spirit AI." }, 401);
  const user = await userResponse.json().catch(() => null);
  if (!user?.id) return response(req, { error: "Couldn't verify your Spirited Workspace account." }, 401);

  let body;
  try {
    body = await req.json();
  } catch {
    return response(req, { error: "Spirit AI received an invalid request." }, 400);
  }
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) return response(req, { error: "Choose a workspace before asking Spirit AI." }, 400);
  if (!prompt || prompt.length > 4000) return response(req, { error: "Write a question of up to 4,000 characters." }, 400);

  const membershipUrl = new URL(supabaseUrl + "/rest/v1/hub_members");
  membershipUrl.searchParams.set("workspace_id", "eq." + workspaceId);
  membershipUrl.searchParams.set("user_id", "eq." + user.id);
  membershipUrl.searchParams.set("select", "workspace_id");
  let membershipResponse;
  try {
    membershipResponse = await fetch(membershipUrl, { headers: authHeaders });
  } catch {
    return response(req, { error: "Couldn't check your access to this workspace. Try again." }, 503);
  }
  if (!membershipResponse.ok) return response(req, { error: "Couldn't verify your access to this workspace." }, 403);
  const memberships = await membershipResponse.json().catch(() => []);
  if (!Array.isArray(memberships) || memberships.length === 0) {
    return response(req, { error: "You don't have access to this workspace." }, 403);
  }

  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
  const contents = history
    .filter((item) => item && (item.role === "user" || item.role === "model") && typeof item.text === "string")
    .map((item) => ({ role: item.role, parts: [{ text: item.text.slice(0, 1200) }] }));
  const parts = [];
  const attachment = body.attachment;
  if (attachment !== null && attachment !== undefined) {
    if (!attachment || !allowedMimeTypes.has(attachment.mime) || !validBase64(attachment.data)) {
      return response(req, { error: "Attach a PDF, PNG, JPEG, or WebP file up to 4 MB." }, 400);
    }
    const fileBytes = Math.floor(attachment.data.length * 3 / 4) - (attachment.data.endsWith("==") ? 2 : attachment.data.endsWith("=") ? 1 : 0);
    if (fileBytes < 1 || fileBytes > maxFileBytes) return response(req, { error: "Spirit AI accepts files up to 4 MB for now." }, 413);
    parts.push({ inline_data: { mime_type: attachment.mime, data: attachment.data } });
  }
  parts.push({ text: "Workspace study request:\n\nStudent's request:\n" + prompt });

  contents.push({ role: "user", parts });
  let aiResponse;
  try {
    aiResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents,
        generationConfig: { temperature: 0.25, maxOutputTokens: 2048 },
      }),
    });
  } catch {
    return response(req, { error: "Spirit AI can't reach its online model right now. Try again shortly." }, 503);
  }
  if (aiResponse.status === 429) return response(req, { error: "The free Spirit AI limit is reached. Try again after the quota resets." }, 429);
  if (aiResponse.status === 403) return response(req, { error: "Free Gemini access isn't available for this project. Spirit AI won't switch to a paid plan." }, 503);
  if (!aiResponse.ok) return response(req, { error: "Gemini couldn't process that request. Check the file and try again." }, 502);

  const result = await aiResponse.json().catch(() => null);
  const text = result?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  if (!text) return response(req, { error: "Spirit