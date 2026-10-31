// SpiritHUB workspaces: Discord-style class spaces (workspace → semesters → subject channels) on Supabase.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { AI_DEFAULTS, aiSettings, askLocalAi, checkAi, markdown, readForAi, summarizeFile, textBudget } from "./ai.js";
import * as backup from "./backup.js";

const BUCKET = "hub-files";
const FILE_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_FILE = 50 * 1024 * 1024;
const PAGE_SIZE = 150;
const STORAGE_LIMIT = 100 * 1024 * 1024; // per workspace, like the original rooms; the database enforces it too
const MAX_GIF = 5 * 1024 * 1024; // chat GIFs, like the original app
const MEMORY_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const FULL_MESSAGE = "This workspace is at its 100 MB storage limit. An admin can free up space in the Admin panel.";
// Photos and screenshots over 1 MB are shrunk before upload so the free storage lasts; GIFs and PDFs stay as they are.
const SHRINK_OVER = 1024 * 1024;
const MAX_PHOTO_EDGE = 2048;
const BACKUP_EVERY = 5 * 60 * 1000; // how often each device refreshes its backup while SpiritHUB is open
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
  onlineMembers: new Set(),
  presenceByMember: new Map(),
  presenceMeta: { seen_channel_id: null, seen_at: null },
  typingByMember: new Map(),
  isTyping: false,
  lastTypingSignal: 0,
  typingStopTimer: null,
  presenceTrackTimer: null,
  lastPresenceTrack: 0,
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
  view: "channel", // or "memories" or "admin"
  replyTo: null,
  reactions: [],
  memories: [],
  unread: 0,
  channelUnread: new Map(),
  unreadMarker: null,
  notifications: null,
  workspaceRealtime: null,
  aiPicked: new Set(), // files the Ask AI chat reads in full
  aiFileCache: new Map(),
  aiThreads: new Map(),
  aiBusy: false,
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
const channelDisplayName = (raw) => String(raw || "").replace(/[-_]+/gu, " ").replace(/\s+/gu, " ").trim();
const hiddenMessagesKey = () => `hiddenMessages:${state.user?.id || ""}:${state.workspace?.id || ""}`;
function hideMessageForMe(message) {
  const ids = local.get(hiddenMessagesKey()) || [];
  if (!ids.includes(message.id)) local.set(hiddenMessagesKey(), [...ids, message.id].slice(-3000));
  renderMessages();
  toast("Message hidden for you");
}

const channelName = (raw) => raw.trim().replace(/\s+/gu, " ").slice(0, 40);
const inviteLink = (code) => `${location.origin}${location.pathname}#join=${code}`;
const field = (label, input) => el("label", { class: "field" }, el("span", { text: label }), input);
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
    pruneNotifications();
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
  renderMyAvatar();
  renderRail();
}

/* ---------- Loading data ---------- */

function unsubscribe() {
  if (state.realtime) supabase.removeChannel(state.realtime);
  state.realtime = null;
}

function resetWorkspace() {
  stopTyping();
  unsubscribe();
  if (state.workspaceRealtime) supabase.removeChannel(state.workspaceRealtime);
  clearTimeout(state.typingStopTimer);
  clearTimeout(state.presenceTrackTimer);
  Object.assign(state, { workspace: null, role: null, semesters: [], channels: [], members: new Map(), onlineMembers: new Set(), presenceByMember: new Map(), presenceMeta: { seen_channel_id: null, seen_at: null }, typingByMember: new Map(), isTyping: false, lastTypingSignal: 0, typingStopTimer: null, presenceTrackTimer: null, lastPresenceTrack: 0, channel: null, messages: [], files: [], storageUsed: 0, view: "channel", reactions: [], memories: [], channelUnread: new Map(), unreadMarker: null, workspaceRealtime: null, aiPicked: new Set() });
  $("me-online").hidden = true;
  $("storage").hidden = true;
  $("backup-status").hidden = true;
  $("chat-view").classList.remove("has-background");
  $("memories-view").hidden = true;
  $("admin-view").hidden = true;
  $("ai-view").hidden = true;
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

let memberLoad = null;

async function loadMembers(workspaceId = state.workspace?.id) {
  if (!workspaceId) return;
  if (memberLoad?.workspaceId === workspaceId) return memberLoad.promise;
  const promise = (async () => {
    const { data, error } = await supabase.from("hub_members").select("user_id, role, profile:hub_profiles(*)").eq("workspace_id", workspaceId);
    if (error) throw error;
    if (state.workspace?.id !== workspaceId) return;
    state.members = new Map(data.map((row) => [row.user_id, {
      user_id: row.user_id,
      role: row.role,
      display_name: row.profile?.display_name || "Member",
      birth_month: row.profile?.birth_month ?? null,
      birth_day: row.profile?.birth_day ?? null,
      avatar_path: row.profile?.avatar_path ?? null,
    }]));
    state.role = state.members.get(state.user.id)?.role || null;
  })();
  memberLoad = { workspaceId, promise };
  try { return await promise; }
  finally { if (memberLoad?.promise === promise) memberLoad = null; }
}

async function loadChannelUnread(workspaceId) {
  const unreadByChannel = new Map();
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.from("hub_notifications").select("channel_id, event_key, created_at")
      .eq("user_id", state.user.id).eq("workspace_id", workspaceId).is("read_at", null)
      .not("channel_id", "is", null).order("created_at", { ascending: true }).range(offset, offset + 999);
    // Notifications were added by update 002; keep the hub usable if that optional table isn't installed.
    if (error) return new Map();
    for (const row of data) {
      const current = unreadByChannel.get(row.channel_id) || { count: 0, createdAt: row.created_at, messageId: row.event_key?.split(":")[1] || null };
      current.count += 1;
      unreadByChannel.set(row.channel_id, current);
    }
    if (data.length < 1000) break;
    offset += data.length;
  }
  return unreadByChannel;
}

async function openWorkspace(id) {
  const workspace = state.workspaces.find((candidate) => candidate.id === id);
  if (!workspace) return;
  resetWorkspace();
  state.workspace = workspace;
  closePanels();
  renderRail();
  renderBackground();
  $("ws-name").textContent = workspace.name;
  $("channel-tree").replaceChildren(el("p", { class: "loading", text: "Loading…" }));
  try {
    const [semesters, channels, , channelUnread] = await Promise.all([
      supabase.from("hub_semesters").select("*").eq("workspace_id", id).order("position").order("created_at"),
      supabase.from("hub_channels").select("*").eq("workspace_id", id).order("position").order("created_at"),
      loadMembers(),
      loadChannelUnread(id),
    ]);
    if (semesters.error) throw semesters.error;
    if (channels.error) throw channels.error;
    if (state.workspace?.id !== id) return;
    state.semesters = semesters.data;
    state.channels = channels.data;
    state.channelUnread = channelUnread;
  } catch (error) {
    toast(error.message);
    return;
  }
  const last = local.get(LAST_KEY) || {};
  local.set(LAST_KEY, { ...last, workspace: id });
  renderSidebar();
  renderMembers();
  refreshStorage();
  subscribeWorkspace(id);
  showBackupStatus(id);
  setTimeout(() => backupNow(id), 2000); // after the channel has loaded
  const channel = state.channels.find((candidate) => candidate.id === last.channels?.[id]) || orderedChannels()[0];
  if (channel) await openChannel(channel.id);
  else showEmpty("channel");
}

async function openChannel(id) {
  const channel = state.channels.find((candidate) => candidate.id === id);
  if (!channel) return;
  stopTyping();
  unsubscribe();
  const unreadAtOpen = state.channelUnread.get(id);
  state.unreadMarker = unreadAtOpen?.messageId || null;
  Object.assign(state, { channel, messages: [], files: [], reactions: [], view: "channel", aiPicked: new Set() });
  clearReply();
  closePanels();
  const last = local.get(LAST_KEY) || {};
  local.set(LAST_KEY, { ...last, workspace: state.workspace.id, channels: { ...(last.channels || {}), [state.workspace.id]: id } });
  $("empty-main").hidden = true;
  $("memories-view").hidden = true;
  $("admin-view").hidden = true;
  refreshStorage();
  setTab("chat");
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
  if (state.unreadMarker && !state.messages.some((message) => message.id === state.unreadMarker)) {
    const marker = await supabase.from("hub_messages").select("created_at").eq("id", state.unreadMarker).maybeSingle();
    if (state.channel?.id !== id) return;
    if (!marker.error && marker.data) {
      const fromUnread = await supabase.from("hub_messages").select("*").eq("channel_id", id)
        .gte("created_at", marker.data.created_at).order("created_at", { ascending: true }).limit(PAGE_SIZE);
      if (state.channel?.id !== id) return;
      if (!fromUnread.error && fromUnread.data.some((message) => message.id === state.unreadMarker)) state.messages = fromUnread.data;
    }
  }
  if (state.unreadMarker && !state.messages.some((message) => message.id === state.unreadMarker)) state.unreadMarker = null;
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
  const unreadMessageId = state.unreadMarker;
  if (unreadMessageId && $("messages").querySelector(`[data-id="${unreadMessageId}"]`)) jumpTo(unreadMessageId);
  $("message-input").focus({ preventScroll: true });
  markChannelRead(id);
  updateSeenPresence();
}

// Uploads and archiving by anyone, in any channel, move the storage meter.
let storageRefreshTimer = null;
function scheduleStorageRefresh() {
  clearTimeout(storageRefreshTimer);
  storageRefreshTimer = setTimeout(() => {
    storageRefreshTimer = null;
    if (document.visibilityState === "visible") refreshStorage();
  }, 250);
}

function subscribeWorkspace(workspaceId) {
  if (state.workspaceRealtime) supabase.removeChannel(state.workspaceRealtime);
  const filter = `workspace_id=eq.${workspaceId}`;
  const channel = supabase
    .channel(`hub-workspace-${workspaceId}`, { config: { presence: { key: state.user.id }, broadcast: { self: false, ack: true } } })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "hub_files", filter }, scheduleStorageRefresh)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "hub_files", filter }, ({ new: row }) => row.archived_at && scheduleStorageRefresh())
    .on("broadcast", { event: "typing" }, ({ payload }) => {
      if (state.workspace?.id !== workspaceId || !payload?.user_id || payload.user_id === state.user?.id) return;
      if (payload.typing && payload.channel_id) state.typingByMember.set(payload.user_id, { channel_id: payload.channel_id, expires_at: Date.now() + 2400 });
      else state.typingByMember.delete(payload.user_id);
      renderTypingIndicator();
    })
    .on("presence", { event: "sync" }, () => {
      if (state.workspace?.id !== workspaceId) return;
      const presence = channel.presenceState();
      state.onlineMembers = new Set(Object.values(presence).flatMap((entries) => entries.map((entry) => entry.user_id).filter(Boolean)));
      state.presenceByMember = new Map();
      for (const entries of Object.values(presence)) for (const entry of entries) {
        if (!entry.user_id) continue;
        const current = state.presenceByMember.get(entry.user_id) || {};
        if (Number(entry.typing_until) > Number(current.typing_until || 0)) current.typing_until = entry.typing_until;
        if (entry.typing_channel_id) current.typing_channel_id = entry.typing_channel_id;
        if (entry.seen_channel_id && entry.seen_at && (!current.seen_at || Date.parse(entry.seen_at) > Date.parse(current.seen_at))) {
          current.seen_channel_id = entry.seen_channel_id;
          current.seen_at = entry.seen_at;
        }
        state.presenceByMember.set(entry.user_id, current);
      }
      $("me-online").hidden = !state.onlineMembers.has(state.user.id);
      renderMembers();
      renderTypingIndicator();
      scheduleMessageRender();
    });
  state.workspaceRealtime = channel;
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED" && state.workspace?.id === workspaceId) {
      trackPresence();
    }
  });
}

function trackPresence() {
  if (!state.workspaceRealtime || !state.user) return;
  const wait = 650 - (Date.now() - state.lastPresenceTrack);
  if (wait > 0) {
    clearTimeout(state.presenceTrackTimer);
    state.presenceTrackTimer = setTimeout(() => trackPresence(), wait);
    return;
  }
  clearTimeout(state.presenceTrackTimer);
  state.presenceTrackTimer = null;
  state.lastPresenceTrack = Date.now();
  state.workspaceRealtime.track({ user_id: state.user.id, ...state.presenceMeta }).catch(() => {});
}

