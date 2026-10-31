// SpiritHUB workspaces: Discord-style class spaces (workspace → semesters → subject channels) on Supabase.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { AI_DEFAULTS, aiSettings, checkAi, markdown, summarizeFile } from "./ai.js";

const BUCKET = "hub-files";
const FILE_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_FILE = 50 * 1024 * 1024;
const PAGE_SIZE = 150;
const STORAGE_LIMIT = 100 * 1024 * 1024; // per workspace, like the original rooms; the database enforces it too
const MAX_GIF = 5 * 1024 * 1024; // chat GIFs, like the original app
const MEMORY_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
// The original app's emoji, quick reactions and sticker set.
const EMOJIS = "😀 😃 😄 😁 😆 😅 😂 🙂 🙃 😉 😊 😍 🥰 😎 🤓 🥳 🤔 🫡 😭 😴 🤯 🫠 🤗 🤝 👍 👎 👏 🙌 🫶 💪 🔥 ✨ 💯 ❤️ 💜 💛 🧠 📚 📝 🎓 ☕ 🌱 🚀 🎉 🥹".split(" ");
const QUICK_REACTIONS = ["👍", "❤️", "😂", "🔥", "🎉"];
const STICKERS = [
  { icon: "🎉", text: "NICE ONE" },
  { icon: "🔥", text: "LET'S GO" },
  { icon: "💜", text: "GOOD VIBES" },
  { icon: "📚", text: "LOCKED IN" },
  { icon: "☕", text: "BREAK TIME" },
  { icon: "💪", text: "YOU GOT THIS" },
];
const LAST_KEY = "spirithub-hub:last";
const INVITE_KEY = "spirithub-hub:invite";

const configured = /^https:\/\/\S+/.test(SUPABASE_URL) && !SUPABASE_URL.includes("YOUR_PROJECT") && !SUPABASE_ANON_KEY.startsWith("YOUR_");
const supabase = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const $ = (id) => document.getElementById(id);
const state = {
  user: null,
  profile: null,
  workspaces: [],
  workspace: null,
  role: null,
  semesters: [],
  channels: [],
  members: new Map(),
  channel: null,
  messages: [],
  files: [],
  tab: "chat",
  realtime: null,
  invite: null,
  joined: null,
  authMode: "signin",
  ai: { settings: aiSettings.load(), caps: null },
  signedUrls: new Map(),
  openSummaries: new Set(),
  storageUsed: 0,
  view: "channel", // or "memories"
  replyTo: null,
  reactions: [],
  memories: [],
  unread: 0,
  notifications: null,
};

const storage = (area) => ({
  get(key) {
    try { return JSON.parse(area().getItem(key)); } catch { return null; }
  },
  set(key, value) {
    try { area().setItem(key, JSON.stringify(value)); } catch { /* storage blocked: keep going without it */ }
  },
  remove(key) {
    try { area().removeItem(key); } catch { /* nothing to remove */ }
  },
});
const local = storage(() => localStorage);
const session = storage(() => sessionStorage);

/* ---------- Small helpers ---------- */

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value; // only ever given escaped markdown()
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  node.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}

const initials = (name) => name.trim().split(/\s+/).map((word) => word.match(/[\p{L}\p{N}]/u)?.[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
const hue = (id) => parseInt(id.replace(/-/g, "").slice(0, 6), 16) % 360;
const nameOf = (userId) => state.members.get(userId)?.display_name || "Former member";
const formatSize = (size) => (size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`);
const shortTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const channelName = (raw) => raw.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const inviteLink = (code) => `${location.origin}${location.pathname}#join=${code}`;
const field = (label, input) => el("label", { class: "field" }, el("span", { text: label }), input);
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
const isBirthday = (person) => {
  const today = new Date();
  return person?.birth_month === today.getMonth() + 1 && person?.birth_day === today.getDate();
};
const orderedChannels = () => [
  ...state.channels.filter((channel) => !channel.semester_id),
  ...state.semesters.flatMap((semester) => state.channels.filter((channel) => channel.semester_id === semester.id)),
];

function timeLabel(iso) {
  const date = new Date(iso);
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86400000);
  if (days === 0) return `Today at ${shortTime(iso)}`;
  if (days === 1) return `Yesterday at ${shortTime(iso)}`;
  return `${date.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}, ${shortTime(iso)}`;
}

let toastTimer;
function toast(message, ms = 3400) {
  const node = $("toast");
  node.textContent = message;
  node.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("is-visible"), ms);
}

async function copyText(text, done) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast("Couldn't copy. Select the text and copy it instead.");
  }
}

// Supabase reports a write that RLS refused as zero rows changed, not as an error.
function failed(result, deniedMessage) {
  if (result.error) {
    toast(result.error.message);
    return true;
  }
  if (Array.isArray(result.data) && !result.data.length) {
    toast(deniedMessage);
    return true;
  }
  return false;
}

/* ---------- Dialog ---------- */

function ask({ title, body = null, input = null, okLabel = "OK", cancelLabel = "Cancel", danger = false }) {
  const dialog = $("dialog");
  $("dialog-title").textContent = title;
  $("dialog-body").replaceChildren(...(body === null ? [] : [typeof body === "string" ? el("p", { class: "muted", text: body }) : body]));
  const field = $("dialog-input");
  field.hidden = !input;
  if (input) Object.assign(field, { value: input.value || "", placeholder: input.placeholder || "", maxLength: input.maxLength || 60 });
  const ok = $("dialog-ok");
  ok.textContent = okLabel;
  ok.disabled = false;
  ok.classList.toggle("danger", danger);
  ok.classList.toggle("primary", !danger);
  $("dialog-cancel").hidden = cancelLabel === null;
  $("dialog-cancel").textContent = cancelLabel || "";
  dialog.returnValue = "";
  dialog.showModal();
  if (input) field.select();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      if (dialog.returnValue !== "ok") return resolve(null);
      resolve(input ? field.value.trim() || null : true);
    }, { once: true });
  });
}
$("dialog-cancel").addEventListener("click", () => $("dialog").close("cancel"));

/* ---------- Sign-in ---------- */

function setAuthMode(mode) {
  state.authMode = mode;
  const signup = mode === "signup";
  $("auth-title").textContent = signup ? "Create your account" : "Welcome back";
  $("auth-sub").textContent = signup ? "Pick a password you'll use to sign in on any device." : "Sign in to your workspaces.";
  $("name-field").hidden = !signup;
  $("auth-name").required = signup;
  $("auth-password").autocomplete = signup ? "new-password" : "current-password";
  $("auth-submit").textContent = signup ? "Create account" : "Sign in";
  $("auth-switch-text").textContent = signup ? "Already have an account?" : "New here?";
  $("auth-switch").textContent = signup ? "Sign in" : "Create an account";
  authMessage("");
}

function authMessage(message, ok = false) {
  const node = $("auth-error");
  node.hidden = !message;
  node.textContent = message;
  node.classList.toggle("ok", ok);
}

function friendlyAuthError(error) {
  const message = error?.message || String(error);
  if (/invalid login credentials/i.test(message)) return "Wrong email or password.";
  if (/already (been )?registered/i.test(message)) return "That email already has an account. Sign in instead.";
  if (/email not confirmed/i.test(message)) return "This account isn't confirmed yet. Check your email, or ask your admin to turn off email confirmation in Supabase.";
  if (/signups? (are )?(not allowed|disabled)/i.test(message)) return "New accounts are turned off for this SpiritHUB.";
  if (/rate limit|too many/i.test(message)) return "Too many attempts. Wait a minute and try again.";
  if (/failed to fetch|network/i.test(message)) return "Can't reach the server. Check your internet connection.";
  return message;
}

$("auth-switch").addEventListener("click", () => setAuthMode(state.authMode === "signin" ? "signup" : "signin"));

$("auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  const name = $("auth-name").value.trim();
  $("auth-submit").disabled = true;
  authMessage("");
  try {
    if (state.authMode === "signup") {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { hub_display_name: name } } });
      if (error) throw error;
      if (!data.session) {
        setAuthMode("signin");
        authMessage("Account created. Confirm it from the email Supabase sent you, then sign in.", true);
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (error) {
    authMessage(friendlyAuthError(error));
  } finally {
    $("auth-submit").disabled = false;
  }
});

function readInviteFromUrl() {
  const match = location.hash.match(/join=([a-z0-9]+)/i);
  if (!match) return false;
  state.invite = match[1].toLowerCase();
  session.set(INVITE_KEY, state.invite);
  history.replaceState(null, "", location.pathname + location.search);
  return true;
}

async function showInvitePreview() {
  const note = $("invite-note");
  if (!state.invite) {
    note.hidden = true;
    return;
  }
  const { data, error } = await supabase.rpc("hub_invite_preview", { invite_code: state.invite });
  const info = !error && data?.[0];
  note.hidden = false;
  if (info) {
    note.textContent = `You're invited to ${info.workspace_name} (${info.member_count} member${info.member_count === 1 ? "" : "s"}). Create an account or sign in to join.`;
    setAuthMode("signup");
  } else {
    note.textContent = "This invite link doesn't work anymore. Ask your admin for a new one.";
    state.invite = null;
    session.remove(INVITE_KEY);
  }
}

async function acceptInvite() {
  const code = state.invite;
  state.invite = null;
  session.remove(INVITE_KEY);
  const { data, error } = await supabase.rpc("hub_join", { invite_code: code });
  if (error) return toast(error.message);
  state.joined = data;
}

async function ensureProfile() {
  const { data, error } = await supabase.from("hub_profiles").select("*").eq("id", state.user.id).maybeSingle();
  if (error) throw error;
  if (data) {
    state.profile = data;
    return;
  }
  // Accounts made outside this app's sign-up form have no profile yet.
  const name = (state.user.user_metadata?.hub_display_name || state.user.email.split("@")[0]).slice(0, 40);
  const created = await supabase.from("hub_profiles").insert({ id: state.user.id, display_name: name }).select("*").single();
  if (created.error) throw created.error;
  state.profile = created.data;
}

async function handleSession(user) {
  if (user && user.id === state.user?.id && state.profile) return; // token refresh
  state.user = user;
  if (!user) return showAuth();
  try {
    await ensureProfile();
    if (state.invite) await acceptInvite();
    await loadWorkspaces();
    showApp();
    const last = local.get(LAST_KEY) || {};
    const target = [state.joined, last.workspace, state.workspaces[0]?.id].find((id) => id && state.workspaces.some((workspace) => workspace.id === id));
    if (state.joined) toast("You joined the workspace");
    state.joined = null;
    if (target) await openWorkspace(target);
    else showEmpty("workspace");
    subscribeNotifications();
    checkBirthdays();
  } catch (error) {
    toast(error.message);
  }
  refreshAi();
}

function showAuth() {
  resetWorkspace();
  if (state.notifications) supabase.removeChannel(state.notifications);
  state.notifications = null;
  Object.assign(state, { profile: null, workspaces: [] });
  $("app").hidden = true;
  $("auth").hidden = false;
  $("auth-password").value = "";
  showInvitePreview();
}

function showApp() {
  $("auth").hidden = true;
  $("app").hidden = false;
  $("me-name").textContent = state.profile.display_name;
  $("me-avatar").textContent = initials(state.profile.display_name);
  $("me-avatar").style.setProperty("--hue", hue(state.user.id));
  renderRail();
}

/* ---------- Loading data ---------- */

function unsubscribe() {
  if (state.realtime) supabase.removeChannel(state.realtime);
  state.realtime = null;
}

function resetWorkspace() {
  unsubscribe();
  Object.assign(state, { workspace: null, role: null, semesters: [], channels: [], members: new Map(), channel: null, messages: [], files: [], storageUsed: 0, view: "channel", reactions: [], memories: [] });
  $("storage").hidden = true;
  $("memories-view").hidden = true;
  clearReply();
}