function updateTypingPresence() {
  const input = $("message-input");
  const typing = Boolean(state.channel && input?.value.trim());
  if (!typing) return stopTyping();
  const now = Date.now();
  if (!state.isTyping || now - state.lastTypingSignal > 700) {
    state.isTyping = true;
    state.lastTypingSignal = now;
    state.workspaceRealtime?.send({ type: "broadcast", event: "typing", payload: { user_id: state.user.id, channel_id: state.channel.id, typing: true } }).catch(() => {});
  }
  renderTypingIndicator();
  clearTimeout(state.typingStopTimer);
  state.typingStopTimer = setTimeout(stopTyping, 1800);
}

function stopTyping() {
  clearTimeout(state.typingStopTimer);
  state.typingStopTimer = null;
  if (!state.isTyping) return;
  state.isTyping = false;
  const channelId = state.channel?.id;
  if (channelId) state.workspaceRealtime?.send({ type: "broadcast", event: "typing", payload: { user_id: state.user.id, channel_id: channelId, typing: false } }).catch(() => {});
  renderTypingIndicator();
}

function renderTypingIndicator() {
  const node = $("typing-indicator");
  if (!node) return;
  const now = Date.now();
  for (const [userId, presence] of state.typingByMember) if (presence.expires_at <= now) state.typingByMember.delete(userId);
  const typing = [...state.typingByMember.entries()]
    .filter(([userId, presence]) => userId !== state.user?.id && presence.channel_id === state.channel?.id && presence.expires_at > now)
    .map(([userId]) => nameOf(userId));
  node.hidden = !typing.length || state.tab !== "chat";
  node.textContent = !typing.length ? "" : typing.length === 1 ? `${typing[0]} is typing…` : typing.length === 2 ? `${typing[0]} and ${typing[1]} are typing…` : `${typing.length} people are typing…`;
}

function updateSeenPresence() {
  if (!state.channel || document.visibilityState !== "visible" || !$("messages")) return;
  const viewport = $("messages").getBoundingClientRect();
  const visible = [...$("messages").querySelectorAll(".message[data-id]")]
    .filter((node) => { const rect = node.getBoundingClientRect(); return rect.bottom > viewport.top && rect.top < viewport.bottom; })
    .at(-1);
  const message = visible && state.messages.find((item) => item.id === visible.dataset.id);
  if (!message) return;
  const seenAt = message.created_at;
  if (state.presenceMeta.seen_channel_id === state.channel.id && state.presenceMeta.seen_at && state.presenceMeta.seen_at >= seenAt) return;
  state.presenceMeta.seen_channel_id = state.channel.id;
  state.presenceMeta.seen_at = seenAt;
  trackPresence();
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

let messageRenderFrame = 0;
function scheduleMessageRender() {
  if (messageRenderFrame) return;
  messageRenderFrame = requestAnimationFrame(() => {
    messageRenderFrame = 0;
    renderMessages();
    updateSeenPresence();
  });
}

function dropMessage(id) {
  forgetLocally("messages", { id });
  if (!state.messages.some((message) => message.id === id)) return;
  state.messages = state.messages.filter((message) => message.id !== id);
  scheduleMessageRender();
}

function addReaction(row) {
  if (row.channel_id !== state.channel?.id || state.reactions.some((reaction) => reaction.id === row.id)) return;
  state.reactions.push(row);
  scheduleMessageRender();
}

function removeReaction(id) {
  const before = state.reactions.length;
  state.reactions = state.reactions.filter((reaction) => reaction.id !== id);
  if (state.reactions.length !== before) scheduleMessageRender();
}

function addMessage(row) {
  backup.saveRows("messages", [row]).catch(() => {}); // live messages go straight into this device's backup
  if (row.channel_id !== state.channel?.id || state.messages.some((message) => message.id === row.id)) return;
  state.messages.push(row);
  if (!state.members.has(row.user_id)) {
    // Someone new joined since the member list loaded.
    const workspaceId = state.workspace?.id;
    loadMembers(workspaceId).then(() => {
      if (state.workspace?.id !== workspaceId) return;
      renderMembers();
      renderSidebar();
      scheduleMessageRender();
    }).catch(() => {});
  }
  scheduleMessageRender();
}

function upsertFile(row) {
  backup.saveRows("files", [row]).catch(() => {});
  if (row.channel_id !== state.channel?.id) return;
  if (row.archived_at) state.aiPicked.delete(row.id);
  const index = state.files.findIndex((file) => file.id === row.id);
  if (index >= 0) state.files[index] = row;
  else state.files.unshift(row);
  scheduleMessageRender();
  renderFiles();
  renderHeader();
}

/* ---------- Rendering ---------- */

function renderRail() {
  $("rail-list").replaceChildren(...state.workspaces.map((workspace) => el("button", {
    class: `rail-btn${workspace.id === state.workspace?.id ? " is-active" : ""}${workspace.icon_path ? " has-photo" : ""}`,
    type: "button",
    title: workspace.name,
    "aria-label": workspace.name,
    onclick: () => openWorkspace(workspace.id),
  }, workspaceIcon(workspace))));
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
  const channelRow = (channel) => {
    const unread = state.channelUnread.get(channel.id)?.count || 0;
    const channelName = channelDisplayName(channel.name);
    return el("div", { class: `channel${channel.id === state.channel?.id ? " is-active" : ""}` },
      el("button", {
        class: "channel-link", type: "button", title: `${channelName}${unread ? ` · ${unread} unread message${unread === 1 ? "" : "s"}` : ""}`,
        "aria-label": `${channelName}${unread ? `, ${unread} unread message${unread === 1 ? "" : "s"}` : ""}`,
        onclick: () => openChannel(channel.id),
      },
        el("span", { class: "hash", text: "•" }),
        el("span", { class: "channel-copy" },
          el("span", { class: "channel-label", text: channelName }),
          channel.course_code ? el("span", { class: "channel-code-mini", text: channel.course_code }) : null),
        unread ? el("span", { class: "channel-unread", text: unread > 99 ? "99+" : String(unread), "aria-hidden": "true" }) : null),
      admin ? rowActions([[`Edit ${channelName}`, "✎", () => editChannel(channel)], [`Delete ${channelName}`, "✕", () => deleteChannel(channel)]]) : null);
  };
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
  const special = state.workspace && { memories: ["📷", "Memories"], admin: ["🛠", "Admin panel"] }[state.view];
  document.querySelector(".channel-title").hidden = !channel && !special;
  document.querySelector(".tabs").hidden = !channel;
  const channelMark = $("channel-hash");
  channelMark.classList.toggle("team-logo", Boolean(channel && !special));
  if (special) channelMark.textContent = special[0];
  else if (channel) {
    const teamIcon = $("members-toggle").querySelector("svg").cloneNode(true);
    teamIcon.querySelector("circle")?.remove();
    channelMark.replaceChildren(teamIcon);
  }
  else channelMark.replaceChildren();
  channelMark.hidden = !channel && !special;
  $("channel-name").textContent = special ? special[1] : channelDisplayName(channel?.name || "");
  $("channel-sem").textContent = channel?.semester_id ? state.semesters.find((semester) => semester.id === channel.semester_id)?.name || "" : "";
  $("channel-code").textContent = channel?.course_code || "";
  $("message-input").placeholder = "Message";
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
  $("ai-view").hidden = tab !== "ai";
  if (tab === "ai") renderAiView();
  renderHeader();
  renderTypingIndicator();
}

function showEmpty(kind) {
  unsubscribe();
  Object.assign(state, { channel: null, messages: [], files: [], reactions: [], view: "channel" });
  $("chat-view").hidden = true;
  $("files-view").hidden = true;
  $("ai-view").hidden = true;
  $("memories-view").hidden = true;
  $("admin-view").hidden = true;
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

// Archived files (update 004) were moved off Supabase to free up space; their name, sharer and AI summary
// stay, and they still open on devices whose backup has them.
function fileCard(file, full = false) {
  const archived = Boolean(file.archived_at);
  const image = file.mime.startsWith("image/") && !archived;
  const details = full ? `${formatSize(file.size)} · ${nameOf(file.user_id)} · ${timeLabel(file.created_at)}` : formatSize(file.size);
  const note = el("small", { text: archived ? `${details} · archived to free up space` : details });
  const actions = el("div", { class: "file-actions" }, ...(archived ? [] : [
    el("button", { class: "btn small ghost", type: "button", onclick: () => openFile(file) }, "Open"),
    el("button", { class: "btn small", type: "button", onclick: () => summarize(file) }, file.summary ? "Summarize again" : "Summarize"),
  ]));
  const card = el("div", { class: `file-card${full ? " full" : ""}${archived ? " is-archived" : ""}` },
    archived ? el("span", { class: "file-icon", text: "📦", "aria-hidden": "true" })
      : image ? el("img", { class: "file-thumb", alt: "", loading: "lazy" }) : el("span", { class: "file-icon", text: "PDF" }),
    el("div", { class: "file-info" }, el("strong", { text: file.name, title: file.name }), note),
    actions,
    file.summary ? summaryDetails(file) : null);
  if (image) fileUrl(file).then((url) => { card.querySelector("img").src = url; }).catch(() => {});
  if (archived) {
    backup.fileBlob(file.path).then((blob) => {
      if (!blob) return;
      note.textContent = `${details} · archived, saved on this device`;
      actions.append(el("button", { class: "btn small ghost", type: "button", onclick: () => openFile(file) }, "Open"));
    }).catch(() => {});
  }
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
  fileUrl(file).then((url) => { image.src = url; }).catch(() => {});
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
    onclick: () => showReactionDetails(message, emoji),
  }, emoji, el("span", { text: String(names.length) }))));
}

function showReactionDetails(message, emoji) {
  const names = state.reactions
    .filter((reaction) => reaction.message_id === message.id && reaction.emoji === emoji)
    .map((reaction) => nameOf(reaction.user_id));
  const body = names.length
    ? el("div", { class: "reaction-details" }, ...names.map((name) => el("div", { class: "reaction-person" }, el("span", { class: "avatar small", text: initials(name) }), el("span", { text: name }))))
    : el("p", { class: "muted", text: "No reactions yet." });
  ask({ title: `${emoji} Reactions`, body, okLabel: "Done", cancelLabel: null });
}

function showSeenBy(names) {
  const body = el("div", { class: "seen-list" },
    el("p", { class: "muted small", text: "Live receipts from workspace members currently online who have reached this message." }),
    ...names.map((name) => el("div", { class: "reaction-person" }, el("span", { class: "avatar small", text: initials(name) }), el("span", { text: name }))));
  ask({ title: "Seen by", body, okLabel: "Done", cancelLabel: null });
}