async function loadWorkspaces() {
  const { data, error } = await supabase.from("hub_members").select("role, workspace:hub_workspaces(*)").eq("user_id", state.user.id);
  if (error) throw error;
  state.workspaces = data
    .filter((row) => row.workspace)
    .map((row) => ({ ...row.workspace, role: row.role }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

async function loadMembers() {
  const { data, error } = await supabase.from("hub_members").select("user_id, role, profile:hub_profiles(*)").eq("workspace_id", state.workspace.id);
  if (error) throw error;
  state.members = new Map(data.map((row) => [row.user_id, {
    user_id: row.user_id,
    role: row.role,
    display_name: row.profile?.display_name || "Member",
    birth_month: row.profile?.birth_month ?? null,
    birth_day: row.profile?.birth_day ?? null,
  }]));
  state.role = state.members.get(state.user.id)?.role || null;
}

async function openWorkspace(id) {
  const workspace = state.workspaces.find((candidate) => candidate.id === id);
  if (!workspace) return;
  resetWorkspace();
  state.workspace = workspace;
  closePanels();
  renderRail();
  $("ws-name").textContent = workspace.name;
  $("channel-tree").replaceChildren(el("p", { class: "loading", text: "Loading…" }));
  try {
    const [semesters, channels] = await Promise.all([
      supabase.from("hub_semesters").select("*").eq("workspace_id", id).order("position").order("created_at"),
      supabase.from("hub_channels").select("*").eq("workspace_id", id).order("position").order("created_at"),
      loadMembers(),
    ]);
    if (semesters.error) throw semesters.error;
    if (channels.error) throw channels.error;
    if (state.workspace?.id !== id) return;
    state.semesters = semesters.data;
    state.channels = channels.data;
  } catch (error) {
    toast(error.message);
    return;
  }
  const last = local.get(LAST_KEY) || {};
  local.set(LAST_KEY, { ...last, workspace: id });
  renderSidebar();
  renderMembers();
  refreshStorage();
  const channel = state.channels.find((candidate) => candidate.id === last.channels?.[id]) || orderedChannels()[0];
  if (channel) await openChannel(channel.id);
  else showEmpty("channel");
}

async function openChannel(id) {
  const channel = state.channels.find((candidate) => candidate.id === id);
  if (!channel) return;
  unsubscribe();
  Object.assign(state, { channel, messages: [], files: [], reactions: [], view: "channel" });
  clearReply();
  closePanels();
  const last = local.get(LAST_KEY) || {};
  local.set(LAST_KEY, { ...last, workspace: state.workspace.id, channels: { ...(last.channels || {}), [state.workspace.id]: id } });
  $("empty-main").hidden = true;
  $("memories-view").hidden = true;
  setTab(state.tab);
  renderSidebar();
  $("messages").replaceChildren(el("p", { class: "loading", text: "Loading messages…" }));
  $("files-view").replaceChildren(el("p", { class: "loading", text: "Loading files…" }));
  const [messages, files] = await Promise.all([
    supabase.from("hub_messages").select("*").eq("channel_id", id).order("created_at", { ascending: false }).limit(PAGE_SIZE),
    supabase.from("hub_files").select("*").eq("channel_id", id).order("created_at", { ascending: false }).limit(300),
  ]);
  if (state.channel?.id !== id) return;
  const problem = messages.error || files.error;
  if (problem) {
    $("messages").replaceChildren(el("p", { class: "loading", text: `Couldn't load this channel: ${problem.message}` }));
    return;
  }
  state.messages = messages.data.reverse();
  state.files = files.data;
  const ids = state.messages.map((message) => message.id);
  // Reactions arrive with update 002; without it the channel still works, just without them.
  const reactions = ids.length ? await supabase.from("hub_reactions").select("id, message_id, user_id, emoji, channel_id").in("message_id", ids) : { data: [] };
  if (state.channel?.id !== id) return;
  state.reactions = reactions.error ? [] : reactions.data;
  subscribe(id);
  renderMessages(true);
  renderFiles();
  renderHeader();
  markChannelRead(id);
}

function subscribe(channelId) {
  const filter = `channel_id=eq.${channelId}`;
  state.realtime = supabase
    .channel(`hub-${channelId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "hub_messages", filter }, ({ new: row }) => addMessage(row))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "hub_files", filter }, ({ new: row }) => upsertFile(row))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "hub_files", filter }, ({ new: row }) => upsertFile(row))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "hub_reactions", filter }, ({ new: row }) => addReaction(row))
    // Supabase can't filter deletes by channel, so these arrive for every channel and only carry the id.
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "hub_reactions" }, ({ old }) => removeReaction(old.id))
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "hub_messages" }, ({ old }) => dropMessage(old.id))
    .subscribe();
}

function dropMessage(id) {
  if (!state.messages.some((message) => message.id === id)) return;
  state.messages = state.messages.filter((message) => message.id !== id);
  renderMessages();
}

function addReaction(row) {
  if (row.channel_id !== state.channel?.id || state.reactions.some((reaction) => reaction.id === row.id)) return;
  state.reactions.push(row);
  renderMessages();
}

function removeReaction(id) {
  const before = state.reactions.length;
  state.reactions = state.reactions.filter((reaction) => reaction.id !== id);
  if (state.reactions.length !== before) renderMessages();
}

function addMessage(row) {
  if (row.channel_id !== state.channel?.id || state.messages.some((message) => message.id === row.id)) return;
  state.messages.push(row);
  if (!state.members.has(row.user_id)) {
    // Someone new joined since the member list loaded.
    loadMembers().then(() => {
      renderMembers();
      renderSidebar();
      renderMessages();
    }).catch(() => {});
  }
  renderMessages();
}

function upsertFile(row) {
  if (row.channel_id !== state.channel?.id) return;
  const index = state.files.findIndex((file) => file.id === row.id);
  if (index >= 0) state.files[index] = row;
  else state.files.unshift(row);
  renderMessages();
  renderFiles();
  renderHeader();
}

/* ---------- Rendering ---------- */

function renderRail() {
  $("rail-list").replaceChildren(...state.workspaces.map((workspace) => el("button", {
    class: `rail-btn${workspace.id === state.workspace?.id ? " is-active" : ""}`,
    type: "button",
    title: workspace.name,
    "aria-label": workspace.name,
    onclick: () => openWorkspace(workspace.id),
  }, initials(workspace.name))));
}

function rowActions(actions) {
  return el("span", { class: "row-actions" }, ...actions.map(([label, icon, handler]) => el("button", { type: "button", title: label, "aria-label": label, onclick: handler }, icon)));
}

function renderSidebar() {
  const admin = state.role === "admin";
  const workspace = state.workspace;
  const count = state.members.size;
  $("ws-name").textContent = workspace?.name || "SpiritHUB";
  $("ws-sub").textContent = workspace ? [workspace.academic_year, `${count} member${count === 1 ? "" : "s"}`].filter(Boolean).join(" · ") : "";
  const channelRow = (channel) => el("div", { class: `channel${channel.id === state.channel?.id ? " is-active" : ""}` },
    el("button", { class: "channel-link", type: "button", onclick: () => openChannel(channel.id) },
      el("span", { class: "hash", text: "#" }),
      el("span", { class: "channel-label", text: channel.name }),
      channel.course_code ? el("span", { class: "channel-code-mini", text: channel.course_code }) : null),
    admin ? rowActions([[`Edit #${channel.name}`, "✎", () => editChannel(channel)], [`Delete #${channel.name}`, "✕", () => deleteChannel(channel)]]) : null);
  const tree = [];
  if (workspace) {
    tree.push(el("button", { class: `memories-link${state.view === "memories" ? " is-active" : ""}`, type: "button", onclick: openMemories },
      el("span", { "aria-hidden": "true", text: "📷" }), "Memories"));
  }
  const loose = state.channels.filter((channel) => !channel.semester_id);
  if (loose.length) tree.push(el("div", { class: "category" }, ...loose.map(channelRow)));
  for (const semester of state.semesters) {
    const channels = state.channels.filter((channel) => channel.semester_id === semester.id);
    tree.push(el("div", { class: "category" },
      el("div", { class: "category-head" }, el("span", { text: semester.name }),
        admin ? rowActions([[`Add a channel to ${semester.name}`, "+", () => addChannel(semester)], [`Rename ${semester.name}`, "✎", () => renameSemester(semester)], [`Delete ${semester.name}`, "✕", () => deleteSemester(semester)]]) : null),
      ...channels.map(channelRow),
      channels.length ? null : el("p", { class: "category-empty", text: admin ? "No channels yet. Add one with +" : "No channels yet" })));
  }
  if (admin && state.workspace) tree.push(el("button", { class: "add-semester", type: "button", onclick: addSemester }, "+ Add semester"));
  $("channel-tree").replaceChildren(...tree);
}

function renderHeader() {
  const channel = state.channel;
  const memories = state.view === "memories" && Boolean(state.workspace);
  document.querySelector(".channel-title").hidden = !channel && !memories;
  document.querySelector(".tabs").hidden = !channel;
  $("channel-hash").textContent = memories ? "📷" : "#";
  $("channel-name").textContent = memories ? "Memories" : channel?.name || "";
  $("channel-sem").textContent = channel?.semester_id ? state.semesters.find((semester) => semester.id === channel.semester_id)?.name || "" : "";
  $("channel-code").textContent = channel?.course_code || "";
  $("message-input").placeholder = channel ? `Message #${channel.name}` : "Message";
  $("file-count").textContent = state.files.length ? String(state.files.length) : "";
  $("members-toggle").hidden = !state.workspace;
  document.querySelectorAll(".tab").forEach((tab) => {
    const active = tab.dataset.tab === state.tab;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });
}

function setTab(tab) {
  state.tab = tab;
  $("chat-view").hidden = tab !== "chat";
  $("files-view").hidden = tab !== "files";
  renderHeader();
}

function showEmpty(kind) {
  unsubscribe();
  Object.assign(state, { channel: null, messages: [], files: [], reactions: [], view: "channel" });
  $("chat-view").hidden = true;
  $("files-view").hidden = true;
  $("memories-view").hidden = true;
  const admin = state.role === "admin";
  $("empty-main").hidden = false;
  $("empty-main").replaceChildren(
    el("div", { class: "empty-glyph", text: "✳" }),
    el("h2", { text: kind === "workspace" ? "No workspace yet" : "No channels yet" }),
    el("p", {
      class: "muted",
      text: kind === "workspace"
        ? "Create one for your class, or join one with an invite link or code."
        : admin ? "Add a semester or channel from the ▾ menu next to the workspace name." : "An admin hasn't added any channels yet.",
    }),
    kind === "workspace"
      ? el("div", { class: "empty-actions" },
        el("button", { class: "btn primary", type: "button", onclick: createWorkspace }, "Create a workspace"),
        el("button", { class: "btn", type: "button", onclick: joinWithCode }, "Join with a code"))
      : null);
  if (kind === "workspace") {
    renderSidebar();
    $("members-panel").replaceChildren();
  }
  renderHeader();
}

function summaryDetails(file) {
  const details = el("details", { class: "file-summary", open: state.openSummaries.has(file.id) },
    el("summary", { text: `AI summary${file.summarized_by ? ` · saved by ${nameOf(file.summarized_by)}` : ""}` }),
    el("div", { class: "md", html: markdown(file.summary) }));
  details.addEventListener("toggle", () => (details.open ? state.openSummaries.add(file.id) : state.openSummaries.delete(file.id)));
  return details;
}

function fileCard(file, full = false) {
  const image = file.mime.startsWith("image/");
  const card = el("div", { class: `file-card${full ? " full" : ""}` },
    image ? el("img", { class: "file-thumb", alt: "", loading: "lazy" }) : el("span", { class: "file-icon", text: "PDF" }),
    el("div", { class: "file-info" },
      el("strong", { text: file.name, title: file.name }),
      el("small", { text: full ? `${formatSize(file.size)} · ${nameOf(file.user_id)} · ${timeLabel(file.created_at)}` : formatSize(file.size) })),
    el("div", { class: "file-actions" },
      el("button", { class: "btn small ghost", type: "button", onclick: () => openFile(file) }, "Open"),
      el("button", { class: "btn small", type: "button", onclick: () => summarize(file) }, file.summary ? "Summarize again" : "Summarize")),
    file.summary ? summaryDetails(file) : null);
  if (image) signedUrl(file.path).then((url) => { card.querySelector("img").src = url; }).catch(() => {});
  return card;
}

// One line describing a message, for reply quotes and the reply bar.
function preview(message) {
  if (message.kind === "sticker") return "Sticker";
  if (message.body) return message.body.slice(0, 90);
  const file = state.files.find((candidate) => candidate.id === message.file_id);
  return file ? (file.mime === "image/gif" ? "GIF" : file.name) : "a file";
}

function stickerNode(body) {
  const sticker = STICKERS.find((candidate) => body === `${candidate.icon} ${candidate.text}`);
  return sticker ? el("div", { class: "sticker-bubble" }, el("span", { text: sticker.icon }), sticker.text) : el("p", { class: "msg-body", text: body });
}

function gifNode(file) {
  const image = el("img", { class: "msg-gif", alt: file.name, loading: "lazy", onclick: () => openFile(file) });
  signedUrl(file.path).then((url) => { image.src = url; }).catch(() => {});
  return image;
}

function reactionsRow(message, reactions) {
  const byEmoji = new Map();
  for (const reaction of reactions) {
    const entry = byEmoji.get(reaction.emoji) || { names: [], mine: false };
    entry.names.push(nameOf(reaction.user_id));
    entry.mine ||= reaction.user_id === state.user.id;
    byEmoji.set(reaction.emoji, entry);
  }
  return el("div", { class: "reactions" }, ...[...byEmoji].map(([emoji, { names, mine }]) => el("button", {
    class: `reaction${mine ? " mine" : ""}`,
    type: "button",
    title: names.join(", "),
    "aria-label": `${emoji} ${names.length}${mine ? ", including you" : ""}`,
    onclick: () => toggleReaction(message, emoji),
  }, emoji, el("span", { text: String(names.length) }))));
}

function messageNode(message, grouped, reactions) {
  const name = nameOf(message.user_id);
  const file = message.file_id ? state.files.find((candidate) => candidate.id === message.file_id) : null;
  const canDelete = message.user_id === state.user.id || state.role === "admin";
  const replied = message.reply_to_id ? state.messages.find((candidate) => candidate.id === message.reply_to_id) : null;
  const node = el("article", { class: `message${grouped ? " grouped" : ""}`, "data-id": message.id },
    grouped
      ? el("time", { class: "msg-time-gutter", datetime: message.created_at, text: shortTime(message.created_at) })
      : el("span", { class: "avatar", style: `--hue:${hue(message.user_id)}`, text: initials(name), "aria-hidden": "true" }),
    el("div", { class: "msg-main" },
      message.reply_to_id
        ? el("button", { class: "quote", type: "button", title: "Show the original message", onclick: () => jumpTo(message.reply_to_id) }, "↪",
          replied ? [el("strong", { text: nameOf(replied.user_id) }), el("span", { text: preview(replied) })] : el("span", { text: "Earlier message" }))
        : null,
      grouped ? null : el("div", { class: "msg-meta" }, el("strong", { text: name }), el("time", { datetime: message.created_at, text: timeLabel(message.created_at) })),
      message.kind === "sticker" ? stickerNode(message.body) : message.body ? el("p", { class: "msg-body", text: message.body }) : null,
      file ? (file.mime === "image/gif" ? gifNode(file) : fileCard(file)) : message.file_id ? el("p", { class: "muted small", text: "Uploading…" }) : null,
      reactions?.length ? reactionsRow(message, reactions) : null),
    el("div", { class: "msg-actions" },
      el("button", { class: "text", type: "button", title: "Reply", onclick: () => setReply(message) }, "Reply"),
      ...QUICK_REACTIONS.map((emoji) => el("button", { type: "button", title: `React with ${emoji}`, "aria-label": `React with ${emoji}`, onclick: () => toggleReaction(message, emoji) }, emoji)),
      canDelete ? el("button", { type: "button", title: "Delete message", "aria-label": "Delete message", onclick: () => deleteMessage(message, file) }, "✕") : null));
  // Touch screens have no hover, so a tap shows the message's actions.
  node.addEventListener("click", (event) => {
    if (!event.target.closest("button, a, img, details, input")) node.classList.toggle("is-selected");
  });
  return node;
}

function renderMessages(toBottom = false) {
  const list = $("messages");
  if (!state.channel) return;
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
  const previousTop = list.scrollTop;
  const nodes = [];
  if (state.messages.length < PAGE_SIZE) {
    nodes.push(el("div", { class: "channel-intro" },
      el("div", { class: "intro-hash", text: "#" }),
      el("h3", { text: `Welcome to #${state.channel.name}${state.channel.course_code ? ` · ${state.channel.course_code}` : ""}` }),
      el("p", { class: "muted", text: "Share notes, PDFs and screenshots here. Everyone in the workspace can see them, and anyone can save an AI summary of a file for the rest." })));
  }
  const reactionsByMessage = new Map();
  for (const reaction of state.reactions) {
    if (!reactionsByMessage.has(reaction.message_id)) reactionsByMessage.set(reaction.message_id, []);
    reactionsByMessage.get(reaction.message_id).push(reaction);
  }
  let previous = null;
  for (const message of state.messages) {
    // A reply always shows its author, so its quote reads naturally.
    const grouped = !message.reply_to_id && previous?.user_id === message.user_id && new Date(message.created_at) - new Date(previous.created_at) < 5 * 60 * 1000;
    nodes.push(messageNode(message, grouped, reactionsByMessage.get(message.id)));
    previous = message;
  }
  list.replaceChildren(...nodes);
  list.scrollTop = toBottom || nearBottom ? list.scrollHeight : previousTop;
}

function renderFiles() {
  if (!state.channel) return;
  const picker = el("input", { type: "file", accept: FILE_TYPES.join(","), multiple: true, hidden: true, onchange: (event) => {
    uploadFiles([...event.target.files]);
    event.target.value = "";
  } });
  $("files-view").replaceChildren(
    el("div", { class: "files-top" }, el("h3", { text: `Files in #${state.channel.name}` }), el("label", { class: "btn primary small" }, "Upload", picker)),
    state.files.length
      ? el("div", { class: "file-list" }, ...state.files.map((file) => fileCard(file, true)))
      : el("p", { class: "muted", text: "No files yet. Upload PDFs or screenshots, then summarize them with your local AI." }));
}

function renderMembers() {
  if (!state.workspace) return;
  const admin = state.role === "admin";
  const ownerId = state.workspace.created_by;
  const people = [...state.members.values()].sort((a, b) => a.display_name.localeCompare(b.display_name));
  const row = (member) => el("div", { class: "member" },
    el("span", { class: "avatar small", style: `--hue:${hue(member.user_id)}`, text: initials(member.display_name), "aria-hidden": "true" }),
    el("span", { class: "member-name", text: `${member.display_name}${member.user_id === state.user.id ? " (you)" : ""}` }),
    isBirthday(member) ? el("span", { class: "birthday", title: "Birthday today", "aria-label": "Birthday today", text: "🎂" }) : null,
    member.user_id === ownerId ? el("span", { class: "badge", text: "owner" }) : null,
    admin && member.user_id !== ownerId && member.user_id !== state.user.id
      ? rowActions([
        [member.role === "admin" ? `Make ${member.display_name} a member` : `Make ${member.display_name} an admin`, member.role === "admin" ? "↓" : "↑", () => setRole(member, member.role === "admin" ? "member" : "admin")],
        [`Remove ${member.display_name}`, "✕", () => removeMember(member)],
      ])
      : null);
  const group = (title, list) => (list.length ? [el("p", { class: "members-head", text: `${title} — ${list.length}` }), ...list.map(row)] : []);
  $("members-panel").replaceChildren(
    el("div", { class: "members-top" }, el("strong", { text: "Members" }), el("button", { class: "btn small", type: "button", onclick: showInvite }, "Invite")),
    ...group("Admins", people.filter((member) => member.role === "admin")),
    ...group("Members", people.filter((member) => member.role !== "admin")));
}

/* ---------- Workspace actions ---------- */

async function createWorkspace() {
  const name = el("input", { class: "input", maxlength: 60, placeholder: "e.g. Kalvium Squad 12", required: true });
  const year = el("input", { class: "input", maxlength: 40, placeholder: "e.g. 2026–27" });
  const body = el("div", { class: "dialog-fields" },
    el("p", { class: "muted", text: "A workspace is your class space, like a Discord server. You'll be its admin and can invite people with a link or code." }),
    field("Workspace name", name),
    field("Academic year (optional)", year));
  if (!(await ask({ title: "Create a workspace", body, okLabel: "Create" }))) return;
  const { data, error } = await supabase.rpc("hub_create_workspace", { workspace_name: name.value.trim() });
  if (error) return toast(error.message);
  if (year.value.trim()) {
    const saved = await supabase.from("hub_workspaces").update({ academic_year: year.value.trim() }).eq("id", data);
    if (saved.error) toast(saved.error.message);
  }
  await loadWorkspaces();
  await openWorkspace(data);
  toast("Workspace created. Invite people from the ▾ menu.");
}

async function editWorkspace() {
  const workspace = state.workspace;
  const name = el("input", { class: "input", maxlength: 60, value: workspace.name, required: true });
  const year = el("input", { class: "input", maxlength: 40, value: workspace.academic_year || "", placeholder: "e.g. 2026–27" });
  const body = el("div", { class: "dialog-fields" }, field("Workspace name", name), field("Academic year (optional)", year));
  if (!(await ask({ title: "Workspace settings", body, okLabel: "Save" }))) return;
  const changes = { name: name.value.trim() || workspace.name, academic_year: year.value.trim() || null };
  const result = await supabase.from("hub_workspaces").update(changes).eq("id", workspace.id).select("id");
  if (failed(result, "Only admins can change workspace settings.")) return;
  Object.assign(workspace, changes);
  renderRail();
  renderSidebar();
  toast("Workspace settings saved");
}

async function showInvite() {
  const { data, error } = await supabase.from("hub_invites").select("code").eq("workspace_id", state.workspace.id).maybeSingle();
  if (error) return toast(error.message);
  if (!data) return toast("Only admins can share the invite until the latest database update is installed.");
  const linkInput = el("input", { class: "input", readonly: true, value: inviteLink(data.code), "aria-label": "Invite link" });
  const codeText = el("code", { text: data.code });
  const reset = async () => {
    if (!confirm("Reset the invite? The old link and code stop working for anyone who hasn't joined yet.")) return;
    const result = await supabase.rpc("hub_reset_invite", { ws: state.workspace.id });
    if (result.error) return toast(result.error.message);
    linkInput.value = inviteLink(result.data);
    codeText.textContent = result.data;
    toast("New invite ready. The old link and code no longer work.");
  };
  const body = el("div", {},
    el("p", { class: "muted", text: "Anyone with this link can create an account with their email and their own password, then join. Share it in your class group." }),
    el("div", { class: "copy-row" }, linkInput, el("button", { class: "btn", type: "button", onclick: () => copyText(linkInput.value, "Invite link copied") }, "Copy")),
    el("p", { class: "muted small" }, "Or they can press ↗ (Join) and type the code ", codeText, "."),
    state.role === "admin" ? el("button", { class: "link danger", type: "button", onclick: reset }, "Reset invite") : null);
  await ask({ title: `Invite people to ${state.workspace.name}`, body, okLabel: "Done", cancelLabel: null });
}

async function joinWithCode() {
  const raw = await ask({ title: "Join a workspace", body: "Paste the invite link, or type the code a classmate shared.", input: { placeholder: "e.g. 1266199116d7", maxLength: 300 }, okLabel: "Join" });
  const code = raw && (raw.match(/join=([a-z0-9]+)/i)?.[1] || raw.replace(/\s+/g, ""));
  if (!code) return;
  const { data, error } = await supabase.rpc("hub_join", { invite_code: code });
  if (error) return toast(error.message);
  await loadWorkspaces();
  await openWorkspace(data);
  toast("You joined the workspace");
}

async function afterWorkspaceGone() {
  local.set(LAST_KEY, { ...(local.get(LAST_KEY) || {}), workspace: null });
  resetWorkspace();
  await loadWorkspaces();
  renderRail();
  if (state.workspaces[0]) await openWorkspace(state.workspaces[0].id);
  else showEmpty("workspace");
}

async function leaveWorkspace() {
  if (!(await ask({ title: `Leave ${state.workspace.name}?`, body: "You'll need a new invite link to come back.", okLabel: "Leave", danger: true }))) return;
  const result = await supabase.from("hub_members").delete().eq("workspace_id", state.workspace.id).eq("user_id", state.user.id).select("user_id");
  if (failed(result, "You can't leave this workspace.")) return;
  await afterWorkspaceGone();
}

async function filePaths(filter) {
  const { data } = await filter(supabase.from("hub_files").select("path"));
  return (data || []).map((row) => row.path);
}

async function removePaths(paths) {
  for (let start = 0; start < paths.length; start += 100) await supabase.storage.from(BUCKET).remove(paths.slice(start, start + 100));
}

async function deleteWorkspace() {
  const typed = await ask({
    title: `Delete ${state.workspace.name}?`,
    body: "This deletes every semester, channel, message and file in it, for everyone. Type the workspace name to confirm.",
    input: { placeholder: state.workspace.name, maxLength: 60 },
    okLabel: "Delete forever",
    danger: true,
  });
  if (typed === null) return;
  if (typed !== state.workspace.name) return toast("The name didn't match, so nothing was deleted.");
  // Files go first: once the workspace row is gone, nobody is its admin any more.
  const memoryRows = await fetchAll(() => supabase.from("hub_memories").select("path").eq("workspace_id", state.workspace.id)).catch(() => []);
  await removePaths([...(await filePaths((query) => query.eq("workspace_id", state.workspace.id))), ...memoryRows.map((row) => row.path)]);
  const result = await supabase.from("hub_workspaces").delete().eq("id", state.workspace.id).select("id");
  if (failed(result, "Only the owner can delete this workspace.")) return;
  await afterWorkspaceGone();
}

async function addSemester() {
  const name = await ask({ title: "Add a semester", input: { placeholder: "e.g. Sem 2", maxLength: 40 }, okLabel: "Add" });
  if (!name) return;
  const position = Math.max(0, ...state.semesters.map((semester) => semester.position)) + 1;
  const { data, error } = await supabase.from("hub_semesters").insert({ workspace_id: state.workspace.id, name, position }).select().single();
  if (error) return toast(error.message);
  state.semesters.push(data);
  renderSidebar();
  toast(`${name} added. Use + next to it to add subject channels.`);
}

async function renameSemester(semester) {
  const name = await ask({ title: "Rename semester", input: { value: semester.name, maxLength: 40 }, okLabel: "Save" });
  if (!name || name === semester.name) return;
  const result = await supabase.from("hub_semesters").update({ name }).eq("id", semester.id).select("id");
  if (failed(result, "Only admins can rename semesters.")) return;
  semester.name = name;
  renderSidebar();
  renderHeader();
}

function afterChannelsChanged() {
  renderSidebar();
  refreshStorage();
  if (state.view === "memories") return;
  if (state.channels.some((channel) => channel.id === state.channel?.id)) return;
  const next = orderedChannels()[0];
  if (next) openChannel(next.id);
  else showEmpty("channel");
}

async function deleteSemester(semester) {
  const channels = state.channels.filter((channel) => channel.semester_id === semester.id);
  const body = `This deletes ${channels.length} channel${channels.length === 1 ? "" : "s"} in it, with all their messages and files.`;
  if (!(await ask({ title: `Delete ${semester.name}?`, body, okLabel: "Delete", danger: true }))) return;
  const paths = channels.length ? await filePaths((query) => query.in("channel_id", channels.map((channel) => channel.id))) : [];
  const result = await supabase.from("hub_semesters").delete().eq("id", semester.id).select("id");
  if (failed(result, "Only admins can delete semesters.")) return;
  await removePaths(paths);
  state.semesters = state.semesters.filter((candidate) => candidate !== semester);
  state.channels = state.channels.filter((channel) => channel.semester_id !== semester.id);
  afterChannelsChanged();
}

// Name and course code, like the original app's subjects. Resolves to null when cancelled.
async function channelDetails({ title, okLabel, channel = null }) {
  const name = el("input", { class: "input", maxlength: 40, value: channel?.name || "", placeholder: "e.g. dsa or web-dev", required: true });
  const code = el("input", { class: "input", maxlength: 20, value: channel?.course_code || "", placeholder: "e.g. CS201" });
  const body = el("div", { class: "dialog-fields" },
    el("p", { class: "muted", text: "A channel holds the chat and files for one subject." }),
    field("Channel name", name),
    field("Course code (optional)", code));
  if (!(await ask({ title, body, okLabel }))) return null;
  const cleanName = channelName(name.value);
  if (!cleanName) {
    toast("Give the channel a name with at least one letter or number.");
    return null;
  }
  return { name: cleanName, course_code: code.value.trim() || null };
}

async function addChannel(semester) {
  const details = await channelDetails({ title: semester ? `New channel in ${semester.name}` : "New workspace channel", okLabel: "Create" });
  if (!details) return;
  const siblings = state.channels.filter((channel) => channel.semester_id === (semester?.id || null));
  const position = Math.max(0, ...siblings.map((channel) => channel.position)) + 1;
  const row = { workspace_id: state.workspace.id, semester_id: semester?.id || null, name: details.name, position };
  if (details.course_code) row.course_code = details.course_code;
  const { data, error } = await supabase.from("hub_channels").insert(row).select().single();
  if (error) return toast(error.message);
  state.channels.push(data);
  await openChannel(data.id);
}

async function editChannel(channel) {
  const details = await channelDetails({ title: `Edit #${channel.name}`, okLabel: "Save", channel });
  if (!details || (details.name === channel.name && details.course_code === (channel.course_code || null))) return;
  const result = await supabase.from("hub_channels").update(details).eq("id", channel.id).select("id");
  if (failed(result, "Only admins can edit channels.")) return;
  Object.assign(channel, details);
  renderSidebar();
  renderHeader();
  renderMessages();
}

async function deleteChannel(channel) {
  if (!(await ask({ title: `Delete #${channel.name}?`, body: "All its messages and files are deleted for everyone.", okLabel: "Delete", danger: true }))) return;
  const paths = await filePaths((query) => query.eq("channel_id", channel.id));
  const result = await supabase.from("hub_channels").delete().eq("id", channel.id).select("id");
  if (failed(result, "Only admins can delete channels.")) return;
  await removePaths(paths);
  state.channels = state.channels.filter((candidate) => candidate !== channel);
  afterChannelsChanged();
}

async function setRole(member, role) {
  const result = await supabase.from("hub_members").update({ role }).eq("workspace_id", state.workspace.id).eq("user_id", member.user_id).select("user_id");
  if (failed(result, "You can't change that person's role.")) return;
  member.role = role;
  renderMembers();
  toast(role === "admin" ? `${member.display_name} is now an admin` : `${member.display_name} is now a member`);
}

async function removeMember(member) {
  const body = "They lose access until they join again with an invite link. Reset the link if they shouldn't come back.";
  if (!(await ask({ title: `Remove ${member.display_name}?`, body, okLabel: "Remove", danger: true }))) return;
  const result = await supabase.from("hub_members").delete().eq("workspace_id", state.workspace.id).eq("user_id", member.user_id).select("user_id");
  if (failed(result, "You can't remove that person.")) return;
  state.members.delete(member.user_id);
  renderMembers();
  renderSidebar();
}

/* ---------- Messages and files ---------- */

$("composer").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("message-input");
  const body = input.value.trim();
  if (!body || !state.channel) return;
  input.value = "";
  const row = { workspace_id: state.workspace.id, channel_id: state.channel.id, body };
  if (state.replyTo) row.reply_to_id = state.replyTo.id;
  const { data, error } = await supabase.from("hub_messages").insert(row).select().single();
  if (error) {
    input.value = body;
    return toast(error.message);
  }
  clearReply();
  addMessage(data);
});

async function uploadFiles(files) {
  if (!state.channel) return toast("Pick a channel first");
  const { workspace, channel } = state;
  for (const file of files) {
    if (!FILE_TYPES.includes(file.type)) {
      toast(`${file.name}: only PDFs and images (PNG, JPEG, WebP, GIF)`);
      continue;
    }
    if (file.size > MAX_FILE) {
      toast(`${file.name} is over 50 MB`);
      continue;
    }
    if (state.storageUsed + file.size > STORAGE_LIMIT) {
      toast("This workspace is at its 100 MB storage limit. Ask an admin to delete old files.");
      continue;
    }
    toast(`Uploading ${file.name}…`, 120000);
    const path = `${workspace.id}/${channel.id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, "-").slice(-80)}`;
    const stored = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
    if (stored.error) {
      toast(`Upload failed: ${stored.error.message}`);
      continue;
    }
    const row = await supabase.from("hub_files").insert({ workspace_id: workspace.id, channel_id: channel.id, name: file.name.slice(0, 200), path, mime: file.type, size: file.size }).select().single();
    if (row.error) {
      await supabase.storage.from(BUCKET).remove([path]);
      toast(row.error.message);
      continue;
    }
    upsertFile(row.data);
    state.storageUsed += file.size;
    renderStorage();
    const message = await supabase.from("hub_messages").insert({ workspace_id: workspace.id, channel_id: channel.id, file_id: row.data.id }).select().single();
    if (message.error) toast(message.error.message);
    else {
      addMessage(message.data);
      toast(`Uploaded ${file.name}`);
    }
  }
}

async function signedUrl(path) {
  const cached = state.signedUrls.get(path);
  if (cached && cached.expires > Date.now()) return cached.url;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  state.signedUrls.set(path, { url: data.signedUrl, expires: Date.now() + 3500 * 1000 });
  return data.signedUrl;
}

async function openFile(file) {
  const tab = window.open("about:blank", "_blank"); // opened during the click so popup blockers allow it
  try {
    const url = await signedUrl(file.path);
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else location.assign(url);
  } catch (error) {
    tab?.close();
    toast(error.message);
  }
}

async function deleteMessage(message, file) {
  const body = file ? `The file "${file.name}" is deleted too.` : "This can't be undone.";
  if (!(await ask({ title: "Delete this message?", body, okLabel: "Delete", danger: true }))) return;
  if (file) {
    // Deleting the file row also deletes the message that carries it.
    const result = await supabase.from("hub_files").delete().eq("id", file.id).select("id");
    if (failed(result, "Only the uploader or an admin can delete this file.")) return;
    await supabase.storage.from(BUCKET).remove([file.path]);
    state.files = state.files.filter((candidate) => candidate.id !== file.id);
    refreshStorage();
  } else {
    const result = await supabase.from("hub_messages").delete().eq("id", message.id).select("id");
    if (failed(result, "Only the sender or an admin can delete this message.")) return;
  }
  state.messages = state.messages.filter((candidate) => candidate.id !== message.id);
  renderMessages();
  renderFiles();
  renderHeader();
}

/* ---------- Storage meter, backup and profile (as in the original app) ---------- */

// Supabase returns at most 1,000 rows per request, so page through bigger tables.
async function fetchAll(build) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

function renderStorage() {
  const percent = Math.min(100, (state.storageUsed / STORAGE_LIMIT) * 100);
  $("storage").hidden = !state.workspace;
  $("storage").classList.toggle("is-full", percent >= 100);
  $("storage-label").textContent = `Workspace files · ${state.storageUsed ? formatSize(state.storageUsed) : "0 MB"} / 100 MB`;
  $("storage-fill").style.width = `${percent}%`;
  $("storage-meter").setAttribute("aria-valuenow", String(Math.round(percent)));
}

async function refreshStorage() {
  const workspaceId = state.workspace?.id;
  if (!workspaceId) return;
  try {
    const [files, memories] = await Promise.all([
      fetchAll(() => supabase.from("hub_files").select("size").eq("workspace_id", workspaceId)),
      fetchAll(() => supabase.from("hub_memories").select("size").eq("workspace_id", workspaceId)).catch(() => []), // memories arrive with update 002
    ]);
    if (state.workspace?.id !== workspaceId) return;
    state.storageUsed = [...files, ...memories].reduce((sum, row) => sum + Number(row.size || 0), 0);
    renderStorage();
  } catch (error) {
    toast(error.message);
  }
}

async function downloadBackup() {
  const workspace = state.workspace;
  toast("Preparing the backup…", 600000);
  try {
    const rowsOf = (table) => fetchAll(() => supabase.from(table).select("*").eq("workspace_id", workspace.id).order("created_at"));
    const optional = (rows) => rows.catch(() => []); // tables from update 002 may not exist yet
    const [semesters, channels, files, messages, members, reactions, memories] = await Promise.all([
      rowsOf("hub_semesters"),
      rowsOf("hub_channels"),
      rowsOf("hub_files"),
      rowsOf("hub_messages"),
      fetchAll(() => supabase.from("hub_members").select("user_id, role, joined_at, profile:hub_profiles(display_name)").eq("workspace_id", workspace.id).order("joined_at")),
      optional(rowsOf("hub_reactions")),
      optional(rowsOf("hub_memories")),
    ]);
    const manifest = {
      exported_at: new Date().toISOString(),
      workspace: { id: workspace.id, name: workspace.name, academic_year: workspace.academic_year || null, created_at: workspace.created_at },
      members: members.map(({ user_id, role, joined_at, profile }) => ({ user_id, role, joined_at, display_name: profile?.display_name || null })),
      semesters,
      channels,
      messages,
      reactions,
      files,
      memories,
    };
    const { zipSync, strToU8 } = await import("https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js");
    const archive = { "spirithub-backup.json": strToU8(JSON.stringify(manifest, null, 2)) };
    const channelNames = new Map(channels.map((channel) => [channel.id, channel.name]));
    const downloads = [
      ...files.map((file) => ({ path: file.path, label: file.name, into: `files/${channelNames.get(file.channel_id) || "channel"}` })),
      ...memories.map((memory) => ({ path: memory.path, label: "a memories photo", into: "memories" })),
    ];
    for (const [index, item] of downloads.entries()) {
      toast(`Adding files to the backup: ${index + 1} of ${downloads.length}…`, 600000);
      const { data, error } = await supabase.storage.from(BUCKET).download(item.path);
      if (error) throw new Error(`couldn't include ${item.label} (${error.message})`);
      archive[`${item.into}/${item.path.split("/").pop()}`] = new Uint8Array(await data.arrayBuffer());
    }
    const url = URL.createObjectURL(new Blob([zipSync(archive, { level: 1 })], { type: "application/zip" }));
    const link = el("a", { href: url, download: `${slug(workspace.name)}-spirithub-backup.zip` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
    toast(`Backup downloaded: ${count(messages.length, "message")}, ${count(files.length, "file")} and ${count(memories.length, "photo")}`);
  } catch (error) {
    toast(`Backup failed: ${error.message}`);
  }
}

async function editProfile() {
  const profile = state.profile;
  const pad = (value) => String(value).padStart(2, "0");
  const name = el("input", { class: "input", maxlength: 40, value: profile.display_name, required: true });
  // The year is a placeholder (2000 has a 29 February); only the month and day are saved, like the original app.
  const birthday = el("input", { class: "input", type: "date", value: profile.birth_month ? `2000-${pad(profile.birth_month)}-${pad(profile.birth_day)}` : "" });
  const body = el("div", { class: "dialog-fields" },
    field("Display name (what your classmates see)", name),
    field("Birthday (optional, only the day and month are kept)", birthday));
  if (!(await ask({ title: "Your profile", body, okLabel: "Save" }))) return;
  const [, month, day] = birthday.value ? birthday.value.split("-").map(Number) : [];
  const changes = { display_name: name.value.trim() || profile.display_name };
  if (month || profile.birth_month) Object.assign(changes, { birth_month: month || null, birth_day: day || null });
  const result = await supabase.from("hub_profiles").update(changes).eq("id", state.user.id).select("*");
  if (failed(result, "Couldn't save your profile. Try again.")) return;
  state.profile = result.data[0];
  $("me-name").textContent = state.profile.display_name;
  $("me-avatar").textContent = initials(state.profile.display_name);
  const me = state.members.get(state.user.id);
  if (me) Object.assign(me, { display_name: state.profile.display_name, birth_month: state.profile.birth_month ?? null, birth_day: state.profile.birth_day ?? null });
  renderMembers();
  renderMessages();
  toast("Profile saved");
}

/* ---------- Replies, reactions, emoji, stickers and GIFs (as in the original app) ---------- */

function setReply(message) {
  state.replyTo = message;
  $("reply-label").textContent = `Replying to ${nameOf(message.user_id)} · ${preview(message)}`;
  $("reply-bar").hidden = false;
  $("message-input").focus();
}

function clearReply() {
  state.replyTo = null;
  $("reply-bar").hidden = true;
}

function jumpTo(messageId) {
  const node = $("messages").querySelector(`[data-id="${messageId}"]`);
  if (!node) return toast("That message is older than what's loaded here.");
  node.scrollIntoView({ behavior: "smooth", block: "center" });
  node.classList.add("flash");
  setTimeout(() => node.classList.remove("flash"), 1200);
}

async function toggleReaction(message, emoji) {
  const mine = state.reactions.find((reaction) => reaction.message_id === message.id && reaction.user_id === state.user.id && reaction.emoji === emoji);
  if (mine) {
    const result = await supabase.from("hub_reactions").delete().eq("id", mine.id).select("id");
    if (failed(result, "Couldn't remove that reaction.")) return;
    return removeReaction(mine.id);
  }
  const { data, error } = await supabase.from("hub_reactions")
    .insert({ workspace_id: state.workspace.id, channel_id: state.channel.id, message_id: message.id, emoji })
    .select("id, message_id, user_id, emoji, channel_id").single();
  if (error) return /duplicate/i.test(error.message) ? null : toast(error.message); // a double tap already added it
  addReaction(data);
}

function togglePicker(which) {
  for (const name of ["emoji", "sticker"]) {
    const open = name === which && $(`${name}-picker`).hidden;
    $(`${name}-picker`).hidden = !open;
    $(`${name}-button`).setAttribute("aria-expanded", String(open));
  }
}

function insertEmoji(emoji) {
  const input = $("message-input");
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
  togglePicker(null);
  input.focus();
  input.setSelectionRange(start + emoji.length, start + emoji.length);
}

async function sendSticker(sticker) {
  togglePicker(null);
  if (!state.channel) return;
  const row = { workspace_id: state.workspace.id, channel_id: state.channel.id, body: `${sticker.icon} ${sticker.text}`, kind: "sticker" };
  if (state.replyTo) row.reply_to_id = state.replyTo.id;
  const { data, error } = await supabase.from("hub_messages").insert(row).select().single();
  if (error) return toast(error.message);
  clearReply();
  addMessage(data);
}

/* ---------- Memories gallery (as in the original app) ---------- */

async function openMemories() {
  unsubscribe();
  clearReply();
  Object.assign(state, { view: "memories", channel: null, messages: [], files: [], reactions: [] });
  closePanels();
  $("empty-main").hidden = true;
  $("chat-view").hidden = true;
  $("files-view").hidden = true;
  $("memories-view").hidden = false;
  renderSidebar();
  renderHeader();
  $("memories-view").replaceChildren(el("p", { class: "loading", text: "Loading memories…" }));
  const workspaceId = state.workspace.id;
  const { data, error } = await supabase.from("hub_memories").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false });
  if (state.view !== "memories" || state.workspace?.id !== workspaceId) return;
  if (error) {
    $("memories-view").replaceChildren(el("p", { class: "loading", text: `Couldn't load memories: ${error.message}` }));
    return;
  }
  state.memories = data;
  renderMemories();
}

function renderMemories() {
  const picker = el("input", { type: "file", accept: MEMORY_TYPES.join(","), multiple: true, hidden: true, onchange: (event) => {
    uploadMemories([...event.target.files]);
    event.target.value = "";
  } });
  const cards = state.memories.map((memory) => {
    const image = el("img", { alt: `Photo shared by ${nameOf(memory.user_id)}`, loading: "lazy", onclick: () => openFile(memory) });
    signedUrl(memory.path).then((url) => { image.src = url; }).catch(() => {});
    const canDelete = memory.user_id === state.user.id || state.role === "admin";
    return el("figure", { class: "memory" }, image,
      el("figcaption", { class: "memory-meta", text: `${memory.caption ? `${memory.caption} · ` : ""}${nameOf(memory.user_id)} · ${timeLabel(memory.created_at)}` }),
      canDelete ? el("button", { class: "memory-delete", type: "button", title: "Delete photo", "aria-label": "Delete photo", onclick: () => deleteMemory(memory) }, "✕") : null);
  });
  $("memories-view").replaceChildren(
    el("div", { class: "files-top" },
      el("div", {}, el("h3", { text: "Memories" }), el("p", { class: "muted small", text: "Class photos for everyone in this workspace. They count toward its 100 MB." })),
      el("label", { class: "btn primary small" }, "Add photos", picker)),
    cards.length
      ? el("div", { class: "memory-grid" }, ...cards)
      : el("p", { class: "muted", text: "No photos yet. Add the first one from a trip, a fest or a late-night study session." }));
}

async function uploadMemories(files) {
  const workspace = state.workspace;
  for (const file of files) {
    if (!MEMORY_TYPES.includes(file.type)) {
      toast(`${file.name}: photos only (PNG, JPEG, WebP or GIF)`);
      continue;
    }
    if (file.size > MAX_FILE) {
      toast(`${file.name} is over 50 MB`);
      continue;
    }
    if (state.storageUsed + file.size > STORAGE_LIMIT) {
      toast("This workspace is at its 100 MB storage limit. Ask an admin to delete old files.");
      continue;
    }
    toast(`Uploading ${file.name}…`, 120000);
    const path = `${workspace.id}/memories/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, "-").slice(-80)}`;
    const stored = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
    if (stored.error) {
      toast(`Upload failed: ${stored.error.message}`);
      continue;
    }
    const row = await supabase.from("hub_memories").insert({ workspace_id: workspace.id, path, mime: file.type, size: file.size }).select().single();
    if (row.error) {
      await supabase.storage.from(BUCKET).remove([path]);
      toast(row.error.message);
      continue;
    }
    state.storageUsed += file.size;
    renderStorage();
    if (state.view === "memories" && state.workspace?.id === workspace.id) {
      state.memories.unshift(row.data);
      renderMemories();
    }
    toast(`Added ${file.name} to Memories`);
  }
}

async function deleteMemory(memory) {
  if (!(await ask({ title: "Delete this photo?", body: "It's removed from Memories for everyone.", okLabel: "Delete", danger: true }))) return;
  const result = await supabase.from("hub_memories").delete().eq("id", memory.id).select("id");
  if (failed(result, "Only the person who added it or an admin can delete this photo.")) return;
  await supabase.storage.from(BUCKET).remove([memory.path]);
  state.memories = state.memories.filter((candidate) => candidate.id !== memory.id);
  renderMemories();
  refreshStorage();
}

/* ---------- Notifications and birthdays (as in the original app) ---------- */

async function refreshUnread() {
  const { count, error } = await supabase.from("hub_notifications").select("id", { count: "exact", head: true }).eq("user_id", state.user.id).is("read_at", null);
  // A count-only request to a missing table reports no count rather than an error.
  const unavailable = Boolean(error) || count === null;
  $("notifications-btn").hidden = unavailable; // hidden until update 002 is installed
  if (unavailable) return;
  state.unread = count || 0;
  $("unread-count").hidden = !state.unread;
  $("unread-count").textContent = state.unread > 99 ? "99+" : String(state.unread);
}

function subscribeNotifications() {
  if (state.notifications) supabase.removeChannel(state.notifications);
  state.notifications = supabase
    .channel(`hub-notifications-${state.user.id}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "hub_notifications", filter: `user_id=eq.${state.user.id}` }, ({ new: row }) => onNotification(row))
    .subscribe();
  refreshUnread();
}

async function onNotification(row) {
  // Someone reading the channel the message is in doesn't need to be told about it.
  if (row.channel_id && row.channel_id === state.channel?.id && document.hasFocus()) {
    await supabase.from("hub_notifications").update({ read_at: new Date().toISOString() }).eq("id", row.id);
    return;
  }
  refreshUnread();
  if ("Notification" in window && Notification.permission === "granted" && !document.hasFocus()) {
    new Notification(row.title, { body: row.body, tag: row.event_key });
  }
}

async function markChannelRead(channelId) {
  const { error } = await supabase.from("hub_notifications").update({ read_at: new Date().toISOString() }).eq("user_id", state.user.id).eq("channel_id", channelId).is("read_at", null);
  if (!error) refreshUnread();
}

function browserNotificationControl() {
  if (!("Notification" in window)) return null;
  if (Notification.permission === "granted") return el("span", { class: "muted small", text: "Browser notifications are on while SpiritHUB is open." });
  if (Notification.permission === "denied") return el("span", { class: "muted small", text: "Browser notifications are blocked in this browser's settings." });
  return el("button", { class: "btn small", type: "button", onclick: async (event) => {
    const permission = await Notification.requestPermission();
    event.target.replaceWith(el("span", { class: "muted small", text: permission === "granted" ? "Browser notifications are on while SpiritHUB is open." : "Browser notifications stay off." }));
  } }, "Turn on browser notifications");
}

async function openNotifications() {
  const { data, error } = await supabase.from("hub_notifications").select("*").eq("user_id", state.user.id).order("created_at", { ascending: false }).limit(40);
  if (error) return toast(error.message);
  const now = () => new Date().toISOString();
  const open = async (item) => {
    $("dialog").close("cancel");
    if (!item.read_at) await supabase.from("hub_notifications").update({ read_at: now() }).eq("id", item.id);
    if (state.workspace?.id !== item.workspace_id) await openWorkspace(item.workspace_id);
    if (item.channel_id && state.channels.some((channel) => channel.id === item.channel_id)) await openChannel(item.channel_id);
    refreshUnread();
  };
  const list = el("div", { class: "notification-list" }, ...(data.length
    ? data.map((item) => el("button", { class: `notification${item.read_at ? " is-read" : ""}`, type: "button", onclick: () => open(item) },
      el("span", { "aria-hidden": "true", text: item.kind === "birthday" ? "🎂" : "💬" }),
      el("span", {}, el("strong", { text: item.title }), el("small", { text: `${item.body ? `${item.body} · ` : ""}${timeLabel(item.created_at)}` }))))
    : [el("p", { class: "muted", text: "You're all caught up. New messages and birthdays show up here." })]));
  const markAll = async () => {
    await supabase.from("hub_notifications").update({ read_at: now() }).eq("user_id", state.user.id).is("read_at", null);
    list.querySelectorAll(".notification").forEach((row) => row.classList.add("is-read"));
    refreshUnread();
  };
  const body = el("div", {},
    el("div", { class: "notification-tools" }, el("button", { class: "btn small ghost", type: "button", onclick: markAll }, "Mark all as read"), browserNotificationControl()),
    list);
  await ask({ title: "Notifications", body, okLabel: "Close", cancelLabel: null });
}

// Like the original app: when you open SpiritHUB on a classmate's birthday, you get a reminder for each shared workspace.
async function checkBirthdays() {
  const ids = state.workspaces.map((workspace) => workspace.id);
  if (!ids.length) return;
  const today = new Date();
  const { data, error } = await supabase.from("hub_members").select("workspace_id, user_id, profile:hub_profiles(*)").in("workspace_id", ids);
  if (error) return;
  const rows = data
    .filter((row) => row.user_id !== state.user.id && isBirthday(row.profile))
    .map((row) => ({
      user_id: state.user.id,
      workspace_id: row.workspace_id,
      kind: "birthday",
      event_key: `birthday:${row.workspace_id}:${row.user_id}:${today.getFullYear()}:${state.user.id}`,
      title: `It's ${row.profile.display_name}'s birthday! 🎂`,
      body: `Wish them in ${state.workspaces.find((workspace) => workspace.id === row.workspace_id)?.name || "your workspace"}.`,
    }));
  if (!rows.length) return;
  await supabase.from("hub_notifications").upsert(rows, { onConflict: "event_key", ignoreDuplicates: true });
  refreshUnread();
}

/* ---------- Local AI ---------- */

async function refreshAi() {
  const result = await checkAi(state.ai.settings);
  state.ai.caps = result;
  const status = $("ai-status");
  status.dataset.state = result.ok ? "ready" : "off";
  $("ai-label").textContent = result.ok ? `Local AI: ${result.model}` : "Local AI: not connected";
  status.title = result.ok ? `Ollama ${result.version} · ${result.model}${result.vision ? " · reads images" : ""}` : "Click ⚙ to connect the model on your laptop";
  return result;
}

function aiHelp(result, model) {
  if (result.ok) {
    return [el("p", { class: "ok", text: `Connected: Ollama ${result.version}, ${result.model}${result.vision ? ", reads PDFs and screenshots." : ". Text only: screenshots need a vision model."}` })];
  }
  const localPage = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const steps = [
    el("li", {}, "Install Ollama from ", el("a", { href: "https://ollama.com/download", target: "_blank", rel: "noopener" }, "ollama.com"), " and open it."),
    el("li", {}, "In Terminal, run ", el("code", { text: `ollama pull ${model}` }), "."),
  ];
  if (!localPage) {
    steps.push(el("li", {}, "Let this site talk to Ollama. On a Mac run ",
      el("code", { text: `launchctl setenv OLLAMA_ORIGINS "${location.origin}"` }), "; on Windows run ",
      el("code", { text: `setx OLLAMA_ORIGINS "${location.origin}"` }), ". Then quit and reopen Ollama."));
  }
  const headline = result.reason === "missing-model"
    ? `Ollama is running, but ${result.model} isn't installed.`
    : result.reason === "unreachable" ? "Can't reach Ollama at that address." : result.message;
  return [el("p", { class: "bad", text: headline }), el("ol", {}, ...steps)];
}

async function openAiSettings() {
  const url = el("input", { class: "input", value: state.ai.settings.url, placeholder: AI_DEFAULTS.url, spellcheck: "false" });
  const model = el("input", { class: "input", value: state.ai.settings.model, placeholder: AI_DEFAULTS.model, spellcheck: "false" });
  const check = el("div", { class: "ai-check muted" }, "Summaries run on your own laptop with Ollama. Files go from SpiritHUB to your laptop and nowhere else.");
  const test = async () => {
    const chosen = { url: url.value.trim() || AI_DEFAULTS.url, model: model.value.trim() || AI_DEFAULTS.model };
    check.replaceChildren("Checking…");
    check.replaceChildren(...aiHelp(await checkAi(chosen), chosen.model));
  };
  const body = el("div", { class: "ai-form" },
    el("label", { class: "field" }, el("span", { text: "Ollama address (change the port if yours is different)" }), url),
    el("label", { class: "field" }, el("span", { text: "Model" }), model),
    el("button", { class: "btn", type: "button", onclick: test }, "Test connection"),
    check);
  if (!(await ask({ title: "Your local AI", body, okLabel: "Save" }))) return;
  state.ai.settings = aiSettings.save({ url: url.value.trim(), model: model.value.trim() });
  const result = await refreshAi();
  toast(result.ok ? `Connected to ${result.model}` : "Saved, but your local AI isn't reachable yet");
}

async function summarize(file) {
  if (!state.ai.caps?.ok) await refreshAi();
  if (!state.ai.caps?.ok) {
    toast("Connect the AI on your laptop first");
    return openAiSettings();
  }
  const status = el("p", { class: "muted small", text: "Downloading the file…" });
  const output = el("div", { class: "md summary-output" });
  const controller = new AbortController();
  const closed = ask({ title: `Summary · ${file.name}`, body: el("div", {}, status, output), okLabel: "Save for everyone" }).then((ok) => {
    controller.abort();
    return ok;
  });
  $("dialog-ok").disabled = true;
  let text = "";
  try {
    const { data: blob, error } = await supabase.storage.from(BUCKET).download(file.path);
    if (error) throw error;
    text = await summarizeFile(new File([blob], file.name, { type: file.mime }), {
      settings: state.ai.settings,
      caps: state.ai.caps,
      signal: controller.signal,
      onStatus: (message) => { status.textContent = message; },
      onText: (partial) => {
        output.innerHTML = markdown(partial);
        output.scrollTop = output.scrollHeight;
      },
    });
    output.innerHTML = markdown(text);
    status.textContent = `Made by ${state.ai.settings.model} on your laptop. Save it so everyone in #${state.channel.name} can read it.`;
    $("dialog-ok").disabled = false;
  } catch (error) {
    if (controller.signal.aborted) return;
    status.textContent = `Couldn't summarize: ${error.message === "Failed to fetch" ? "lost the connection to your local AI." : error.message}`;
  }
  if (!(await closed) || !text) return;
  const result = await supabase.from("hub_files").update({ summary: text }).eq("id", file.id).select().single();
  if (result.error) return toast(result.error.message);
  state.openSummaries.add(file.id);
  upsertFile(result.data);
  toast("Summary saved for everyone in the channel");
}

/* ---------- Wiring ---------- */

function closePanels() {
  $("app").classList.remove("nav-open", "members-open");
}

function toggleMenu(open = $("ws-menu").hidden) {
  if (open && !state.workspace) return;
  $("ws-menu").hidden = !open;
  $("ws-menu-btn").setAttribute("aria-expanded", String(open));
  if (!open) return;
  const admin = state.role === "admin";
  const owner = state.workspace.created_by === state.user.id;
  const hiddenFor = { invite: false, settings: !admin, semester: !admin, channel: !admin, backup: false, leave: owner, delete: !owner };
  $("ws-menu").querySelectorAll("button").forEach((button) => { button.hidden = hiddenFor[button.dataset.ws]; });
}

$("ws-menu-btn").addEventListener("click", (event) => {
  event.stopPropagation();
  toggleMenu();
});
$("ws-menu").addEventListener("click", (event) => {
  const action = event.target.closest("button")?.dataset.ws;
  if (!action) return;
  toggleMenu(false);
  ({ invite: showInvite, settings: editWorkspace, semester: addSemester, channel: () => addChannel(null), backup: downloadBackup, leave: leaveWorkspace, delete: deleteWorkspace })[action]();
});
document.addEventListener("click", (event) => {
  if (!$("ws-menu").hidden && !event.target.closest("#ws-menu")) toggleMenu(false);
  if (!event.target.closest(".composer")) togglePicker(null);
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  toggleMenu(false);
  togglePicker(null);
  closePanels();
});

$("new-workspace").addEventListener("click", createWorkspace);
$("join-workspace").addEventListener("click", joinWithCode);
$("profile-btn").addEventListener("click", editProfile);
$("notifications-btn").addEventListener("click", openNotifications);
$("reply-cancel").addEventListener("click", clearReply);
$("emoji-button").addEventListener("click", () => togglePicker("emoji"));
$("sticker-button").addEventListener("click", () => togglePicker("sticker"));
$("emoji-picker").replaceChildren(...EMOJIS.map((emoji) => el("button", { type: "button", "aria-label": emoji, onclick: () => insertEmoji(emoji) }, emoji)));
$("sticker-picker").replaceChildren(...STICKERS.map((sticker) => el("button", { type: "button", onclick: () => sendSticker(sticker) }, el("span", { text: sticker.icon }), sticker.text)));
$("gif-input").addEventListener("change", (event) => {
  const [file] = event.target.files;
  event.target.value = "";
  if (!file) return;
  if (file.type !== "image/gif") return toast("Pick a .gif file");
  if (file.size > MAX_GIF) return toast("GIFs can be up to 5 MB");
  uploadFiles([file]);
});
$("ai-settings").addEventListener("click", openAiSettings);
$("sign-out").addEventListener("click", async () => {
  if (await ask({ title: "Sign out?", body: "You can sign back in on any device with your email and password.", okLabel: "Sign out" })) await supabase.auth.signOut();
});
$("menu-toggle").addEventListener("click", () => $("app").classList.toggle("nav-open"));
$("members-toggle").addEventListener("click", () => $("app").classList.toggle("members-open"));
$("scrim").addEventListener("click", closePanels);
document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => state.channel && setTab(tab.dataset.tab)));

$("file-input").addEventListener("change", (event) => {
  uploadFiles([...event.target.files]);
  event.target.value = "";
});
$("message-input").addEventListener("paste", (event) => {
  const files = [...(event.clipboardData?.files || [])];
  if (!files.length) return;
  event.preventDefault();
  uploadFiles(files);
});
const main = document.querySelector(".main");
main.addEventListener("dragover", (event) => {
  if (!state.channel && state.view !== "memories") return;
  event.preventDefault();
  $("composer").classList.add("is-dragging");
});
main.addEventListener("dragleave", (event) => {
  if (!main.contains(event.relatedTarget)) $("composer").classList.remove("is-dragging");
});
main.addEventListener("drop", (event) => {
  if (!state.channel && state.view !== "memories") return;
  event.preventDefault();
  $("composer").classList.remove("is-dragging");
  const files = [...(event.dataTransfer?.files || [])];
  if (state.view === "memories") uploadMemories(files);
  else uploadFiles(files);
});

window.addEventListener("hashchange", async () => {
  if (!readInviteFromUrl()) return;
  if (!state.profile) return showInvitePreview();
  await acceptInvite();
  await loadWorkspaces();
  renderRail();
  if (!state.joined) return;
  const id = state.joined;
  state.joined = null;
  await openWorkspace(id);
  toast("You joined the workspace");
});

if (!configured) {
  $("setup").hidden = false;
} else {
  if (!readInviteFromUrl()) state.invite = session.get(INVITE_KEY);
  let sessionQueue = Promise.resolve();
  supabase.auth.onAuthStateChange((event, current) => {
    // Supabase runs this while holding its auth lock; queue our queries for afterwards, one session change at a time.
    setTimeout(() => {
      sessionQueue = sessionQueue.then(() => handleSession(current?.user || null));
    }, 0);
  });
}