function messageNode(message, grouped, reactions) {
  const name = nameOf(message.user_id);
  const file = message.file_id ? state.files.find((candidate) => candidate.id === message.file_id) : null;
  const canDelete = message.user_id === state.user.id || state.role === "admin";
  const replied = message.reply_to_id ? state.messages.find((candidate) => candidate.id === message.reply_to_id) : null;
  const mentions = message.body && message.kind !== "sticker" ? findMentions(message.body) : [];
  const forMe = mentions.some((found) => found.user_id === state.user.id || found.user_ids?.includes(state.user.id)) || Boolean(message.mentions?.includes(state.user.id));
  const seenBy = message.user_id === state.user.id
    ? [...state.presenceByMember.entries()].filter(([userId, presence]) => userId !== state.user.id && presence.seen_channel_id === message.channel_id && Date.parse(presence.seen_at) >= Date.parse(message.created_at)).map(([userId]) => nameOf(userId))
    : [];
  const node = el("article", { class: `message${message.user_id === state.user.id ? " own" : ""}${grouped ? " grouped" : ""}${forMe ? " mentions-me" : ""}`, "data-id": message.id },
    grouped
      ? el("time", { class: "msg-time-gutter", datetime: message.created_at, text: shortTime(message.created_at) })
      : avatarNode(personOf(message.user_id)),
    el("div", { class: "msg-main" },
      message.reply_to_id
        ? el("button", { class: "quote", type: "button", title: "Show the original message", onclick: () => jumpTo(message.reply_to_id) }, "↪",
          replied ? [el("strong", { text: nameOf(replied.user_id) }), el("span", { text: preview(replied) })] : el("span", { text: "Earlier message" }))
        : null,
      grouped ? null : el("div", { class: "msg-meta" }, el("strong", { text: name }), el("time", { datetime: message.created_at, text: timeLabel(message.created_at) })),
      forMe ? el("span", { class: "mention-label", text: "Mentioned you" }) : null,
      message.kind === "sticker" ? stickerNode(message.body) : message.body ? bodyNode(message.body, mentions) : null,
      file ? (file.mime === "image/gif" && !file.archived_at ? gifNode(file) : fileCard(file)) : message.file_id ? el("p", { class: "muted small", text: "Uploading…" }) : null,
      seenBy.length ? el("button", { class: "message-seen", type: "button", title: `Seen by ${seenBy.join(", ")}`, "aria-label": `Seen by ${seenBy.length} ${seenBy.length === 1 ? "member" : "members"}`, onclick: () => showSeenBy(seenBy) }, seenBy.length === 1 ? `Seen by ${seenBy[0]}` : `Seen by ${seenBy.length} members`) : null,
      reactions?.length ? reactionsRow(message, reactions) : null),
    el("div", { class: "msg-actions" },
      el("button", { class: "text", type: "button", title: "Reply", onclick: () => setReply(message) }, "Reply"),
      ...QUICK_REACTIONS.map((emoji) => el("button", { type: "button", title: `React with ${emoji}`, "aria-label": `React with ${emoji}`, onclick: () => toggleReaction(message, emoji) }, emoji)),
      message.user_id === state.user.id
        ? [
            el("button", { class: "text", type: "button", title: "Delete for me", onclick: () => hideMessageForMe(message) }, "Delete for me"),
            el("button", { class: "text danger-text", type: "button", title: "Unsend for everyone", onclick: () => deleteMessage(message, file, true) }, "Unsend")
          ]
        : state.role === "admin"
          ? el("button", { class: "text danger-text", type: "button", title: "Delete for everyone", onclick: () => deleteMessage(message, file, true) }, "Delete")
          : null));
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
  const hiddenIds = new Set(local.get(hiddenMessagesKey()) || []);
  const visibleMessages = state.messages.filter((message) => !hiddenIds.has(message.id));
  const nodes = [];
  if (visibleMessages.length < PAGE_SIZE) {
    nodes.push(el("div", { class: "channel-intro" },
      el("div", { class: "intro-hash", text: "💬", "aria-hidden": "true" }),
      el("h3", { text: `Welcome to ${channelDisplayName(state.channel.name)}${state.channel.course_code ? ` · ${state.channel.course_code}` : ""}` }),
      el("p", { class: "muted", text: "Share notes, PDFs and screenshots here. Everyone in the workspace can see them, and anyone can save an AI summary of a file for the rest." })));
  }
  const reactionsByMessage = new Map();
  for (const reaction of state.reactions) {
    if (!reactionsByMessage.has(reaction.message_id)) reactionsByMessage.set(reaction.message_id, []);
    reactionsByMessage.get(reaction.message_id).push(reaction);
  }
  let previous = null;
  for (const message of visibleMessages) {
    // A reply always shows its author, so its quote reads naturally.
    const grouped = !message.reply_to_id && previous?.user_id === message.user_id && new Date(message.created_at) - new Date(previous.created_at) < 5 * 60 * 1000;
    if (message.id === state.unreadMarker) nodes.push(el("div", { class: "unread-divider", role: "separator" }, el("span", { text: "Unread messages" })));
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
    el("div", { class: "files-top" }, el("h3", { text: `Files in ${channelDisplayName(state.channel.name)}` }), el("label", { class: "btn primary small" }, "Upload", picker)),
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
    el("span", { class: "member-avatar-wrap" },
      avatarNode(member, "small"),
      state.onlineMembers.has(member.user_id) ? el("span", { class: "presence-dot", title: "Online", role: "img", "aria-label": "Online" }) : null),
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
  const icon = photoField("Workspace photo (shown in the left bar instead of its initials)", workspace.icon_path);
  const background = photoField("Chat background (shows faintly behind every channel's chat)", workspace.background_path);
  const body = el("div", { class: "dialog-fields" }, field("Workspace name", name), field("Academic year (optional)", year), icon.node, background.node);
  if (!(await ask({ title: "Workspace settings", body, okLabel: "Save" }))) return;
  const changes = { name: name.value.trim() || workspace.name, academic_year: year.value.trim() || null };
  let photos;
  try {
    photos = await savePhotos(`${workspace.id}/workspace`, [
      { key: "icon_path", picker: icon, kind: "icon", edge: 256, square: true },
      { key: "background_path", picker: background, kind: "background", edge: 1600, square: false },
    ]);
  } catch (error) {
    return toast(`Couldn't upload the photo: ${error.message}`);
  }
  Object.assign(changes, photos.values);
  const result = await supabase.from("hub_workspaces").update(changes).eq("id", workspace.id).select("id");
  if (result.error && /icon_path|background_path/.test(result.error.message)) {
    removeUploads(photos.uploaded);
    return toast("Workspace photos need update 005. Ask the Supabase project owner to run it.");
  }
  if (failed(result, "Only admins can change workspace settings.")) return removeUploads(photos.uploaded);
  removeUploads(Object.keys(photos.values).map((key) => workspace[key]).filter(Boolean)); // the photos they replaced
  Object.assign(workspace, changes);
  renderRail();
  renderSidebar();
  renderBackground();
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
  const gone = state.workspace.id;
  Promise.resolve(backupRuns.get(gone)).then(() => backup.forgetWorkspace(gone)).catch(() => {}); // after any backup still running for it
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
  const photos = [state.workspace.icon_path, state.workspace.background_path].filter(Boolean);
  await removePaths([...(await filePaths((query) => query.eq("workspace_id", state.workspace.id))), ...memoryRows.map((row) => row.path), ...photos]);
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
  if (state.view !== "channel") return;
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
  const name = el("input", { class: "input", maxlength: 40, value: channel ? channelDisplayName(channel.name) : "", placeholder: "e.g. Data Structures or Web Design", required: true });
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
  const details = await channelDetails({ title: `Edit ${channel.name}`, okLabel: "Save", channel });
  if (!details || (details.name === channel.name && details.course_code === (channel.course_code || null))) return;
  const result = await supabase.from("hub_channels").update(details).eq("id", channel.id).select("id");
  if (failed(result, "Only admins can edit channels.")) return;
  Object.assign(channel, details);
  renderSidebar();
  renderHeader();
  renderMessages();
}

async function deleteChannel(channel) {
  if (!(await ask({ title: `Delete ${channelDisplayName(channel.name)}?`, body: "All its messages and files are deleted for everyone.", okLabel: "Delete", danger: true }))) return;
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
  updateTypingPresence();
  closeMentionPicker();
  const row = { workspace_id: state.workspace.id, channel_id: state.channel.id, body };
  if (state.replyTo) row.reply_to_id = state.replyTo.id;
  const mentions = [...new Set(findMentions(body).flatMap((found) => found.user_ids || [found.user_id]))].filter((id) => id !== state.user.id);
  if (mentions.length > 50) {
    input.value = body;
    return toast("This workspace has more than 50 people to notify. The existing mention limit is 50, so this tag can't reach everyone.");
  }
  if (mentions.length) row.mentions = mentions; // they get a "mentioned you" notification
  let { data, error } = await supabase.from("hub_messages").insert(row).select().single();
  if (error && row.mentions && /mentions/.test(error.message)) {
    delete row.mentions; // before update 004 the message still goes out, just without mention notifications
    ({ data, error } = await supabase.from("hub_messages").insert(row).select().single());
  }
  if (error) {
    input.value = body;
    return toast(error.message);
  }
  clearReply();
  addMessage(data);
});

// Redraws an image as a JPEG at most `edge` pixels on its longer side, optionally cropped to a centred square.
async function resizeImage(file, edge, { square = false, fill = "#fff" } = {}) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const [sx, sy, sw, sh] = square ? [(bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side] : [0, 0, bitmap.width, bitmap.height];
  const scale = Math.min(1, edge / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const context = canvas.getContext("2d");
  context.fillStyle = fill; // transparent parts would otherwise turn black in a JPEG
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("this photo couldn't be read");
  return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg" });
}

// Returns a smaller JPEG for big photos and screenshots, or the file itself when shrinking wouldn't help.
async function shrinkImage(file) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size <= SHRINK_OVER) return file;
  try {
    const smaller = await resizeImage(file, MAX_PHOTO_EDGE);
    return smaller.size <= file.size * 0.8 ? smaller : file;
  } catch {
    return file;
  }
}

const uploadingLabel = (file, original) => (file === original
  ? `Uploading ${file.name}…`
  : `Uploading ${file.name}, shrunk from ${formatSize(original.size)} to ${formatSize(file.size)}…`);

async function uploadFiles(files) {
  if (!state.channel) return toast("Pick a channel first");
  const { workspace, channel } = state;
  for (const original of files) {
    if (!FILE_TYPES.includes(original.type)) {
      toast(`${original.name}: only PDFs and images (PNG, JPEG, WebP, GIF)`);
      continue;
    }
    const file = await shrinkImage(original);
    if (file.size > MAX_FILE) {
      toast(`${file.name} is over 50 MB`);
      continue;
    }
    if (state.storageUsed + file.size > STORAGE_LIMIT) {
      toast(FULL_MESSAGE);
      continue;
    }
    toast(uploadingLabel(file, original), 120000);
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
    backup.saveBlob(workspace.id, path, file).catch(() => {}); // your own uploads go into this device's backup straight away
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

// Update 004 adds archived_at to hub_files; until it's run, queries can't mention it.
let archiveCheck = null;
function hasArchiveColumn() {
  archiveCheck ||= supabase.from("hub_files").select("archived_at").limit(1).then(({ error }) => {
    if (error && error.code !== "42703" && !/archived_at/.test(error.message)) archiveCheck = null; // a network hiccup: check again next time
    return !error;
  });
  return archiveCheck;
}

const localUrls = new Map(); // storage path → address of the copy in this device's backup
let fileViewRequest = 0;

// Files show from this device's backup when it has them: nothing to download, and archived files still open.
async function fileUrl(item) {
  if (localUrls.has(item.path)) return localUrls.get(item.path);
  const blob = await backup.fileBlob(item.path).catch(() => null);
  if (blob) {
    localUrls.set(item.path, URL.createObjectURL(blob));
    return localUrls.get(item.path);
  }
  return item.archived_at ? null : signedUrl(item.path);
}

async function fileData(item) {
  const blob = await backup.fileBlob(item.path).catch(() => null);
  if (blob) return blob;
  if (item.archived_at) throw new Error("This file was archived and isn't saved on this device.");
  const { data, error } = await supabase.storage.from(BUCKET).download(item.path);
  if (error) throw error;
  return data;
}

async function openFile(file) {
  const request = ++fileViewRequest;
  const viewer = $("file-viewer");
  const content = $("file-viewer-content");
  $("file-viewer-title").textContent = file.name;
  content.replaceChildren(el("p", { class: "file-viewer-loading", text: "Opening file…", role: "status" }));
  if (!viewer.open) viewer.showModal();
  try {
    const url = await fileUrl(file);
    if (!url) throw new Error("This file was archived to free up space, and it isn't saved on this device.");
    if (request !== fileViewRequest || !viewer.open) return;
    let preview;
    if (file.mime.startsWith("image/")) {
      preview = el("img", { class: "file-viewer-image", src: url, alt: file.name });
    } else if (file.mime === "application/pdf") {
      preview = el("iframe", { class: "file-viewer-pdf", src: url, title: file.name });
    } else {
      preview = el("p", { class: "file-viewer-loading", text: "Preview is not available for this file type." });
    }
    content.replaceChildren(preview);
  } catch (error) {
    if (request === fileViewRequest && viewer.open) content.replaceChildren(el("p", { class: "file-viewer-error", text: error.message, role: "alert" }));
    toast(error.message);
  }
}

async function deleteMessage(message, file, unsend = false) {
  const body = file
    ? `The file "${file.name}" and its message will be removed for everyone.`
    : "This message will be removed for everyone and can't be restored.";
  const title = unsend ? "Unsend this message for everyone?" : "Delete this message for everyone?";
  if (!(await ask({ title, body, okLabel: unsend ? "Unsend" : "Delete", danger: true }))) return;
  if (file) {
    // Deleting the file row also deletes the message that carries it.
    const result = await supabase.from("hub_files").delete().eq("id", file.id).select("id");
    if (failed(result, "Only the uploader or an admin can delete this file.")) return;
    await supabase.storage.from(BUCKET).remove([file.path]);
    forgetLocally("files", file);
    state.files = state.files.filter((candidate) => candidate.id !== file.id);
    refreshStorage();
  } else {
    const result = await supabase.from("hub_messages").delete().eq("id", message.id).select("id");
    if (failed(result, "Only the sender or an admin can delete this message.")) return;
  }
  forgetLocally("messages", message);
  state.messages = state.messages.filter((candidate) => candidate.id !== message.id);
  renderMessages();
  renderFiles();
  renderHeader();
}

/* ---------- Storage meter (as in the original app) ---------- */

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

const sizeOf = (rows) => rows.reduce((total, row) => total + Number(row.size || 0), 0);
const countOf = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Warns from 80% so admins can free up space before uploads start failing.
function renderStorage() {
  const percent = Math.min(100, (state.storageUsed / STORAGE_LIMIT) * 100);
  $("storage").hidden = !state.workspace;
  $("storage").classList.toggle("is-near", percent >= 80 && percent < 95);
  $("storage").classList.toggle("is-full", percent >= 95);
  const warning = percent >= 100 ? " · full" : percent >= 80 ? " · almost full" : "";
  $("storage-label").textContent = `Workspace files · ${state.storageUsed ? formatSize(state.storageUsed) : "0 MB"} / 100 MB${warning}`;
  $("storage-fill").style.width = `${percent}%`;
  $("storage-meter").setAttribute("aria-valuenow", String(Math.round(percent)));
  $("free-space").hidden = !(percent >= 80 && state.role === "admin");
}

async function refreshStorage() {
  const workspaceId = state.workspace?.id;
  if (!workspaceId) return;
  try {
    const archiving = await hasArchiveColumn();
    const [live, memories] = await Promise.all([
      // Archived files no longer take up space.
      fetchAll(() => {
        const query = supabase.from("hub_files").select("size").eq("workspace_id", workspaceId);
        return archiving ? query.is("archived_at", null) : query;
      }),
      fetchAll(() => supabase.from("hub_memories").select("size").eq("workspace_id", workspaceId)).catch(() => []), // memories arrive with update 002
    ]);
    if (state.workspace?.id !== workspaceId) return;
    state.storageUsed = sizeOf(live) + sizeOf(memories);
    renderStorage();
  } catch (error) {
    toast(error.message);
  }
}

/* ---------- Backup on this device ---------- */

const backupRuns = new Map(); // workspace id → the backup running for it
let persistAsked = false;

// Every device keeps its own copy of the workspaces it opens (see backup.js). Resolves to whether it worked.
function backupNow(workspaceId = state.workspace?.id) {
  if (!workspaceId || !state.user) return Promise.resolve(false);
  if (!backupRuns.has(workspaceId)) {
    backupRuns.set(workspaceId, syncBackup(workspaceId)
      .then(() => true)
      .catch((error) => {
        setBackupStatus(workspaceId, `Backup paused: ${error.message}`, true);
        return false;
      })
      .finally(() => backupRuns.delete(workspaceId)));
  }
  return backupRuns.get(workspaceId);
}

async function syncBackup(workspaceId) {
  const record = (await backup.syncRecord(workspaceId)) || { workspace_id: workspaceId };
  // Messages: only the new ones each time. Deleted ones leave the backup within a day.
  const fresh = await fetchAll(() => {
    const query = supabase.from("hub_messages").select("*").eq("workspace_id", workspaceId).order("created_at");
    return record.last_message_at ? query.gte("created_at", record.last_message_at) : query;
  });
  await backup.saveRows("messages", fresh);
  if (fresh.length) record.last_message_at = fresh[fresh.length - 1].created_at;
  if (!record.swept_at || Date.now() - Date.parse(record.swept_at) > 86400000) {
    const ids = new Set((await fetchAll(() => supabase.from("hub_messages").select("id").eq("workspace_id", workspaceId))).map((row) => row.id));
    await backup.removeRows("messages", (await backup.keysOf("messages", workspaceId)).filter((id) => !ids.has(id)));
    record.swept_at = new Date().toISOString();
  }
  const columns = (await hasArchiveColumn()) ? "id, summarized_by, archived_at" : "id, summarized_by";
  const files = await mirror("files", workspaceId, () => fetchAll(() => supabase.from("hub_files").select(columns).eq("workspace_id", workspaceId)),
    (saved, row) => saved.summarized_by !== row.summarized_by || (saved.archived_at ?? null) !== (row.archived_at ?? null));
  const photos = await mirror("memories", workspaceId, () => fetchAll(() => supabase.from("hub_memories").select("id").eq("workspace_id", workspaceId)), () => false);
  // The files and photos themselves, each downloaded once per device.
  const saved = new Set(await backup.keysOf("blobs", workspaceId));
  const missing = [...files.filter((file) => !file.archived_at), ...photos].filter((item) => !saved.has(item.path));
  if (missing.length && !navigator.connection?.saveData) {
    if (!(await roomFor(sizeOf(missing)))) throw new Error("this device is low on space");
    for (const [index, item] of missing.entries()) {
      setBackupStatus(workspaceId, `Backing up on this device · ${index + 1} of ${missing.length}`);
      await saveOnDevice(workspaceId, item);
    }
  }
  Object.assign(record, {
    synced_at: new Date().toISOString(),
    bytes: sizeOf(await backup.rowsOf("blobs", workspaceId)),
    messages: (await backup.keysOf("messages", workspaceId)).length,
    files: files.length,
    photos: photos.length,
  });
  await backup.saveSyncRecord(record);
  showBackupStatus(workspaceId, record);
  if (!persistAsked) {
    persistAsked = true;
    navigator.storage?.persist?.().catch(() => {}); // asks the browser not to clear the backup when space runs low
  }
}

// Keeps one backup table in step with Supabase: deleted rows go, and new or changed rows are fetched in full.
async function mirror(store, workspaceId, list, changed) {
  let listed;
  try {
    listed = await list();
  } catch {
    return backup.rowsOf(store, workspaceId);
  }
  const saved = new Map((await backup.rowsOf(store, workspaceId)).map((row) => [row.id, row]));
  const ids = new Set(listed.map((row) => row.id));
  const gone = [...saved.values()].filter((row) => !ids.has(row.id));
  await backup.removeRows(store, gone.map((row) => row.id));
  await backup.removeRows("blobs", gone.map((row) => row.path)); // deleted for everyone, so not kept here either
  const wanted = listed.filter((row) => !saved.has(row.id) || changed(saved.get(row.id), row)).map((row) => row.id);
  for (let start = 0; start < wanted.length; start += 100) {
    const { data, error } = await supabase.from(store === "files" ? "hub_files" : "hub_memories").select("*").in("id", wanted.slice(start, start + 100));
    if (error) throw error;
    await backup.saveRows(store, data);
  }
  return backup.rowsOf(store, workspaceId);
}

// Something deleted for everyone leaves this device's backup too.
function forgetLocally(store, row) {
  backup.removeRows(store, [row.id]).catch(() => {});
  if (row.path) backup.removeRows("blobs", [row.path]).catch(() => {});
}

// Saves a file or photo in this device's backup unless it's already there.
async function saveOnDevice(workspaceId, item) {
  if (await backup.fileBlob(item.path)) return true;
  const { data, error } = await supabase.storage.from(BUCKET).download(item.path);
  if (error) return false;
  await backup.saveBlob(workspaceId, item.path, new Blob([data], { type: item.mime }));
  return true;
}

async function roomFor(bytes) {
  const estimate = await navigator.storage?.estimate?.().catch(() => null);
  return !estimate?.quota || estimate.quota - estimate.usage > bytes + 50 * 1024 * 1024;
}

function setBackupStatus(workspaceId, text, problem = false) {
  if (workspaceId !== state.workspace?.id) return;
  const status = $("backup-status");
  status.hidden = false;
  status.textContent = text;
  status.classList.toggle("is-problem", problem);
}

async function showBackupStatus(workspaceId, record) {
  record ||= await backup.syncRecord(workspaceId).catch(() => null);
  if (!record?.synced_at) return setBackupStatus(workspaceId, "Backing up on this device…");
  const when = new Date(record.synced_at).toDateString() === new Date().toDateString()
    ? shortTime(record.synced_at)
    : new Date(record.synced_at).toLocaleDateString([], { day: "numeric", month: "short" });
  setBackupStatus(workspaceId, `✓ Backed up on this device · ${when}`);
}

async function openBackup() {
  const workspace = state.workspace;
  if (!workspace) return;
  toast("Checking the backup…");
  await Promise.race([backupNow(workspace.id), new Promise((resolve) => setTimeout(resolve, 5000))]);
  const record = await backup.syncRecord(workspace.id).catch(() => null);
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  const body = el("div", { class: "backup-info" },
    el("p", { text: `SpiritHUB keeps a copy of ${workspace.name} in this browser and updates it every few minutes while it's open: messages, files and Memories photos. Files an admin moves off the online storage still open from here.` }),
    el("p", { class: "muted", text: record?.synced_at
      ? `${countOf(record.messages, "message")}, ${countOf(record.files, "file")} and ${countOf(record.photos, "photo")} (${record.bytes ? formatSize(record.bytes) : "0 MB"}) · updated ${timeLabel(record.synced_at)}`
      : "The first backup is still running." }),
    el("p", { class: "muted small", text: persisted
      ? "This browser keeps it even when the device runs low on space."
      : "Browsers may clear it when a device runs low on space, and Safari clears it after a week without opening SpiritHUB. Adding SpiritHUB to your home screen keeps it safer." }));
  await ask({ title: "Backup on this device", body, okLabel: "Close", cancelLabel: null });
}

/* ---------- Photos: workspace photos, chat backgrounds and profile photos ---------- */

const photoUrls = new Map(); // storage path → address of a photo that has loaded
const photoLoads = new Map(); // storage path → the load in progress

// Each photo downloads once per device; after that it comes from this device's backup.
function loadPhoto(path) {
  if (!photoLoads.has(path)) {
    photoLoads.set(path, (async () => {
      let blob = await backup.fileBlob(path).catch(() => null);
      if (!blob) {
        const { data, error } = await supabase.storage.from(BUCKET).download(path);
        if (error) throw error;
        blob = data;
        backup.saveBlob("photos", path, blob).catch(() => {});
      }
      photoUrls.set(path, URL.createObjectURL(blob));
      return photoUrls.get(path);
    })().catch((error) => {
      photoLoads.delete(path); // try again next time
      throw error;
    }));
  }
  return photoLoads.get(path);
}

const personOf = (userId) => state.members.get(userId) || { user_id: userId, display_name: nameOf(userId) };

// A round profile photo, or initials on a colour when there's none (or until it loads).
function avatarNode(person, size = "") {
  const node = el("span", { class: `avatar${size ? ` ${size}` : ""}`, style: `--hue:${hue(person.user_id)}`, "aria-hidden": "true" });
  const path = person.avatar_path;
  if (path && photoUrls.has(path)) node.append(el("img", { src: photoUrls.get(path), alt: "" }));
  else {
    node.textContent = initials(person.display_name);
    if (path) loadPhoto(path).then((url) => node.replaceChildren(el("img", { src: url, alt: "" }))).catch(() => {});
  }
  return node;
}

function renderMyAvatar() {
  const node = avatarNode({ user_id: state.user.id, display_name: state.profile.display_name, avatar_path: state.profile.avatar_path });
  node.id = "me-avatar";
  $("me-avatar").replaceWith(node);
  $("me-online").hidden = !state.onlineMembers.has(state.user.id);
}

// A workspace's photo in the left bar, or its initials when it has none.
function workspaceIcon(workspace) {
  if (!workspace.icon_path) return initials(workspace.name);
  const image = el("img", { class: "rail-photo", alt: "" });
  if (photoUrls.has(workspace.icon_path)) image.src = photoUrls.get(workspace.icon_path);
  else loadPhoto(workspace.icon_path).then((url) => { image.src = url; }).catch(() => image.replaceWith(initials(workspace.name)));
  return image;
}

// The workspace's background shows faintly behind its chats.
function renderBackground() {
  const path = state.workspace?.background_path;
  const view = $("chat-view");
  view.classList.toggle("has-background", Boolean(path));
  view.style.removeProperty("--chat-background");
  if (!path) return;
  loadPhoto(path).then((url) => {
    if (state.workspace?.background_path === path) view.style.setProperty("--chat-background", `url("${url}")`);
  }).catch(() => view.classList.remove("has-background"));
}

// A dialog row that shows the current photo and lets you choose another or remove it.
function photoField(label, path, round = false) {
  let picked = null;
  let removed = false;
  let previewUrl = null;
  const crop = { zoom: 1, x: 50, y: 50 };
  const preview = el("span", { class: `photo-preview${round ? " round" : ""}` });
  const cropControls = el("div", { class: "photo-crop-controls", hidden: true });
  const show = (url) => {
    preview.replaceChildren(url ? el("img", { src: url, alt: "Profile photo crop preview" }) : el("span", { text: "No photo selected" }));
    syncCropPreview();
  };
  function syncCropPreview() {
    const image = preview.querySelector("img");
    if (!image) return;
    image.style.objectPosition = `${crop.x}% ${crop.y}%`;
    image.style.transform = `scale(${crop.zoom})`;
  }
  if (path) loadPhoto(path).then((url) => { if (!picked && !removed) show(url); }).catch(() => {});
  const remove = el("button", { class: "link small danger", type: "button", hidden: !path }, "Remove");
  const input = el("input", { type: "file", accept: MEMORY_TYPES.join(","), hidden: true });
  const zoom = el("input", { type: "range", min: "1", max: "2.5", step: "0.05", value: "1", "aria-label": "Photo zoom" });
  const horizontal = el("input", { type: "range", min: "0", max: "100", step: "1", value: "50", "aria-label": "Move photo left or right" });
  const vertical = el("input", { type: "range", min: "0", max: "100", step: "1", value: "50", "aria-label": "Move photo up or down" });
  const zoomValue = el("span", { text: "1×" });
  const horizontalValue = el("span", { text: "50%" });
  const verticalValue = el("span", { text: "50%" });
  const resetCrop = () => {
    crop.zoom = 1; crop.x = 50; crop.y = 50;
    zoom.value = "1"; horizontal.value = "50"; vertical.value = "50";
    zoomValue.textContent = "1×"; horizontalValue.textContent = "50%"; verticalValue.textContent = "50%";
    syncCropPreview();
  };
  const setControl = (name, input, value) => el("label", { class: "photo-crop-control" },
    el("span", {}, el("span", { text: name }), value), input);
  cropControls.append(
    el("div", { class: "photo-crop-heading" }, el("strong", { text: "Adjust your profile photo" }), el("span", { text: "Frame it before you save" })),
    setControl("Zoom", zoom, zoomValue),
    setControl("Horizontal position", horizontal, horizontalValue),
    setControl("Vertical position", vertical, verticalValue),
    el("div", { class: "photo-crop-footer" },
      el("p", { class: "photo-crop-hint", text: "The circular preview shows how classmates will see it." }),
      el("button", { class: "photo-crop-reset", type: "button", onclick: resetCrop }, "Reset crop")));
  zoom.addEventListener("input", () => {
    crop.zoom = Number(zoom.value);
    zoomValue.textContent = `${crop.zoom.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}×`;
    syncCropPreview();
  });
  horizontal.addEventListener("input", () => { crop.x = Number(horizontal.value); horizontalValue.textContent = `${crop.x}%`; syncCropPreview(); });
  vertical.addEventListener("input", () => { crop.y = Number(vertical.value); verticalValue.textContent = `${crop.y}%`; syncCropPreview(); });
  input.addEventListener("change", () => {
    const [file] = input.files;
    input.value = "";
    if (!file) return;
    if (!MEMORY_TYPES.includes(file.type)) return toast("Pick a photo (PNG, JPEG, WebP or GIF)");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    [picked, removed] = [file, false];
    resetCrop();
    previewUrl = URL.createObjectURL(file);
    show(previewUrl);
    cropControls.hidden = !round;
    if (choose.firstChild) choose.firstChild.textContent = round ? "Change profile photo" : "Change photo";
    remove.hidden = false;
  });
  remove.addEventListener("click", () => {
    [picked, removed] = [null, true];
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    show(null);
    cropControls.hidden = true;
    if (choose.firstChild) choose.firstChild.textContent = round ? "Choose profile photo" : "Choose photo";
    remove.hidden = true;
  });
  const choose = el("label", { class: "btn small ghost photo-choose" }, round ? (path ? "Change profile photo" : "Choose profile photo") : (path ? "Change photo" : "Choose photo"), input);
  const photoHint = el("p", { class: "photo-field-hint", text: round
    ? "Choose a photo, then adjust the zoom and position before saving."
    : "Choose an image to preview it before saving." });
  return {
    node: el("div", { class: `field photo-field${round ? " is-croppable" : ""}` },
      el("span", { text: label }),
      el("div", { class: "photo-row" }, preview, choose, remove),
      round ? photoHint : null,
      cropControls),
    // A selected profile photo includes its framing controls for the final square crop.
    change: () => (picked ? { file: picked, crop: round ? { ...crop } : null } : removed ? { file: null } : null),
  };
}

async function uploadPhoto(folder, kind, file, edge, square) {
  const photo = await resizeImage(file, edge, { square, fill: "#101116" });
  const path = `${folder}/${kind}-${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, photo, { contentType: "image/jpeg" });
  if (error) throw error;
  backup.saveBlob("photos", path, photo).catch(() => {});
  return path;
}

// Uploads the photos a dialog changed. Resolves to the new column values and the uploaded paths,
// so a save that fails afterwards can remove them again.
async function cropSquarePhoto(file, framing, edge) {
  let source;
  let objectUrl;
  try {
    if (typeof createImageBitmap === "function") source = await createImageBitmap(file);
    else {
      objectUrl = URL.createObjectURL(file);
      source = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Couldn't read this photo"));
        image.src = objectUrl;
      });
    }
    const width = source.width || source.naturalWidth;
    const height = source.height || source.naturalHeight;
    const side = Math.min(width, height) / framing.zoom;
    const sx = (width - side) * framing.x / 100;
    const sy = (height - side) * framing.y / 100;
    const canvas = document.createElement("canvas");
    canvas.width = edge;
    canvas.height = edge;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Photo cropping isn't available in this browser");
    context.drawImage(source, sx, sy, side, side, 0, 0, edge, edge);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(
      (result) => result ? resolve(result) : reject(new Error("Couldn't prepare this photo")),
      "image/jpeg",
      0.92));
    return new File([blob], "profile-photo.jpg", { type: "image/jpeg", lastModified: Date.now() });
  } finally {
    source?.close?.();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

async function savePhotos(folder, pickers) {
  const values = {};
  const uploaded = [];
  for (const { key, picker, kind, edge, square } of pickers) {
    const change = picker.change();
    if (!change) continue;
    const file = change.file && change.crop
      ? await cropSquarePhoto(change.file, change.crop, edge)
      : change.file;
    values[key] = file ? await uploadPhoto(folder, kind, file, edge, square) : null;
    if (values[key]) uploaded.push(values[key]);
  }
  return { values, uploaded };
}

const removeUploads = (paths) => (paths.length ? supabase.storage.from(BUCKET).remove(paths).then(() => {}) : Promise.resolve());

/* ---------- Profile ---------- */

async function editProfile() {
  const profile = state.profile;
  let chosenProfileAction = null;
  const pad = (value) => String(value).padStart(2, "0");
  const photo = photoField("Profile photo (classmates see it next to your messages)", profile.avatar_path, true);
  const name = el("input", { class: "input", maxlength: 40, value: profile.display_name, required: true });
  // The year is a placeholder (2000 has a 29 February); only the month and day are saved, like the original app.
  const birthday = el("input", { class: "input", type: "date", value: profile.birth_month ? `2000-${pad(profile.birth_month)}-${pad(profile.birth_day)}` : "" });
  const aiStatus = state.ai.caps;
  const aiSummary = el("div", {
    class: "profile-ai-status", id: "profile-ai-status",
    "data-state": aiStatus ? (aiStatus.ok ? "ready" : "off") : "checking",
    title: aiStatus?.ok ? `Ollama ${aiStatus.version} · ${aiStatus.model}${aiStatus.vision ? " · reads images" : ""}` : "Local AI runs on your laptop",
  },
    el("span", { class: "dot", "aria-hidden": "true" }),
    el("span", { id: "profile-ai-label", text: aiStatus ? (aiStatus.ok ? `Local AI: ${aiStatus.model}` : "Local AI: not connected") : "Local AI: checking…" }));
  const profileActionButton = (action, icon, label) => el("button", {
    class: `profile-action${action === "signout" ? " is-danger" : ""}`,
    type: "button",
    onclick: () => { chosenProfileAction = action; $("dialog").close("cancel"); },
  }, el("span", { class: "profile-action-icon", "aria-hidden": "true", text: icon }), el("span", { text: label }));
  const body = el("div", { class: "dialog-fields" },
    el("div", { class: "profile-account" }, el("span", { text: "Signed in with" }), el("strong", { text: state.user?.email || "Email unavailable" })),
    el("section", { class: "profile-tools", "aria-label": "Account tools" },
      aiSummary,
      profileActionButton("ai", "⚙", "Local AI settings"),
      profileActionButton("signout", "⏻", "Sign out")),
    photo.node,
    field("Display name (what your classmates see)", name),
    field("Birthday (optional, only the day and month are kept)", birthday));
  if (!(await ask({ title: "Your profile", body, okLabel: "Save" }))) {
    if (chosenProfileAction === "ai") return openAiSettings();
    if (chosenProfileAction === "signout") return signOut();
    return;
  }
  const [, month, day] = birthday.value ? birthday.value.split("-").map(Number) : [];
  const changes = { display_name: name.value.trim() || profile.display_name };
  if (month || profile.birth_month) Object.assign(changes, { birth_month: month || null, birth_day: day || null });
  let photos;
  try {
    photos = await savePhotos(state.user.id, [{ key: "avatar_path", picker: photo, kind: "avatar", edge: 256, square: true }]);
  } catch (error) {
    return toast(/security policy/i.test(error.message) ? "Profile photos need update 005. Ask the Supabase project owner to run it." : `Couldn't upload the photo: ${error.message}`);
  }
  Object.assign(changes, photos.values);
  const result = await supabase.from("hub_profiles").update(changes).eq("id", state.user.id).select("*");
  if (result.error && /avatar_path/.test(result.error.message)) {
    removeUploads(photos.uploaded);
    return toast("Profile photos need update 005. Ask the Supabase project owner to run it.");
  }
  if (failed(result, "Couldn't save your profile. Try again.")) return removeUploads(photos.uploaded);
  if ("avatar_path" in changes && profile.avatar_path) removeUploads([profile.avatar_path]);
  state.profile = result.data[0];
  $("me-name").textContent = state.profile.display_name;
  renderMyAvatar();
  const me = state.members.get(state.user.id);
  if (me) Object.assign(me, { display_name: state.profile.display_name, birth_month: state.profile.birth_month ?? null, birth_day: state.profile.birth_day ?? null, avatar_path: state.profile.avatar_path ?? null });
  renderMembers();
  renderMessages();
  toast("Profile saved");
}

async function signOut() {
  const forget = el("input", { type: "checkbox" });
  const body = el("div", { class: "dialog-fields" },
    el("p", { class: "muted", text: "You can sign back in on any device with your email and password." }),
    el("label", { class: "check" }, forget, "Also delete the backup on this device (for shared computers)"));
  if (!(await ask({ title: "Sign out?", body, okLabel: "Sign out" }))) return;
  if (forget.checked) await backup.forget().catch(() => {});
  await supabase.auth.signOut();
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

// Puts text where the cursor is in the message box (replacing `from` characters before it) and keeps typing there.
function insertAtCaret(text, from = 0) {
  const input = $("message-input");
  const end = input.selectionEnd ?? input.value.length;
  const start = (input.selectionStart ?? end) - from;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  input.focus();
  input.setSelectionRange(start + text.length, start + text.length);
}

function insertEmoji(emoji) {
  togglePicker(null);
  insertAtCaret(emoji);
}

/* ---------- @mentions ---------- */

// Finds @Name mentions of workspace members, longest names first so "@Dev K" isn't also read as "@Dev".
function findMentions(text) {
  const found = [];
  if (!text.includes("@")) return found;
  let rest = text;
  for (const match of text.matchAll(/@(admin|all)\b/giu)) {
    const start = match.index;
    if (start && /[\p{L}\p{N}_]/u.test(text[start - 1])) continue;
    const kind = match[1].toLowerCase();
    const user_ids = [...state.members.values()]
      .filter((member) => kind === "all" || member.role === "admin")
      .map((member) => member.user_id)
      .filter((userId) => userId !== state.user.id);
    found.push({ start, end: start + match[0].length, kind, user_ids });
    rest = rest.slice(0, start) + " ".repeat(match[0].length) + rest.slice(start + match[0].length);
  }
  const people = [...state.members.values()].sort((a, b) => b.display_name.length - a.display_name.length);
  for (const member of people) {
    const token = `@${member.display_name}`;
    for (let at = rest.indexOf(token); at !== -1; at = rest.indexOf(token, at + token.length)) {
      if (/[\p{L}\p{N}_]/u.test(rest[at + token.length] || "")) continue; // "@Dev" inside "@Devika"
      found.push({ start: at, end: at + token.length, user_id: member.user_id });
      rest = rest.slice(0, at) + " ".repeat(token.length) + rest.slice(at + token.length);
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

function bodyNode(text, mentions) {
  const parts = [];
  let last = 0;
  for (const mention of mentions) {
    const isForMe = mention.user_id === state.user.id || mention.user_ids?.includes(state.user.id);
    parts.push(text.slice(last, mention.start), el("span", { class: `mention${isForMe ? " is-me" : ""}${mention.kind ? " is-group" : ""}`, text: text.slice(mention.start, mention.end) }));
    last = mention.end;
  }
  parts.push(text.slice(last));
  return el("p", { class: "msg-body" }, ...parts.filter((part) => part !== ""));
}

const mention = { items: [], active: 0, query: "" };

// Typing @ shows matching classmates above the message box.
function updateMentionPicker() {
  const input = $("message-input");
  const before = input.value.slice(0, input.selectionStart ?? input.value.length);
  const match = before.match(/(?:^|\s)@([^\s@]{0,30})$/);
  const query = match ? match[1].toLowerCase() : null;
  const shortcuts = [
    { kind: "admin", name: "admin", description: "Notify workspace admins" },
    { kind: "all", name: "all", description: "Notify everyone in this workspace" },
  ].filter((item) => item.name.includes(query || ""));
  const people = query === null ? [] : [...state.members.values()]
    .filter((member) => member.user_id !== state.user.id && member.display_name.toLowerCase().includes(query))
    .sort((a, b) => Number(!a.display_name.toLowerCase().startsWith(query)) - Number(!b.display_name.toLowerCase().startsWith(query)) || a.display_name.localeCompare(b.display_name))
  const items = query === null ? [] : [...shortcuts, ...people].slice(0, 6);
  Object.assign(mention, { items, query: match ? match[1] : "", active: query === mention.query.toLowerCase() ? Math.min(mention.active, Math.max(0, items.length - 1)) : 0 });
  renderMentionPicker();
}

function renderMentionPicker() {
  const picker = $("mention-picker");
  picker.hidden = !mention.items.length;
  $("message-input").setAttribute("aria-expanded", String(!picker.hidden));
  picker.replaceChildren(...mention.items.map((member, index) => el("button", {
    class: `mention-option${index === mention.active ? " is-active" : ""}`,
    type: "button",
    role: "option",
    "aria-selected": String(index === mention.active),
    "aria-label": member.kind ? `@${member.name}: ${member.description}` : `Mention ${member.display_name}`,
    onpointerdown: (event) => event.preventDefault(), // keeps the keyboard open on phones
    onclick: () => pickMention(member),
  }, member.kind
    ? [el("span", { class: "mention-special-icon", "aria-hidden": "true", text: member.kind === "admin" ? "A" : "@" }), el("span", { class: "mention-option-copy" }, el("strong", { text: `@${member.name}` }), el("small", { text: member.description }))]
    : [avatarNode(member, "small"), el("span", { text: member.display_name })])));
}

function pickMention(member) {
  insertAtCaret(`@${member.name || member.display_name} `, mention.query.length + 1);
  closeMentionPicker();
}

function closeMentionPicker() {
  mention.items = [];
  renderMentionPicker();
}

function startMention() {
  togglePicker(null);
  const input = $("message-input");
  const start = input.selectionStart ?? input.value.length;
  insertAtCaret(start && !/\s/.test(input.value[start - 1]) ? " @" : "@");
  updateMentionPicker();
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
  $("ai-view").hidden = true;
  $("admin-view").hidden = true;
  $("memories-view").hidden = false;
  renderSidebar();
  renderHeader();
  refreshStorage(); // photos others added don't arrive live
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
    fileUrl(memory).then((url) => { image.src = url; }).catch(() => {});
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
  for (const original of files) {
    if (!MEMORY_TYPES.includes(original.type)) {
      toast(`${original.name}: photos only (PNG, JPEG, WebP or GIF)`);
      continue;
    }
    const file = await shrinkImage(original);
    if (file.size > MAX_FILE) {
      toast(`${file.name} is over 50 MB`);
      continue;
    }
    if (state.storageUsed + file.size > STORAGE_LIMIT) {
      toast(FULL_MESSAGE);
      continue;
    }
    toast(uploadingLabel(file, original), 120000);
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
    backup.saveBlob(workspace.id, path, file).catch(() => {});
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
  forgetLocally("memories", memory);
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
    // Reading them in another tab or on another device lowers the badge here too.
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "hub_notifications", filter: `user_id=eq.${state.user.id}` }, ({ new: row }) => {
      refreshUnread();
      scheduleChannelUnreadRefresh(row.workspace_id);
    })
    .subscribe();
  refreshUnread();
}

let channelUnreadRefreshTimer = null;
function scheduleChannelUnreadRefresh(workspaceId) {
  if (!workspaceId || workspaceId !== state.workspace?.id) return;
  clearTimeout(channelUnreadRefreshTimer);
  channelUnreadRefreshTimer = setTimeout(async () => {
    const unreadByChannel = await loadChannelUnread(workspaceId);
    if (state.workspace?.id !== workspaceId) return;
    state.channelUnread = unreadByChannel;
    renderSidebar();
  }, 180);
}

// Coming back to SpiritHUB counts as reading the channel that's open.
function readOpenChannel() {
  updateSeenPresence();
  if (state.unread && state.channel && document.visibilityState === "visible") markChannelRead(state.channel.id);
}

// Old notifications would pile up in the database: read ones go after 30 days, the rest after 90.
function pruneNotifications() {
  const daysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString();
  const mine = () => supabase.from("hub_notifications").delete().eq("user_id", state.user.id);
  mine().not("read_at", "is", null).lt("created_at", daysAgo(30)).then(() => {});
  mine().lt("created_at", daysAgo(90)).then(() => {});
}

async function markAllRead() {
  const { error } = await supabase.from("hub_notifications").update({ read_at: new Date().toISOString() }).eq("user_id", state.user.id).is("read_at", null);
  if (!error) refreshUnread();
}

async function onNotification(row) {
  // Someone reading the channel the message is in doesn't need to be told about it.
  if (row.channel_id && row.channel_id === state.channel?.id && document.hasFocus()) {
    await supabase.from("hub_notifications").update({ read_at: new Date().toISOString() }).eq("id", row.id);
    scheduleChannelUnreadRefresh(row.workspace_id);
    return;
  }
  if (row.channel_id) scheduleChannelUnreadRefresh(row.workspace_id);
  refreshUnread();
  if ("Notification" in window && Notification.permission === "granted" && !document.hasFocus()) {
    new Notification(row.title, { body: row.body, tag: row.event_key });
  }
}

async function markChannelRead(channelId) {
  const { error } = await supabase.from("hub_notifications").update({ read_at: new Date().toISOString() }).eq("user_id", state.user.id).eq("channel_id", channelId).is("read_at", null);
  if (!error) {
    refreshUnread();
    scheduleChannelUnreadRefresh(state.workspace?.id);
  }
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
  // Opening the list counts as seeing everything in it, so the badge clears; the list still shows which ones are new.
  markAllRead();
  const open = async (item) => {
    $("dialog").close("cancel");
    if (state.workspace?.id !== item.workspace_id) await openWorkspace(item.workspace_id);
    if (item.channel_id && state.channels.some((channel) => channel.id === item.channel_id)) await openChannel(item.channel_id);
  };
  const list = el("div", { class: "notification-list" }, ...(data.length
    ? data.map((item) => el("button", { class: `notification${item.read_at ? " is-read" : ""}`, type: "button", onclick: () => open(item) },
      el("span", { "aria-hidden": "true", text: { birthday: "🎂", mention: "@" }[item.kind] || "💬" }),
      el("span", {}, el("strong", { text: item.title }), el("small", { text: `${item.body ? `${item.body} · ` : ""}${timeLabel(item.created_at)}` }))))
    : [el("p", { class: "muted", text: "You're all caught up. New messages, mentions and birthdays show up here." })]));
  const browserControl = browserNotificationControl();
  const body = el("div", {}, browserControl ? el("div", { class: "notification-tools" }, browserControl) : null, list);
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

/* ---------- Ask AI: chat with the model on your laptop about a channel's files ---------- */

const ASK_SYSTEM = "You are SpiritHUB's study assistant for Kalvium students, running on the student's own laptop. Answer directly and concisely in Markdown, with no title or preamble. Use the channel's files when they are relevant. You also help with coding: explain code, find bugs, and give small, correct fixes.";
const MAX_PICKED = 2; // a small model can only read so much at once
const aiKey = (channelId) => `spirithub-hub:ai-chat:${state.user.id}:${channelId}`;

// Each channel keeps its own private conversation, saved in this browser only.
function threadFor(channelId) {
  if (!state.aiThreads.has(channelId)) state.aiThreads.set(channelId, local.get(aiKey(channelId)) || []);
  return state.aiThreads.get(channelId);
}

function fileChip(file) {
  const chip = el("button", { class: "file-chip", type: "button" }, file.mime.startsWith("image/") ? "🖼 " : "📄 ", file.name);
  const paint = () => {
    const picked = state.aiPicked.has(file.id);
    chip.classList.toggle("is-picked", picked);
    chip.setAttribute("aria-pressed", String(picked));
    chip.title = picked ? "The AI reads this whole file" : file.summary ? "The AI uses its saved summary. Tap to have it read the whole file" : "Tap to have the AI read this file";
  };
  chip.addEventListener("click", () => {
    if (state.aiPicked.has(file.id)) state.aiPicked.delete(file.id);
    else if (state.aiPicked.size >= MAX_PICKED) return toast(`Pick up to ${MAX_PICKED} files at a time`);
    else state.aiPicked.add(file.id);
    paint();
  });
  paint();
  return chip;
}

function renderAiView() {
  const channel = state.channel;
  if (!channel) return;
  const caps = state.ai.caps;
  const readable = state.files.filter((file) => !file.archived_at);
  const input = el("input", { id: "ai-input", autocomplete: "off", maxlength: 4000, placeholder: `Ask about ${channelDisplayName(channel.name)}, or anything else…`, "aria-label": "Your question" });
  const form = el("form", { class: "composer", onsubmit: (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question || state.aiBusy) return;
    input.value = "";
    askAi(question);
  } }, input, el("button", { class: "send", type: "submit", "aria-label": "Ask" }, "↗"));
  $("ai-view").replaceChildren(
    el("div", { class: "ai-top" },
      el("div", {},
        el("h3", { text: `Ask about ${channelDisplayName(channel.name)}` }),
        el("p", { class: "muted small", text: `Answers come from ${caps?.ok ? `${caps.model} on your laptop` : "your laptop's AI, which isn't connected yet"}. Only you see this chat, and it stays in this browser.` })),
      el("div", { class: "ai-top-actions" },
        caps?.ok ? null : el("button", { class: "btn small primary", type: "button", onclick: openAiSettings }, "Connect AI"),
        el("button", { class: "btn small ghost", type: "button", onclick: clearAiThread }, "Clear chat"))),
    readable.length
      ? el("div", { class: "file-chips" }, el("span", { class: "muted small", text: "Read in full:" }), ...readable.map(fileChip))
      : el("p", { class: "file-chips muted small", text: state.files.length ? "This channel's files are archived. The AI still uses their saved summaries." : "No files in this channel yet. You can still ask anything." }),
    el("div", { class: "ai-thread", id: "ai-thread" }),
    form);
  renderAiThread();
}

function renderAiThread() {
  const box = $("ai-thread");
  if (!box || !state.channel) return;
  const thread = threadFor(state.channel.id);
  if (!thread.length) {
    box.replaceChildren(el("p", { class: "ai-empty" }, el("span", { "aria-hidden": "true", text: "✦" }),
      `Ask about this channel's notes and code. Files with a saved summary are included automatically; tap a file above to have the AI read all of it. For example: "Explain the main idea of the PDF" or "Why does my code print 0?"`));
    return;
  }
  box.replaceChildren(...thread.map((message, index) => {
    if (message.role === "user") return el("div", { class: "ask-msg own", text: message.text });
    const node = el("div", { class: `ask-msg md${message.pending && message.text ? " is-streaming" : ""}`, html: message.text ? markdown(message.text) : '<span class="busy-dot"></span>' });
    if (!message.pending && !message.failed) {
      node.append(el("div", { class: "ask-actions" },
        el("button", { class: "link", type: "button", onclick: () => shareAiAnswer(thread[index - 1]?.text, message.text) }, `Share in ${channelDisplayName(state.channel.name)}`)));
    }
    return node;
  }));
  box.scrollTop = box.scrollHeight;
}

async function aiMessages(channel, question, history) {
  const files = state.channel?.id === channel.id ? state.files : [];
  const reading = files.filter((file) => state.aiPicked.has(file.id) && !file.archived_at);
  const parts = [];
  const images = [];
  for (const file of reading) {
    let content = state.aiFileCache.get(file.id);
    if (!content) {
      content = await readForAi(new File([await fileData(file)], file.name, { type: file.mime }));
      state.aiFileCache.set(file.id, content);
    }
    if (content.text) parts.push(`### ${file.name} (full text)\n${content.text}`);
    else if (state.ai.caps.vision && content.images?.length && !images.length) images.push(content.images[0]);
  }
  for (const file of files) if (file.summary && !reading.includes(file)) parts.push(`### ${file.name} (saved summary)\n${file.summary}`);
  // An image takes about as much of the model's memory as 4,000 characters of text.
  const room = Math.max(1500, Math.floor(textBudget(state.ai.caps) * 0.7) - question.length - images.length * 4000);
  const context = parts.join("\n\n").slice(0, room);
  return [
    { role: "system", content: `${ASK_SYSTEM}\n\nThe student is in the "${channel.name}" channel${channel.course_code ? ` (${channel.course_code})` : ""} of ${state.workspace.name}.${context ? `\n\nFiles in this channel:\n\n${context}` : ""}` },
    ...history.map((message) => ({ role: message.role, content: message.text.slice(0, 1500) })),
    { role: "user", content: question, ...(images.length ? { images } : {}) },
  ];
}

async function askAi(question) {
  if (!state.ai.caps?.ok) await refreshAi();
  if (!state.ai.caps?.ok) {
    toast("Connect the AI on your laptop first");
    return openAiSettings();
  }
  const channel = state.channel;
  const thread = threadFor(channel.id);
  const history = thread.filter((message) => !message.failed).slice(-4);
  const answer = { role: "assistant", text: "", pending: true };
  thread.push({ role: "user", text: question }, answer);
  state.aiBusy = true;
  renderAiThread();
  let frame = 0;
  try {
    const messages = await aiMessages(channel, question, history);
    answer.text = await askLocalAi({
      settings: state.ai.settings,
      caps: state.ai.caps,
      onText: (text) => {
        answer.text = text;
        if (!frame) frame = requestAnimationFrame(() => {
          frame = 0;
          if (state.channel?.id === channel.id && state.tab === "ai") renderAiThread();
        });
      },
    }, messages);
  } catch (error) {
    Object.assign(answer, { text: `Couldn't answer: ${error.message === "Failed to fetch" ? "lost the connection to your local AI." : error.message}`, failed: true });
  }
  answer.pending = false;
  state.aiBusy = false;
  local.set(aiKey(channel.id), thread.slice(-40));
  if (state.channel?.id === channel.id && state.tab === "ai") renderAiThread();
}

function clearAiThread() {
  if (!state.channel || state.aiBusy) return;
  state.aiThreads.set(state.channel.id, []);
  local.remove(aiKey(state.channel.id));
  renderAiThread();
}

async function shareAiAnswer(question, answer) {
  const channel = state.channel;
  if (!channel) return;
  if (!(await ask({ title: `Share this answer in ${channelDisplayName(channel.name)}?`, body: "Everyone in the workspace will see it in the chat.", okLabel: "Share" }))) return;
  const body = `🤖 AI answer${question ? ` to "${question.slice(0, 200)}"` : ""}:\n\n${answer}`.slice(0, 4000);
  const { data, error } = await supabase.from("hub_messages").insert({ workspace_id: state.workspace.id, channel_id: channel.id, body }).select().single();
  if (error) return toast(error.message);
  addMessage(data);
  toast(`Shared in ${channelDisplayName(channel.name)}`);
}

/* ---------- Admin panel: everything this workspace keeps in Supabase ---------- */

async function openAdmin() {
  if (state.role !== "admin") return;
  unsubscribe();
  clearReply();
  Object.assign(state, { view: "admin", channel: null, messages: [], files: [], reactions: [] });
  closePanels();
  for (const id of ["empty-main", "chat-view", "files-view", "ai-view", "memories-view"]) $(id).hidden = true;
  $("admin-view").hidden = false;
  renderSidebar();
  renderHeader();
  $("admin-view").replaceChildren(el("p", { class: "loading", text: "Loading everything this workspace stores…" }));
  await loadAdmin();
}

async function loadAdmin() {
  const workspace = state.workspace;
  try {
    const [files, memories, messages, members, project] = await Promise.all([
      fetchAll(() => supabase.from("hub_files").select("*").eq("workspace_id", workspace.id).order("created_at", { ascending: false })),
      fetchAll(() => supabase.from("hub_memories").select("id, path, size, user_id, created_at").eq("workspace_id", workspace.id)).catch(() => []),
      fetchAll(() => supabase.from("hub_messages").select("channel_id, user_id, created_at").eq("workspace_id", workspace.id)),
      fetchAll(() => supabase.from("hub_members").select("user_id, role, joined_at, profile:hub_profiles(display_name)").eq("workspace_id", workspace.id).order("joined_at")),
      supabase.rpc("hub_project_storage").then(({ data, error }) => (error ? null : Number(data))), // arrives with update 004
    ]);
    if (state.view === "admin" && state.workspace?.id === workspace.id) renderAdmin({ files, memories, messages, members, project });
  } catch (error) {
    $("admin-view").replaceChildren(el("p", { class: "loading", text: `Couldn't load the admin panel: ${error.message}` }));
  }
}

function renderAdmin({ files, memories, messages, members, project }) {
  const latest = (rows) => rows.reduce((last, row) => (row.created_at > last ? row.created_at : last), "");
  const channels = orderedChannels();
  const label = (channel) => {
    const semester = state.semesters.find((candidate) => candidate.id === channel.semester_id)?.name;
    return `${channel.name}${semester ? ` · ${semester}` : ""}`;
  };
  const cell = (content, props = {}) => el("td", props, content);
  const buttons = (...items) => el("div", { class: "row-buttons" }, ...items);
  const button = (text, onclick, danger = false) => el("button", { class: `btn small ghost${danger ? " danger-text" : ""}`, type: "button", onclick }, text);
  const table = (headers, rows) => el("div", { class: "table-wrap" }, el("table", {},
    el("thead", {}, el("tr", {}, ...headers.map((header) => el("th", { text: header })))),
    el("tbody", {}, ...rows)));
  const tile = (value, text) => el("div", { class: "tile" }, el("strong", { text: value }), el("span", { text }));
  const plural = (n, word) => `${word}${n === 1 ? "" : "s"}`;
  const live = files.filter((file) => !file.archived_at); // archived files no longer take up space
  const archived = files.length - live.length;
  const used = sizeOf(live) + sizeOf(memories);

  const storage = [
    ...channels.map((channel) => ({ where: label(channel), rows: live.filter((file) => file.channel_id === channel.id) })),
    { where: "📷 Memories", rows: memories },
  ].filter((place) => place.rows.length).sort((a, b) => sizeOf(b.rows) - sizeOf(a.rows));

  $("admin-view").replaceChildren(
    el("div", { class: "files-top" },
      el("div", {}, el("h3", { text: "Admin panel" }), el("p", { class: "muted small", text: `Everything ${state.workspace.name} keeps in Supabase. Only admins can open this.` })),
      el("div", { class: "ai-top-actions" }, button("Refresh", loadAdmin))),
    el("div", { class: "tiles" },
      tile(String(members.length), plural(members.length, "member")),
      tile(String(channels.length), plural(channels.length, "channel")),
      tile(String(messages.length), plural(messages.length, "message")),
      tile(String(live.length), `${plural(live.length, "file")}${archived ? ` · ${archived} archived` : ""}`),
      tile(String(memories.length), plural(memories.length, "photo")),
      tile(used ? formatSize(used) : "0 MB", "of 100 MB used"),
      project === null ? null : tile(project ? formatSize(project) : "0 MB", "of the whole project's 1 GB")),
    el("section", {}, el("h4", { text: "Storage" }), storage.length
      ? table(["Where", "Items", "Size", "Share of 100 MB"], storage.map((place) => el("tr", {},
        cell(place.where),
        cell(String(place.rows.length), { class: "num" }),
        cell(formatSize(sizeOf(place.rows)), { class: "num" }),
        cell(el("span", { class: "bar-track" }, el("span", { class: "bar", style: `width:${Math.max(1, Math.min(100, (sizeOf(place.rows) / STORAGE_LIMIT) * 100))}%` }))))))
      : el("p", { class: "muted small", text: "Nothing stored yet." })),
    freeUpSection(live),
    el("section", {}, el("h4", { text: "Channels" }), table(["Channel", "Messages", "Files", "Last message", ""], channels.map((channel) => {
      const said = messages.filter((message) => message.channel_id === channel.id);
      const last = latest(said);
      return el("tr", {},
        cell(label(channel)),
        cell(String(said.length), { class: "num" }),
        cell(String(files.filter((file) => file.channel_id === channel.id).length), { class: "num" }),
        cell(last ? timeLabel(last) : "None yet"),
        cell(buttons(button("Open", () => openChannel(channel.id)))));
    }))),
    el("section", {}, el("h4", { text: "Members" }), table(["Name", "Role", "Joined", "Messages", "Files", "Last message", ""], members.map((row) => {
      const member = state.members.get(row.user_id) || { user_id: row.user_id, role: row.role, display_name: row.profile?.display_name || "Member" };
      const said = messages.filter((message) => message.user_id === row.user_id);
      const owner = row.user_id === state.workspace.created_by;
      const last = latest(said);
      return el("tr", {},
        cell(`${member.display_name}${row.user_id === state.user.id ? " (you)" : ""}`),
        cell(owner ? "Owner" : row.role === "admin" ? "Admin" : "Member"),
        cell(timeLabel(row.joined_at)),
        cell(String(said.length), { class: "num" }),
        cell(String(files.filter((file) => file.user_id === row.user_id).length), { class: "num" }),
        cell(last ? timeLabel(last) : "None yet"),
        cell(owner || row.user_id === state.user.id ? "" : buttons(
          button(member.role === "admin" ? "Make member" : "Make admin", async () => {
            await setRole(member, member.role === "admin" ? "member" : "admin");
            loadAdmin();
          }),
          button("Remove", async () => {
            await removeMember(member);
            loadAdmin();
          }, true))));
    }))),
    el("section", {}, el("h4", { text: `All files (${files.length})` }), files.length
      ? table(["File", "Channel", "Shared by", "Size", "Added", "AI summary", ""], files.map((file) => el("tr", {},
        cell(`${file.archived_at ? "📦 " : ""}${file.name}`, { class: "file-name", title: file.archived_at ? `${file.name} (archived to free up space)` : file.name }),
        cell(state.channels.find((channel) => channel.id === file.channel_id)?.name || "Deleted channel"),
        cell(nameOf(file.user_id)),
        cell(formatSize(file.size), { class: "num" }),
        cell(timeLabel(file.created_at)),
        cell(file.summary ? "Saved" : "None"),
        cell(buttons(button("Open", () => openFile(file)), button("Delete", () => deleteFile(file), true))))))
      : el("p", { class: "muted small", text: "No files yet." })),
    el("p", { class: "muted small admin-note", text: "Sign-in emails and passwords are kept by Supabase's sign-in service and never shown here, so classmates' emails stay private. The Supabase project owner can see accounts in the Supabase dashboard under Authentication → Users." }));
}

// Moves old files off Supabase so the workspace never fills up. Every device backs up the workspaces it opens,
// so the files stay on those devices, and their names and AI summaries stay in the chat.
function freeUpSection(live) {
  const age = el("select", { class: "select", "aria-label": "Which files to move" },
    el("option", { value: "90" }, "Older than 3 months"),
    el("option", { value: "30" }, "Older than 1 month"),
    el("option", { value: "7" }, "Older than 1 week"),
    el("option", { value: "0" }, "All files"));
  const go = el("button", { class: "btn small primary", type: "button" });
  const summary = el("p", { class: "muted small" });
  const picked = () => {
    const cutoff = Date.now() - Number(age.value) * 86400000;
    return live.filter((file) => Date.parse(file.created_at) <= cutoff);
  };
  const update = () => {
    const files = picked();
    go.disabled = !files.length;
    go.textContent = files.length ? `Free up ${formatSize(sizeOf(files))}` : "Free up space";
    summary.textContent = files.length ? `${countOf(files.length, "file")} will move off SpiritHUB's online storage.` : "No files that old.";
  };
  age.addEventListener("change", update);
  go.addEventListener("click", () => freeUpSpace(picked()));
  update();
  return el("section", { id: "free-up" },
    el("h4", { text: "Free up space" }),
    el("p", { class: "muted small", text: "Moves files off SpiritHUB's online storage. They're saved on this device first, they stay on classmates' devices that backed them up, and their names and AI summaries stay in the chat." }),
    el("div", { class: "free-controls" }, age, go),
    summary);
}

async function freeUpSpace(files) {
  if (!files.length) return;
  if (!(await hasArchiveColumn())) return toast("Ask the Supabase project owner to run update 004 (hub/updates/004-free-up-space-and-mentions.sql) first.");
  const total = formatSize(sizeOf(files));
  const one = files.length === 1;
  const body = `${countOf(files.length, "file")} will be saved on this device, then removed from SpiritHUB's online storage. ${one
    ? "It stays in the chat as an archived file, with its AI summary, and opens on devices that backed it up."
    : "They stay in the chat as archived files, with their AI summaries, and open on devices that backed them up."}`;
  if (!(await ask({ title: `Free up ${total}?`, body, okLabel: `Free up ${total}`, danger: true }))) return;
  const workspaceId = state.workspace.id;
  try {
    for (const [index, file] of files.entries()) {
      toast(`Saving on this device: ${index + 1} of ${files.length}…`, 600000);
      if (!(await saveOnDevice(workspaceId, file))) return toast(`Couldn't save ${file.name} on this device, so nothing was removed. Check your connection and try again.`);
    }
  } catch (error) {
    return toast(`Nothing was removed: ${error.message}.`);
  }
  toast("Freeing up space…", 600000);
  const paths = files.map((file) => file.path);
  for (let start = 0; start < paths.length; start += 100) {
    const { error } = await supabase.storage.from(BUCKET).remove(paths.slice(start, start + 100));
    if (error) return toast(error.message);
  }
  const ids = files.map((file) => file.id);
  for (let start = 0; start < ids.length; start += 500) {
    const { error } = await supabase.rpc("hub_archive_files", { file_ids: ids.slice(start, start + 500) });
    if (error) return toast(error.message);
  }
  refreshStorage();
  loadAdmin();
  backupNow(workspaceId);
  toast(`Freed up ${total}. ${one ? "The file is" : "The files are"} saved on this device.`);
}

async function deleteFile(file) {
  if (!(await ask({ title: `Delete ${file.name}?`, body: "The file and the chat message that shared it are deleted for everyone.", okLabel: "Delete", danger: true }))) return;
  const result = await supabase.from("hub_files").delete().eq("id", file.id).select("id");
  if (failed(result, "Only the uploader or an admin can delete this file.")) return;
  await supabase.storage.from(BUCKET).remove([file.path]);
  forgetLocally("files", file);
  refreshStorage();
  loadAdmin();
  toast(`Deleted ${file.name}`);
}

/* ---------- Local AI ---------- */

async function refreshAi() {
  const result = await checkAi(state.ai.settings);
  state.ai.caps = result;
  const status = $("profile-ai-status");
  const label = $("profile-ai-label");
  if (status && label) {
    status.dataset.state = result.ok ? "ready" : "off";
    label.textContent = result.ok ? `Local AI: ${result.model}` : "Local AI: not connected";
    status.title = result.ok ? `Ollama ${result.version} · ${result.model}${result.vision ? " · reads images" : ""}` : "Local AI runs on your laptop";
  }
  return result;
}

function aiHelp(result, model) {
  if (result.ok) {
    return [el("p", { class: "ok", text: `Connected: Ollama ${result.version}, ${result.model}${result.vision ? ", reads PDFs and screenshots." : ". Text only: screenshots need a vision model."}` })];
  }
  const headline = result.reason === "missing-model"
    ? `Ollama is running, but ${result.model} isn't installed.`
    : result.reason === "unreachable" ? "Can't reach Ollama on this laptop yet." : result.message;
  const commands = setupCommands();
  if (/Windows/i.test(navigator.userAgent)) commands.reverse(); // this computer's command first
  return [
    el("p", { class: "bad", text: headline }),
    el("p", { text: "Set it up with one command. It installs Ollama, lets SpiritHUB use it, and downloads the AI model (about 3.5 GB):" }),
    ...commands.map(({ label, text }) => el("div", { class: "setup-command" },
      el("small", { text: label }),
      el("div", { class: "copy-row" },
        el("code", { text }),
        el("button", { class: "btn small", type: "button", onclick: () => copyText(text, "Command copied") }, "Copy")))),
    model === AI_DEFAULTS.model ? null : el("p", { class: "small" }, "You picked a different model, so also run ", el("code", { text: `ollama pull ${model}` }), "."),
    el("p", { class: "muted small", text: "When it says All set, press Test connection again." }),
  ].filter(Boolean);
}

// The scripts in hub/setup/ allow this site by default; any other address passes its own along.
const SETUP_SITE = "https://prabhaskodela.github.io";

function setupCommands() {
  const script = (file) => new URL(`setup/${file}`, location.href).href;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname); // Ollama trusts these already
  const site = !local && location.origin !== SETUP_SITE ? location.origin : null;
  // Works from Command Prompt as well as PowerShell (irm alone exists only in PowerShell), and turns on
  // TLS 1.2, which older Windows PowerShell leaves off; this is the pattern Chocolatey's installer uses.
  const windows = `powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object Net.WebClient).DownloadString('${script("windows.ps1")}'))"`;
  return [
    { label: "Mac: paste this into Terminal", text: `curl -fsSL ${script("mac.sh")} | ${site ? `SPIRITHUB_SITE=${site} ` : ""}bash` },
    site
      ? { label: "Windows: paste this into PowerShell", text: `$env:SPIRITHUB_SITE="${site}"; irm ${script("windows.ps1")} | iex` }
      : { label: "Windows: paste this into Command Prompt or PowerShell", text: windows },
  ];
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
    const blob = await fileData(file);
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
    status.textContent = `Made by ${state.ai.settings.model} on your laptop. Save it so everyone in ${state.channel.name} can read it.`;
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
  $("menu-toggle").setAttribute("aria-expanded", "false");
  $("members-toggle").setAttribute("aria-expanded", "false");
}

function toggleMenu(open = $("ws-menu").hidden) {
  if (open && !state.workspace) return;
  $("ws-menu").hidden = !open;
  $("ws-menu-btn").setAttribute("aria-expanded", String(open));
  if (!open) return;
  const admin = state.role === "admin";
  const owner = state.workspace.created_by === state.user.id;
  const hiddenFor = { invite: false, settings: !admin, admin: !admin, semester: !admin, channel: !admin, leave: owner, delete: !owner };
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
  ({ invite: showInvite, settings: editWorkspace, admin: openAdmin, semester: addSemester, channel: () => addChannel(null), leave: leaveWorkspace, delete: deleteWorkspace })[action]();
});
document.addEventListener("click", (event) => {
  if (!$("ws-menu").hidden && !event.target.closest("#ws-menu")) toggleMenu(false);
  if (!event.target.closest(".composer")) {
    togglePicker(null);
    closeMentionPicker();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  toggleMenu(false);
  togglePicker(null);
  closeMentionPicker();
  closePanels();
});

$("new-workspace").addEventListener("click", createWorkspace);
$("join-workspace").addEventListener("click", joinWithCode);
$("profile-btn").addEventListener("click", editProfile);
$("file-viewer-close").addEventListener("click", () => $("file-viewer").close());
$("file-viewer").addEventListener("click", (event) => {
  if (event.target === $("file-viewer")) $("file-viewer").close();
});
$("file-viewer").addEventListener("close", () => {
  fileViewRequest += 1;
  $("file-viewer-content").replaceChildren();
});
$("notifications-btn").addEventListener("click", openNotifications);
$("backup-status").addEventListener("click", openBackup);
setInterval(() => document.visibilityState === "visible" && backupNow(), BACKUP_EVERY);
$("free-space").addEventListener("click", async () => {
  await openAdmin();
  $("free-up")?.scrollIntoView({ behavior: "smooth", block: "start" });
});
window.addEventListener("focus", readOpenChannel);
document.addEventListener("visibilitychange", readOpenChannel);
$("reply-cancel").addEventListener("click", clearReply);
$("mention-button").addEventListener("click", startMention);
$("message-input").addEventListener("input", updateMentionPicker);
$("message-input").addEventListener("input", updateTypingPresence);
$("messages").addEventListener("scroll", () => { updateSeenPresence(); }, { passive: true });
setInterval(renderTypingIndicator, 700);
$("message-input").addEventListener("click", updateMentionPicker);
$("message-input").addEventListener("keydown", (event) => {
  if (!mention.items.length || event.isComposing) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    mention.active = (mention.active + (event.key === "ArrowDown" ? 1 : mention.items.length - 1)) % mention.items.length;
    renderMentionPicker();
  } else if (event.key === "Enter" || event.key === "Tab") {
    event.preventDefault();
    pickMention(mention.items[mention.active]);
  }
});
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
$("menu-toggle").addEventListener("click", () => {
  const open = $("app").classList.toggle("nav-open");
  $("menu-toggle").setAttribute("aria-expanded", String(open));
});
$("members-toggle").addEventListener("click", () => {
  const open = $("app").classList.toggle("members-open");
  $("members-toggle").setAttribute("aria-expanded", String(open));
});
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

