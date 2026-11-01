import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./app-config.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL) && !SUPABASE_URL.includes("YOUR_") && SUPABASE_ANON_KEY.length > 30 && !SUPABASE_ANON_KEY.includes("YOUR_");
let createClient = null;
if (configured) {
  try {
    ({ createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"));
  } catch {
    // Keep the cached app shell available when the network or CDN is unreachable.
  }
}
const supabase = configured && createClient ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const state = { user: null, profile: null, rooms: [], room: null, role: "member", semesters: [], semester: null, subjects: [], subject: null, chatChannel: null, subjectChatChannel: null, replyTo: null, subjectReplyTo: null, busy: false };
const MAX_UPLOAD = 50 * 1024 * 1024;
const ROOM_STORAGE_LIMIT = 100 * 1024 * 1024;
const EMOJIS = "😀 😃 😄 😁 😆 😅 😂 🙂 🙃 😉 😊 😍 🥰 😎 🤓 🥳 🤔 🫡 😭 😴 🤯 🫠 🤗 🤝 👍 👎 👏 🙌 🫶 💪 🔥 ✨ 💯 ❤️ 💜 💛 🧠 📚 📝 🎓 ☕ 🌱 🚀 🎉 🥹".split(" ");
const STICKERS = [{icon:"🎉",text:"NICE ONE"},{icon:"🔥",text:"LET'S GO"},{icon:"💜",text:"GOOD VIBES"},{icon:"📚",text:"LOCKED IN"},{icon:"☕",text:"BREAK TIME"},{icon:"💪",text:"YOU GOT THIS"}];

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("is-visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("is-visible"), 3000);
}

function setBusy(isBusy) {
  state.busy = isBusy;
  document.body.classList.toggle("is-busy", isBusy);
}

function showSetupNote() {
  const note = $("#setup-note");
  note.hidden = false;
  note.textContent = "SpiritHUB’s screens are ready. Connect a Supabase project in app-config.js and apply schema.sql to enable Google sign-in and shared rooms.";
  $("#google-sign-in").disabled = true;
  $("#google-sign-in").setAttribute("aria-describedby", "setup-note");
}

if (!configured) showSetupNote();
else if (!supabase) {
  const note = $("#setup-note");
  note.hidden = false;
  note.textContent = navigator.onLine ? "SpiritHUB could not connect to its sign-in service. Check your connection and try again." : "You’re offline. Sign-in and shared rooms need an internet connection.";
  $("#google-sign-in").disabled = true;
}

$("#google-sign-in").addEventListener("click", async () => {
  if (!supabase) return;
  setBusy(true);
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
  setBusy(false);
  if (error) toast(error.message);
});

if (supabase) {
  supabase.auth.onAuthStateChange((_event, session) => {
    queueMicrotask(async () => {
      state.user = session?.user ?? null;
      if (state.user) await onSignedIn();
      else showSignedOut();
    });
  });
  supabase.auth.getSession().then(({ data }) => {
    state.user = data.session?.user ?? null;
    if (state.user) onSignedIn();
  });
}

function showSignedOut() {
  state.profile = null;
  state.rooms = [];
  state.room = null;
  $("#auth-screen").hidden = false;
  $("#workspace").hidden = true;
  $("#account-area").hidden = true;
}

async function onSignedIn() {
  $("#auth-screen").hidden = true;
  $("#workspace").hidden = false;
  $("#account-area").hidden = false;
  const { data: profile, error } = await supabase.from("profiles").select("id,display_name,birth_month,birth_day").eq("id", state.user.id).maybeSingle();
  if (error) return toast(error.message);
  state.profile = profile;
  if (!profile) {
    const suggested = state.user.user_metadata?.full_name || state.user.user_metadata?.name || "";
    $("#display-name").value = suggested.slice(0, 32);
    $("#profile-dialog").showModal();
    return;
  }
  updateAccount();
  await loadRooms();
  subscribeNotifications();
}

function updateAccount() {
  const name = state.profile?.display_name || "Student";
  $("#account-name").textContent = name;
  $("#user-avatar").textContent = name.trim().charAt(0).toUpperCase() || "S";
}

$("#profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const display_name = $("#display-name").value.trim();
  if (!display_name) return;
  const { birth_month, birth_day } = readBirthday($("#birthday").value);
  const { data, error } = await supabase.from("profiles").upsert({ id: state.user.id, display_name, birth_month, birth_day }).select().single();
  if (error) return toast(error.message);
  state.profile = data;
  $("#profile-dialog").close();
  updateAccount();
  await loadRooms();
  subscribeNotifications();
});

$("#sign-out").addEventListener("click", async () => {
  if (state.chatChannel) await supabase.removeChannel(state.chatChannel);
  const { error } = await supabase.auth.signOut();
  if (error) toast(error.message);
});

function openDialog(id) { $(id).showModal(); }
$$("[data-close]").forEach((button) => button.addEventListener("click", () => $(`#${button.dataset.close}`).close()));
$("#create-room-open").addEventListener("click", () => openDialog("#create-room-dialog"));
$("#welcome-create").addEventListener("click", () => openDialog("#create-room-dialog"));
$("#join-room-open").addEventListener("click", () => openDialog("#join-room-dialog"));
$("#welcome-join").addEventListener("click", () => openDialog("#join-room-dialog"));

$("#create-room-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = $("#new-room-name").value.trim();
  const academic_year = $("#new-room-year").value.trim();
  if (!name || !state.profile) return;
  setBusy(true);
  const { data: roomId, error } = await supabase.rpc("create_room", { p_name: name, p_academic_year: academic_year });
  setBusy(false);
  if (error) return toast(error.message);
  $("#create-room-dialog").close();
  $("#create-room-form").reset();
  await loadRooms(roomId);
  toast("Your room is ready. Share its ID with your class.");
});

$("#join-room-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const room_code = $("#join-room-id").value.trim().toUpperCase();
  if (!room_code) return;
  setBusy(true);
  const { data: roomId, error } = await supabase.rpc("join_room_by_code", { p_code: room_code });
  setBusy(false);
  if (error) return toast(error.message);
  $("#join-room-dialog").close();
  $("#join-room-form").reset();
  await loadRooms(roomId);
  toast("You joined the room.");
});

async function loadRooms(selectId) {
  const { data: memberships, error: memberError } = await supabase.from("room_members").select("room_id,role").eq("user_id", state.user.id);
  if (memberError) return toast(memberError.message);
  if (!memberships?.length) {
    state.rooms = [];
    state.room = null;
    renderRoomList();
    showRoom(null);
    return;
  }
  const ids = memberships.map((item) => item.room_id);
  const { data: rooms, error } = await supabase.from("rooms").select("id,name,academic_year,room_code,created_by").in("id", ids).order("created_at", { ascending: false });
  if (error) return toast(error.message);
  state.rooms = rooms || [];
  renderRoomList();
  await checkBirthdays(ids);
  const next = state.rooms.find((room) => room.id === selectId) || state.rooms.find((room) => room.id === state.room?.id) || state.rooms[0];
  await selectRoom(next || null);
}

function readBirthday(value) {
  if (!value) return { birth_month: null, birth_day: null };
  const [, month, day] = value.split("-").map(Number);
  return { birth_month: month, birth_day: day };
}

async function checkBirthdays(roomIds) {
  if (!roomIds.length) return;
  const today = new Date();
  const month = today.getMonth() + 1;
  const day = today.getDate();
  const year = today.getFullYear();
  const { data: members, error } = await supabase.from("room_members").select("room_id,user_id").in("room_id", roomIds);
  if (error || !members?.length) return;
  const ids = [...new Set(members.map((member) => member.user_id))];
  const { data: profiles, error: profileError } = await supabase.from("profiles").select("id,display_name,birth_month,birth_day").in("id", ids).eq("birth_month", month).eq("birth_day", day);
  if (profileError || !profiles?.length) return;
  const rows = [];
  for (const member of members) {
    const birthday = profiles.find((profile) => profile.id === member.user_id && profile.id !== state.user.id);
    if (!birthday) continue;
    rows.push({ user_id: state.user.id, room_id: member.room_id, notification_type: "birthday", event_key: `birthday:${member.room_id}:${birthday.id}:${year}`, title: `It’s ${birthday.display_name}’s birthday!`, body: "Send them a birthday wish in the room chat." });
  }
  if (rows.length) await supabase.from("notifications").upsert(rows, { onConflict: "event_key", ignoreDuplicates: true });
  await refreshNotificationCount();
}

let notificationChannel;
function subscribeNotifications() {
  if (!supabase || !state.user) return;
  if (notificationChannel) supabase.removeChannel(notificationChannel);
  notificationChannel = supabase.channel(`user-notifications-${state.user.id}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${state.user.id}` }, (payload) => {
    refreshNotificationCount();
    if ("Notification" in window && Notification.permission === "granted") new Notification(payload.new.title, { body: payload.new.body, icon: "/Spirit/icons/icon-192.png", tag: payload.new.event_key });
  }).subscribe();
  refreshNotificationCount();
}

async function refreshNotificationCount() {
  if (!state.user) return;
  const { count, error } = await supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", state.user.id).is("read_at", null);
  if (error) return;
  const badge = $("#notification-count");
  badge.textContent = String(count || 0);
  badge.hidden = !count;
}

$("#notifications-open").addEventListener("click", async () => {
  await loadNotifications();
  openDialog("#notifications-dialog");
});

async function loadNotifications() {
  const list = $("#notification-list");
  list.replaceChildren();
  const { data, error } = await supabase.from("notifications").select("id,room_id,subject_id,notification_type,event_key,title,body,read_at,created_at").eq("user_id", state.user.id).order("created_at", { ascending: false }).limit(50);
  if (error) return toast(error.message);
  if (!data?.length) {
    const empty = document.createElement("p");
    empty.className = "no-files";
    empty.textContent = "You’re all caught up. Room updates will show here.";
    list.append(empty);
    return;
  }
  for (const item of data) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `notification-row${item.read_at ? " is-read" : ""}`;
    const icon = document.createElement("span");
    icon.className = "notification-icon";
    icon.textContent = item.notification_type === "birthday" ? "🎂" : "✉";
    const copy = document.createElement("span");
    copy.className = "notification-copy";
    const title = document.createElement("strong");
    title.textContent = item.title;
    const body = document.createElement("small");
    body.textContent = `${item.body} · ${new Date(item.created_at).toLocaleString()}`;
    copy.append(title, body);
    row.append(icon, copy);
    row.addEventListener("click", async () => {
      await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", item.id);
      $("#notifications-dialog").close();
      const room = state.rooms.find((entry) => entry.id === item.room_id);
      if (room) await selectRoom(room);
      if (item.subject_id) {
        const { data: subjectRow } = await supabase.from("subjects").select("id,name,course_code,semester_id").eq("id", item.subject_id).maybeSingle();
        const semester = state.semesters.find((entry) => entry.id === subjectRow?.semester_id);
        if (semester) {
          state.semester = semester;
          renderSemesterSelect();
          await loadSubjects();
          state.subject = state.subjects.find((entry) => entry.id === item.subject_id) || subjectRow;
          renderSubjects();
          await loadSubjectFiles();
          selectSection("subjects-section");
        }
      } else if (item.notification_type === "message") selectSection("chat-section");
      await refreshNotificationCount();
    });
    list.append(row);
  }
}

$("#enable-notifications").addEventListener("click", async () => {
  if (!("Notification" in window)) return toast("This browser does not support system notifications.");
  const permission = await Notification.requestPermission();
  toast(permission === "granted" ? "Browser notifications enabled." : "Browser notifications were not enabled.");
});

function renderRoomList() {
  const list = $("#room-list");
  list.replaceChildren();
  for (const room of state.rooms) {
    const button = document.createElement("button");
    button.className = `room-item${state.room?.id === room.id ? " is-active" : ""}`;
    button.type = "button";
    const mark = document.createElement("span");
    mark.className = "room-monogram";
    mark.textContent = room.name.trim().charAt(0).toUpperCase();
    const copy = document.createElement("span");
    copy.className = "room-item-copy";
    const title = document.createElement("strong");
    title.textContent = room.name;
    const year = document.createElement("span");
    year.textContent = room.academic_year || `ID ${room.room_code}`;
    copy.append(title, year);
    button.append(mark, copy);
    button.addEventListener("click", () => selectRoom(room));
    list.append(button);
  }
}

async function selectRoom(room) {
  if (state.chatChannel) {
    await supabase.removeChannel(state.chatChannel);
    state.chatChannel = null;
  }
  if (state.subjectChatChannel) {
    await supabase.removeChannel(state.subjectChatChannel);
    state.subjectChatChannel = null;
  }
  state.room = room;
  state.replyTo = null;
  state.subjectReplyTo = null;
  $("#reply-context").hidden = true;
  state.subject = null;
  renderRoomList();
  if (!room) return showRoom(null);
  const { data: membership, error: memberError } = await supabase.from("room_members").select("role").eq("room_id", room.id).eq("user_id", state.user.id).single();
  if (memberError) return toast(memberError.message);
  state.role = membership.role;
  showRoom(room);
  await Promise.all([loadSemesters(), loadMemberCount()]);
}

function showRoom(room) {
  $("#welcome-empty").hidden = !!room;
  $("#room-content").hidden = !room;
  if (!room) return;
  $("#room-name").textContent = room.name;
  $("#room-kicker").textContent = room.academic_year || "YOUR CLASS SPACE";
  $("#room-id-label").textContent = room.room_code;
  $("#add-semester").hidden = state.role !== "admin";
  $("#manage-semester").hidden = state.role !== "admin";
  $("#add-subject").hidden = state.role !== "admin";
  selectSection("subjects-section");
  refreshRoomStorage();
}

async function getRoomStorageUsage() {
  if (!state.room) return 0;
  const [{ data: files, error: fileError }, { data: memories, error: memoryError }] = await Promise.all([
    supabase.from("subject_files").select("file_size").eq("room_id", state.room.id),
    supabase.from("memories").select("file_size").eq("room_id", state.room.id),
  ]);
  if (fileError || memoryError) throw fileError || memoryError;
  return [...(files || []), ...(memories || [])].reduce((sum, row) => sum + Number(row.file_size || 0), 0);
}

async function refreshRoomStorage() {
  if (!state.room) return;
  try {
    const usage = await getRoomStorageUsage();
    const percent = Math.min(100, usage / ROOM_STORAGE_LIMIT * 100);
    $("#storage-label").textContent = `Room files · ${formatBytes(usage)} / 100 MB`;
    $("#storage-fill").style.width = `${percent}%`;
    $("#storage-fill").setAttribute("aria-valuenow", String(Math.round(percent)));
  } catch (error) { toast(error.message); }
}

async function canUploadToRoom(file) {
  try {
    const used = await getRoomStorageUsage();
    if (used + file.size > ROOM_STORAGE_LIMIT) {
      toast("This room is at its 100 MB storage limit. Ask the admin to clear old files.");
      return false;
    }
    return true;
  } catch (error) { toast(error.message); return false; }
}

$("#export-room").addEventListener("click", exportRoomBackup);
async function exportRoomBackup() {
  if (!state.room) return;
  setBusy(true);
  try {
    const tables = ["semesters", "subject_files", "subject_messages", "messages", "memories"];
    const manifest = { exported_at: new Date().toISOString(), room: { id: state.room.id, name: state.room.name, academic_year: state.room.academic_year, room_code: state.room.room_code }, contents: {} };
    for (const table of tables) {
      const { data, error } = await supabase.from(table).select("*").eq("room_id", state.room.id);
      if (error) throw error;
      manifest.contents[table] = data || [];
    }
    const semesterIds = manifest.contents.semesters.map((item) => item.id);
    const { data: subjects, error: subjectError } = semesterIds.length
      ? await supabase.from("subjects").select("*").in("semester_id", semesterIds)
      : { data: [], error: null };
    if (subjectError) throw subjectError;
    manifest.contents.subjects = subjects || [];
    const objects = new Map();
    for (const file of manifest.contents.subject_files) objects.set(`spirit-files/${file.storage_path}`, { bucket: "spirit-files", path: file.storage_path });
    for (const message of [...manifest.contents.subject_messages, ...manifest.contents.messages]) {
      if (message.attachment_path) objects.set(`spirit-files/${message.attachment_path}`, { bucket: "spirit-files", path: message.attachment_path });
    }
    for (const memory of manifest.contents.memories) objects.set(`spirit-memories/${memory.storage_path}`, { bucket: "spirit-memories", path: memory.storage_path });
    const { zipSync, strToU8 } = await import("https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js");
    const archive = { "spirithub-manifest.json": strToU8(JSON.stringify(manifest, null, 2)) };
    for (const [archivePath, object] of objects) {
      const { data: signed, error } = await supabase.storage.from(object.bucket).createSignedUrl(object.path, 300);
      if (error) throw error;
      const response = await fetch(signed.signedUrl);
      if (!response.ok) throw new Error(`Could not include ${object.path} in the backup.`);
      archive[`files/${archivePath}`] = new Uint8Array(await response.arrayBuffer());
    }
    const blob = new Blob([zipSync(archive, { level: 1 })], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${state.room.name.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase()}-spirithub-backup.zip`;
    link.click();
    URL.revokeObjectURL(url);
    toast("Room backup downloaded.");
  } catch (error) {
    toast(`Backup failed: ${error.message}`);
  } finally { setBusy(false); }
}

async function loadMemberCount() {
  const { data, error } = await supabase.from("room_members").select("user_id,role").eq("room_id", state.room.id);
  if (!error) {
    const count = data?.length || 0;
    $("#member-line").textContent = `${count} ${count === 1 ? "member" : "members"} · your shared class space`;
    $("#member-count-label").textContent = count;
    $("#manage-members").hidden = state.role !== "admin";
  }
}

$("#copy-room-id").addEventListener("click", async () => {
  if (!state.room) return;
  await navigator.clipboard.writeText(state.room.room_code);
  toast("Room ID copied.");
});

$("#manage-members").addEventListener("click", async () => {
  if (!state.room || state.role !== "admin") return;
  await loadMembers();
  openDialog("#members-dialog");
});

async function loadMembers() {
  const list = $("#member-list");
  list.replaceChildren();
  const { data: memberships, error } = await supabase.from("room_members").select("user_id,role,joined_at").eq("room_id", state.room.id).order("joined_at");
  if (error) return toast(error.message);
  const names = await loadProfiles((memberships || []).map((member) => member.user_id));
  for (const member of memberships || []) {
    const row = document.createElement("div");
    row.className = "member-row";
    const mark = document.createElement("span");
    mark.className = "room-monogram";
    const name = names.get(member.user_id) || "Classmate";
    mark.textContent = name.charAt(0).toUpperCase();
    const memberName = document.createElement("span");
    memberName.className = "member-name";
    memberName.textContent = name + (member.user_id === state.user.id ? " (you)" : "");
    const role = document.createElement("span");
    role.className = "member-role";
    role.textContent = member.role === "admin" ? "Admin" : "Member";
    row.append(mark, memberName, role);
    if (member.role !== "admin" && state.role === "admin") {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "member-remove";
      remove.textContent = "Remove";
      remove.addEventListener("click", async () => {
        if (!confirm(`Remove ${name} from this room? They will lose access to its shared content.`)) return;
        const { error: removeError } = await supabase.from("room_members").delete().eq("room_id", state.room.id).eq("user_id", member.user_id);
        if (removeError) return toast(removeError.message);
        await loadMembers();
        await loadMemberCount();
        toast("Member removed from this room.");
      });
      row.append(remove);
    }
    list.append(row);
  }
}

$("#rotate-room-code").addEventListener("click", async () => {
  if (!state.room || state.role !== "admin") return;
  if (!confirm("Replace this room ID? Students with the old ID will not be able to join again.")) return;
  const { data: roomCode, error } = await supabase.rpc("rotate_room_code", { p_room: state.room.id });
  if (error) return toast(error.message);
  state.room.room_code = roomCode;
  $("#room-id-label").textContent = roomCode;
  toast("Room ID rotated. Share the new ID with your class.");
});

$("#add-semester").addEventListener("click", () => openDialog("#semester-dialog"));
$("#manage-semester").addEventListener("click", () => {
  if (!state.semester || state.role !== "admin") return;
  $("#rename-semester").value = state.semester.name;
  openDialog("#manage-semester-dialog");
});

async function renameSemester(name) {
  if (!name || !state.semester) return;
  const { error } = await supabase.from("semesters").update({ name }).eq("id", state.semester.id);
  if (error) return toast(error.message);
  state.semester.name = name;
  await loadSemesters(name);
  toast("Semester renamed.");
}

async function deleteSemester() {
  if (!state.semester || state.role !== "admin") return;
  if (!confirm(`Delete ${state.semester.name}, all its subjects, chats, and files? This cannot be undone.`)) return;
  const { data: subjects, error: subjectError } = await supabase.from("subjects").select("id").eq("semester_id", state.semester.id);
  if (subjectError) return toast(subjectError.message);
  const ids = (subjects || []).map((item) => item.id);
  let paths = [];
  if (ids.length) {
    const { data: files, error: fileError } = await supabase.from("subject_files").select("storage_path").in("subject_id", ids);
    if (fileError) return toast(fileError.message);
    const { data: messages, error: messageError } = await supabase.from("subject_messages").select("attachment_path").in("subject_id", ids).not("attachment_path", "is", null);
    if (messageError) return toast(messageError.message);
    paths = [...new Set([...(files || []).map((item) => item.storage_path), ...(messages || []).map((item) => item.attachment_path)])];
  }
  if (paths.length) {
    const { error } = await supabase.storage.from("spirit-files").remove(paths);
    if (error) return toast(error.message);
  }
  const { error } = await supabase.from("semesters").delete().eq("id", state.semester.id);
  if (error) return toast(error.message);
  state.semester = null;
  await loadSemesters();
  await refreshRoomStorage();
  toast("Semester and its contents were removed.");
}
$("#save-semester-name").addEventListener("click", async () => {
  await renameSemester($("#rename-semester").value.trim());
  $("#manage-semester-dialog").close();
});
$("#delete-semester").addEventListener("click", async () => {
  await deleteSemester();
  if (state.semester === null) $("#manage-semester-dialog").close();
});
$("#semester-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = $("#new-semester-name").value.trim();
  if (!name || !state.room || state.role !== "admin") return;
  const { error } = await supabase.from("semesters").insert({ room_id: state.room.id, name, position: state.semesters.length });
  if (error) return toast(error.message);
  $("#semester-dialog").close();
  $("#semester-form").reset();
  await loadSemesters(name);
  toast("Semester added.");
});

async function loadSemesters(selectName) {
  const { data, error } = await supabase.from("semesters").select("id,name,position").eq("room_id", state.room.id).order("position").order("created_at");
  if (error) return toast(error.message);
  state.semesters = data || [];
  if (!state.semesters.length) {
    if (state.role === "admin") {
      const { error: insertError } = await supabase.from("semesters").insert({ room_id: state.room.id, name: "Semester 1", position: 0 });
      if (insertError) return toast(insertError.message);
      return loadSemesters("Semester 1");
    }
    state.semester = null;
    state.subjects = [];
    renderSemesterSelect();
    renderSubjects();
    return;
  }
  state.semester = state.semesters.find((item) => item.name === selectName) || state.semesters.find((item) => item.id === state.semester?.id) || state.semesters[0];
  renderSemesterSelect();
  await loadSubjects();
}

function renderSemesterSelect() {
  const select = $("#semester-select");
  select.replaceChildren();
  for (const semester of state.semesters) {
    const option = document.createElement("option");
    option.value = semester.id;
    option.textContent = semester.name;
    option.selected = semester.id === state.semester?.id;
    select.append(option);
  }
}

$("#semester-select").addEventListener("change", async (event) => {
  state.semester = state.semesters.find((item) => item.id === event.target.value) || null;
  state.subject = null;
  await loadSubjects();
});

$("#add-subject").addEventListener("click", () => {
  if (!state.semester) return toast("Add a semester first.");
  openDialog("#subject-dialog");
});
$("#subject-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.semester || state.role !== "admin") return;
  const name = $("#new-subject-name").value.trim();
  const course_code = $("#new-subject-code").value.trim();
  const { data, error } = await supabase.from("subjects").insert({ semester_id: state.semester.id, name, course_code }).select().single();
  if (error) return toast(error.message);
  $("#subject-dialog").close();
  $("#subject-form").reset();
  state.subjects.push(data);
  state.subject = data;
  renderSubjects();
  await loadSubjectFiles();
  toast("Subject added.");
});

async function loadSubjects() {
  if (!state.semester) return;
  $("#subjects-heading").textContent = state.semester.name;
  const { data, error } = await supabase.from("subjects").select("id,name,course_code").eq("semester_id", state.semester.id).order("name");
  if (error) return toast(error.message);
  state.subjects = data || [];
  state.subject = state.subjects.find((item) => item.id === state.subject?.id) || state.subjects[0] || null;
  renderSubjects();
  if (state.subject) await loadSubjectFiles();
}

function renderSubjects() {
  const list = $("#subject-list");
  list.replaceChildren();
  for (const subject of state.subjects) {
    const wrapper = document.createElement("div");
    wrapper.className = "subject-row-wrapper";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `subject-row${state.subject?.id === subject.id ? " is-active" : ""}`;
    const icon = document.createElement("span");
    icon.className = "subject-icon";
    icon.textContent = "✳";
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = subject.name;
    const code = document.createElement("small");
    code.textContent = subject.course_code || "Course materials";
    copy.append(name, code);
    button.append(icon, copy);
    button.addEventListener("click", async () => {
      state.subject = subject;
      renderSubjects();
      await loadSubjectFiles();
    });
    wrapper.append(button);
    if (state.role === "admin") {
      const actions = document.createElement("span");
      actions.className = "subject-row-actions";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = "···";
      edit.title = `Manage ${subject.name}`;
      edit.addEventListener("click", (event) => {
        event.stopPropagation();
        state.subject = subject;
        $("#rename-subject").value = subject.name;
        $("#rename-subject-code").value = subject.course_code || "";
        openDialog("#manage-subject-dialog");
      });
      actions.append(edit);
      wrapper.append(actions);
    }
    list.append(wrapper);
  }
  if (!state.subject) {
    $("#subject-detail").innerHTML = '<div class="sub-empty"><span>✦</span><h3>Choose a subject</h3><p>Notes, slides, and helpful links will live here.</p></div>';
  }
}

$("#save-subject").addEventListener("click", async () => {
  if (!state.subject || state.role !== "admin") return;
  const name = $("#rename-subject").value.trim();
  const course_code = $("#rename-subject-code").value.trim();
  if (!name) return toast("Subject name is required.");
  const { error } = await supabase.from("subjects").update({ name, course_code }).eq("id", state.subject.id);
  if (error) return toast(error.message);
  $("#manage-subject-dialog").close();
  await loadSubjects();
  toast("Subject updated.");
});

$("#delete-subject").addEventListener("click", async () => {
  if (!state.subject || state.role !== "admin") return;
  const subject = state.subject;
  if (!confirm(`Delete ${subject.name}, its subject chat, and all shared files? This cannot be undone.`)) return;
  const { data: files, error: fileError } = await supabase.from("subject_files").select("storage_path").eq("subject_id", subject.id);
  if (fileError) return toast(fileError.message);
  const { data: messages, error: messageError } = await supabase.from("subject_messages").select("attachment_path").eq("subject_id", subject.id).not("attachment_path", "is", null);
  if (messageError) return toast(messageError.message);
  const paths = [...new Set([...(files || []).map((item) => item.storage_path), ...(messages || []).map((item) => item.attachment_path)])];
  if (paths.length) {
    const { error } = await supabase.storage.from("spirit-files").remove(paths);
    if (error) return toast(error.message);
  }
  const { error } = await supabase.from("subjects").delete().eq("id", subject.id);
  if (error) return toast(error.message);
  $("#manage-subject-dialog").close();
  state.subject = null;
  await loadSubjects();
  await refreshRoomStorage();
  toast("Subject and its content were removed.");
});

async function loadSubjectFiles() {
  if (!state.subject) return;
  if (state.subjectChatChannel) {
    await supabase.removeChannel(state.subjectChatChannel);
    state.subjectChatChannel = null;
  }
  const detail = $("#subject-detail");
  detail.replaceChildren();
  const head = document.createElement("div");
  head.className = "subject-detail-head";
  const titleWrap = document.createElement("div");
  const label = document.createElement("p");
  label.className = "eyebrow";
  label.textContent = state.subject.course_code || "SUBJECT LIBRARY";
  const title = document.createElement("h3");
  title.textContent = state.subject.name;
  titleWrap.append(label, title);
  const inputId = `file-upload-${state.subject.id}`;
  const uploadLabel = document.createElement("label");
  uploadLabel.className = "file-upload-label";
  uploadLabel.htmlFor = inputId;
  uploadLabel.textContent = "＋ Upload file";
  const input = document.createElement("input");
  input.type = "file";
  input.id = inputId;
  input.hidden = true;
  input.accept = ".pdf,.png,.jpg,.jpeg,.webp,.gif";
  input.addEventListener("change", () => uploadSubjectFile(input.files?.[0]));
  head.append(titleWrap, uploadLabel, input);
  detail.append(head);
  const list = document.createElement("div");
  list.className = "subject-files";
  list.id = "current-files";
  detail.append(list);
  const { data, error } = await supabase.from("subject_files").select("id,room_id,user_id,display_name,storage_path,mime_type,file_size,created_at").eq("subject_id", state.subject.id).order("created_at", { ascending: false });
  if (error) return toast(error.message);
  if (!data?.length) {
    const empty = document.createElement("p");
    empty.className = "no-files";
    empty.textContent = "No files here yet. Upload the first set of notes.";
    list.append(empty);
  } else for (const file of data) list.append(buildFileRow(file));
  const chat = document.createElement("section");
  chat.className = "subject-chat";
  const chatHead = document.createElement("div");
  chatHead.className = "subject-chat-head";
  const chatTitle = document.createElement("div");
  chatTitle.innerHTML = '<p class="eyebrow">QUESTIONS, NOTES & QUICK SHARES</p><h4>Subject chat</h4>';
  chatHead.append(chatTitle);
  const messages = document.createElement("div");
  messages.className = "subject-message-list";
  messages.id = "subject-message-list";
  const form = document.createElement("form");
  form.className = "subject-chat-form";
  form.id = "subject-chat-form";
  const replyContext = document.createElement("div");
  replyContext.className = "reply-context subject-reply-context";
  replyContext.id = "subject-reply-context";
  replyContext.hidden = true;
  const replyLabel = document.createElement("span");
  replyLabel.id = "subject-reply-label";
  const replyCancel = document.createElement("button");
  replyCancel.type = "button";
  replyCancel.textContent = "×";
  replyCancel.addEventListener("click", () => { state.subjectReplyTo = null; replyContext.hidden = true; });
  replyContext.append(replyLabel, replyCancel);
  const text = document.createElement("input");
  text.id = "subject-chat-input";
  text.type = "text";
  text.maxLength = 1200;
  text.placeholder = "Ask or share something in this subject…";
  text.setAttribute("aria-label", "Write in subject chat");
  const attach = document.createElement("label");
  attach.className = "file-upload-label";
  attach.htmlFor = "subject-chat-attachment";
  attach.textContent = "PDF / image";
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.id = "subject-chat-attachment";
  fileInput.hidden = true;
  fileInput.accept = ".pdf,.png,.jpg,.jpeg,.webp,.gif,application/pdf,image/png,image/jpeg,image/webp,image/gif";
  const send = document.createElement("button");
  send.className = "send-button";
  send.type = "submit";
  send.textContent = "↗";
  send.setAttribute("aria-label", "Send to subject chat");
  form.append(replyContext, text, attach, fileInput, send);
  form.addEventListener("submit", sendSubjectMessage);
  fileInput.addEventListener("change", () => { attach.textContent = fileInput.files?.[0]?.name || "PDF / image"; });
  chat.append(chatHead, messages, form);
  detail.append(chat);
  await loadSubjectChat();
}

async function loadSubjectChat() {
  if (!state.subject) return;
  const list = $("#subject-message-list");
  const { data: messages, error } = await supabase.from("subject_messages").select("id,subject_id,room_id,user_id,body,attachment_path,attachment_name,attachment_type,attachment_size,reply_to_id,created_at").eq("subject_id", state.subject.id).order("created_at", { ascending: true }).limit(100);
  if (error) return toast(error.message);
  list.replaceChildren();
  if (!messages?.length) {
    const empty = document.createElement("p");
    empty.className = "no-files";
    empty.textContent = "Start the conversation for this subject. Share a question, PDF, or image.";
    list.append(empty);
  } else {
    const names = await loadProfiles(messages.map((message) => message.user_id));
    const { data: reactions } = await supabase.from("chat_reactions").select("id,subject_message_id,user_id,emoji").in("subject_message_id", messages.map((message) => message.id));
    const grouped = groupReactions(reactions || []);
    const messageMap = new Map(messages.map((message) => [message.id, message]));
    for (const message of messages) {
      const row = document.createElement("article");
      row.className = `subject-message${message.user_id === state.user.id ? " own" : ""}`;
      if (message.reply_to_id && messageMap.has(message.reply_to_id)) {
        const parent = messageMap.get(message.reply_to_id);
        const quote = document.createElement("small");
        quote.className = "message-quote";
        quote.textContent = `↳ ${names.get(parent.user_id) || "Classmate"}: ${parent.body || parent.attachment_name || "file"}`;
        row.append(quote);
      }
      const meta = document.createElement("small");
      meta.textContent = `${names.get(message.user_id) || "Classmate"} · ${new Date(message.created_at).toLocaleString()}`;
      row.append(meta);
      if (message.body) {
        const content = document.createElement("p");
        content.textContent = message.body;
        row.append(content);
      }
      if (message.attachment_path) {
        if (isPdfAttachment(message)) {
          const actions = document.createElement("div");
          actions.className = "subject-attachment-actions";
          const preview = document.createElement("button");
          preview.type = "button";
          preview.className = "subject-attachment-button";
          preview.textContent = `View PDF · ${message.attachment_name}`;
          preview.addEventListener("click", () => openPdfViewer(message.attachment_path, message.attachment_name));
          const save = document.createElement("button");
          save.type = "button";
          save.className = "subject-attachment-button";
          save.textContent = "Download";
          save.addEventListener("click", () => downloadSubjectAttachment(message.attachment_path, message.attachment_name));
          actions.append(preview, save);
          row.append(actions);
        } else {
          const { data: signed } = await supabase.storage.from("spirit-files").createSignedUrl(message.attachment_path, 3600);
          if (signed?.signedUrl) {
            const link = document.createElement("a");
            link.href = signed.signedUrl;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = `↓ ${message.attachment_name} · ${formatBytes(message.attachment_size)}`;
            row.append(link);
          }
        }
      }
      const messageReactions = grouped.get(message.id) || [];
      if (messageReactions.length) {
        const strip = document.createElement("div");
        strip.className = "reaction-strip";
        for (const reaction of messageReactions) {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = `reaction-chip${reaction.user_id === state.user.id ? " mine" : ""}`;
          chip.textContent = reaction.emoji;
          chip.addEventListener("click", () => toggleReaction({ subject_message_id: message.id }, reaction.emoji));
          strip.append(chip);
        }
        row.append(strip);
      }
      const actions = document.createElement("div");
      actions.className = "message-actions";
      const reply = document.createElement("button");
      reply.type = "button";
      reply.textContent = "Reply";
      reply.addEventListener("click", () => {
        state.subjectReplyTo = message;
        $("#subject-reply-label").textContent = `Replying to ${names.get(message.user_id) || "Classmate"} · ${message.body || message.attachment_name || "file"}`;
        $("#subject-reply-context").hidden = false;
        $("#subject-chat-input").focus();
      });
      actions.append(reply);
      for (const emoji of ["❤️", "😂", "👍", "🔥", "👀", "🙌"]) {
        const react = document.createElement("button");
        react.type = "button";
        react.textContent = emoji;
        react.addEventListener("click", () => toggleReaction({ subject_message_id: message.id }, emoji));
        actions.append(react);
      }
      row.append(actions);
      list.append(row);
    }
  }
  list.scrollTop = list.scrollHeight;
  if (!state.subjectChatChannel) {
    state.subjectChatChannel = supabase.channel(`subject-chat-${state.subject.id}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "subject_messages", filter: `subject_id=eq.${state.subject.id}` }, () => loadSubjectChat()).on("postgres_changes", { event: "*", schema: "public", table: "chat_reactions" }, () => loadSubjectChat()).subscribe();
  }
}

async function sendSubjectMessage(event) {
  event.preventDefault();
  if (!state.subject || !state.room) return;
  const body = $("#subject-chat-input").value.trim();
  const file = $("#subject-chat-attachment").files?.[0];
  if (!body && !file) return;
  if (file && file.size > MAX_UPLOAD) return toast("Files must be 50 MB or smaller.");
  if (file && !(file.type === "application/pdf" || ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type))) return toast("Only PDFs and images can be shared here.");
  if (file && !(await canUploadToRoom(file))) return;
  let attachment_path = null;
  if (file) {
    attachment_path = `${state.room.id}/${crypto.randomUUID()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error } = await supabase.storage.from("spirit-files").upload(attachment_path, file, { contentType: file.type, upsert: false });
    if (error) return toast(error.message);
  }
  const row = { subject_id: state.subject.id, room_id: state.room.id, user_id: state.user.id, body, attachment_path, attachment_name: file?.name || null, attachment_type: file?.type || null, attachment_size: file?.size || null, reply_to_id: state.subjectReplyTo?.id || null };
  if (file) {
    const { error: indexError } = await supabase.from("subject_files").insert({ subject_id: state.subject.id, room_id: state.room.id, user_id: state.user.id, display_name: file.name, storage_path: attachment_path, mime_type: file.type, file_size: file.size });
    if (indexError) {
      await supabase.storage.from("spirit-files").remove([attachment_path]);
      return toast(indexError.message);
    }
  }
  const { error } = await supabase.from("subject_messages").insert(row);
  if (error) {
    if (file) await supabase.from("subject_files").delete().eq("storage_path", attachment_path);
    if (attachment_path) await supabase.storage.from("spirit-files").remove([attachment_path]);
    return toast(error.message);
  }
  $("#subject-chat-input").value = "";
  state.subjectReplyTo = null;
  $("#subject-reply-context").hidden = true;
  $("#subject-chat-attachment").value = "";
  $(".subject-chat-form .file-upload-label").textContent = "PDF / image";
  await loadSubjectFiles();
  await refreshRoomStorage();
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}


let pdfJsPromise;
let activePdfDocument = null;
let activePdfObserver = null;
let activePdfScale = 1;
let pdfViewerRequestId = 0;

function isPdfAttachment(file) {
  return file?.mime_type === "application/pdf" || file?.attachment_type === "application/pdf" || /\.pdf$/i.test(file?.display_name || file?.attachment_name || "");
}

function getPdfViewer() {
  let dialog = document.getElementById("pdf-viewer-dialog");
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.id = "pdf-viewer-dialog";
  dialog.className = "pdf-viewer-dialog";
  dialog.setAttribute("aria-label", "PDF document viewer");
  dialog.innerHTML = `
    <div class="pdf-viewer-shell">
      <header class="pdf-viewer-toolbar">
        <strong class="pdf-viewer-title">PDF preview</strong>
        <div class="pdf-viewer-actions">
          <button type="button" data-pdf-zoom-out aria-label="Zoom out">−</button>
          <button type="button" data-pdf-zoom-in aria-label="Zoom in">＋</button>
          <a data-pdf-download href="#" download>Download</a>
          <button type="button" data-pdf-close aria-label="Close PDF viewer">×</button>
        </div>
      </header>
      <p class="pdf-viewer-status" role="status" aria-live="polite">Loading document…</p>
      <div class="pdf-viewer-pages" tabindex="0" aria-label="PDF pages"></div>
    </div>`;
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog || event.target.closest("[data-pdf-close]")) dialog.close();
  });
  dialog.querySelector("[data-pdf-zoom-in]").addEventListener("click", () => changePdfZoom(0.15));
  dialog.querySelector("[data-pdf-zoom-out]").addEventListener("click", () => changePdfZoom(-0.15));
  dialog.addEventListener("close", () => {
    pdfViewerRequestId++;
    activePdfObserver?.disconnect();
    activePdfObserver = null;
    activePdfDocument?.destroy?.();
    activePdfDocument = null;
    dialog.querySelector(".pdf-viewer-pages").replaceChildren();
    dialog.querySelector(".pdf-viewer-status").textContent = "";
  });
  document.body.append(dialog);
  return dialog;
}

function changePdfZoom(delta) {
  if (!activePdfDocument) return;
  activePdfScale = Math.min(2.2, Math.max(0.65, activePdfScale + delta));
  const dialog = getPdfViewer();
  dialog.querySelectorAll(".pdf-page").forEach((page) => {
    page.dataset.rendered = "false";
    const canvas = page.querySelector("canvas");
    if (canvas) canvas.remove();
    activePdfObserver?.observe(page);
  });
}

async function openPdfViewer(storagePath, fileName) {
  const requestId = ++pdfViewerRequestId;
  const dialog = getPdfViewer();
  const title = dialog.querySelector(".pdf-viewer-title");
  const status = dialog.querySelector(".pdf-viewer-status");
  const pages = dialog.querySelector(".pdf-viewer-pages");
  const download = dialog.querySelector("[data-pdf-download]");
  activePdfObserver?.disconnect();
  activePdfDocument?.destroy?.();
  activePdfDocument = null;
  activePdfScale = 1;
  pages.replaceChildren();
  title.textContent = fileName || "PDF preview";
  status.textContent = "Loading document…";
  download.removeAttribute("href");
  if (!dialog.open) dialog.showModal();
  try {
    // Obtain the signed preview URL first so Download still works if the PDF.js CDN is unavailable.
    const { data, error } = await supabase.storage.from("spirit-files").createSignedUrl(storagePath, 3600);
    if (error || !data?.signedUrl) throw error || new Error("Could not create a secure PDF link.");
    if (!dialog.open || requestId !== pdfViewerRequestId) return;
    const { data: downloadData, error: downloadError } = await supabase.storage.from("spirit-files").createSignedUrl(storagePath, 3600, { download: fileName || "document.pdf" });
    if (downloadData?.signedUrl) download.href = downloadData.signedUrl;
    else {
      download.href = data.signedUrl;
      download.download = fileName || "document.pdf";
      if (downloadError) console.warn("PDF download URL fallback", downloadError);
    }
    // Load the heavier PDF renderer only after the signed file URL is ready.
    const pdfjs = await (pdfJsPromise || (pdfJsPromise = import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs")));
    if (!dialog.open || requestId !== pdfViewerRequestId) return;
    pdfjs.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
    const pdf = await pdfjs.getDocument({ url: data.signedUrl }).promise;
    if (!dialog.open || requestId !== pdfViewerRequestId) { pdf.destroy(); return; }
    activePdfDocument = pdf;
    status.textContent = `${pdf.numPages} page${pdf.numPages === 1 ? "" : "s"} · Scroll to read`;
    const fragment = document.createDocumentFragment();
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = document.createElement("section");
      page.className = "pdf-page";
      page.dataset.page = String(pageNumber);
      page.dataset.rendered = "false";
      page.setAttribute("aria-label", `Page ${pageNumber}`);
      const label = document.createElement("span");
      label.className = "pdf-page-number";
      label.textContent = `Page ${pageNumber}`;
      page.append(label);
      fragment.append(page);
    }
    pages.append(fragment);
    const renderPage = async (container) => {
      if (container.dataset.rendered === "true" || !activePdfDocument) return;
      container.dataset.rendered = "true";
      try {
        const page = await activePdfDocument.getPage(Number(container.dataset.page));
        const base = page.getViewport({ scale: 1 });
        const width = Math.max(240, pages.clientWidth - 24);
        const scale = Math.min(width / base.width, 1.8) * activePdfScale;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { alpha: false });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        await page.render({ canvasContext: context, viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] }).promise;
        if (activePdfDocument && dialog.open && requestId === pdfViewerRequestId) container.append(canvas);
      } catch (renderError) {
        container.dataset.rendered = "false";
        console.error("PDF page render failed", renderError);
      }
    };
    activePdfObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          activePdfObserver.unobserve(entry.target);
          renderPage(entry.target);
        }
      });
    }, { root: pages, rootMargin: "500px 0px" });
    pages.querySelectorAll(".pdf-page").forEach((page) => activePdfObserver.observe(page));
  } catch (error) {
    if (requestId === pdfViewerRequestId) {
      status.textContent = download.href
        ? "Preview unavailable. You can still download this PDF."
        : "This PDF could not be displayed. Please try again.";
    }
    console.error("PDF viewer error", error);
  }
}

async function downloadSubjectAttachment(storagePath, fileName) {
  const { data, error } = await supabase.storage.from("spirit-files").createSignedUrl(storagePath, 300, { download: fileName });
  if (error) return toast(error.message);
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}

function buildFileRow(file) {
  const row = document.createElement("div");
  row.className = "file-row";
  const type = document.createElement("span");
  type.className = "file-type";
  type.textContent = file.display_name.split(".").pop().slice(0, 5);
  const copy = document.createElement("span");
  copy.className = "file-copy";
  const title = document.createElement("strong");
  title.textContent = file.display_name;
  const meta = document.createElement("small");
  meta.textContent = `${formatBytes(file.file_size)} · ${new Date(file.created_at).toLocaleDateString()}`;
  copy.append(title, meta);
  const download = document.createElement("button");
  download.type = "button";
  download.className = "file-action";
  download.title = "Download file";
  download.setAttribute("aria-label", `Download ${file.display_name}`);
  download.textContent = "↓";
  download.addEventListener("click", async () => {
    const { data, error } = await supabase.storage.from("spirit-files").createSignedUrl(file.storage_path, 300, { download: file.display_name });
    if (error) return toast(error.message);
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  });
  row.append(type, copy);
  if (isPdfAttachment(file)) {
    const preview = document.createElement("button");
    preview.type = "button";
    preview.className = "file-action";
    preview.title = "View PDF";
    preview.setAttribute("aria-label", `View ${file.display_name}`);
    preview.textContent = "↗";
    preview.addEventListener("click", () => openPdfViewer(file.storage_path, file.display_name));
    row.append(preview);
  }
  row.append(download);
  if (file.user_id === state.user.id || state.role === "admin") {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "file-action";
    remove.textContent = "×";
    remove.title = "Remove file";
    remove.setAttribute("aria-label", `Remove ${file.display_name}`);
    remove.addEventListener("click", () => removeSubjectFile(file));
    row.append(remove);
  }
  return row;
}

async function uploadSubjectFile(file) {
  if (!file || !state.subject || !state.room) return;
  if (file.size > MAX_UPLOAD) return toast("Files must be 50 MB or smaller on the free plan.");
  if (!(await canUploadToRoom(file))) return;
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${state.room.id}/${crypto.randomUUID()}_${safeName}`;
  setBusy(true);
  const { error: uploadError } = await supabase.storage.from("spirit-files").upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
  if (uploadError) { setBusy(false); return toast(uploadError.message); }
  const { error } = await supabase.from("subject_files").insert({ subject_id: state.subject.id, room_id: state.room.id, user_id: state.user.id, display_name: file.name, storage_path: path, mime_type: file.type || "application/octet-stream", file_size: file.size });
  if (error) {
    await supabase.storage.from("spirit-files").remove([path]);
    setBusy(false);
    return toast(error.message);
  }
  setBusy(false);
  toast("File shared with the room.");
  await loadSubjectFiles();
  await refreshRoomStorage();
}

async function removeSubjectFile(file) {
  if (!confirm(`Remove “${file.display_name}” from this subject?`)) return;
  const { error } = await supabase.from("subject_files").delete().eq("id", file.id);
  if (error) return toast(error.message);
  await supabase.storage.from("spirit-files").remove([file.storage_path]);
  await loadSubjectFiles();
  await refreshRoomStorage();
  toast("File removed.");
}

function selectSection(id) {
  $$(".room-tab").forEach((button) => button.classList.toggle("is-active", button.dataset.section === id));
  $$(".room-section").forEach((section) => { section.hidden = section.id !== id; });
  if (id === "chat-section" && state.room) loadMessages();
  if (id === "memories-section" && state.room) loadMemories();
}
$$(".room-tab").forEach((button) => button.addEventListener("click", () => selectSection(button.dataset.section)));

function getProfileName(userId, profileMap) {
  return profileMap.get(userId) || "Classmate";
}

async function loadMessages() {
  if (!state.room || $("#chat-section").hidden) return;
  const list = $("#message-list");
  const { data: messages, error } = await supabase.from("messages").select("id,room_id,user_id,body,message_kind,attachment_path,attachment_type,reply_to_id,created_at").eq("room_id", state.room.id).order("created_at", { ascending: true }).limit(100);
  if (error) return toast(error.message);
  list.replaceChildren();
  if (!messages?.length) {
    const placeholder = document.createElement("div");
    placeholder.className = "chat-placeholder";
    const icon = document.createElement("span");
    icon.textContent = "✳";
    const text = document.createElement("p");
    text.textContent = "Say hi to your room. Questions, ideas, and tiny wins all belong here.";
    placeholder.append(icon, text);
    list.append(placeholder);
  } else {
    const profiles = await loadProfiles(messages.map((message) => message.user_id));
    const messageIds = messages.map((message) => message.id);
    const { data: reactions } = await supabase.from("chat_reactions").select("id,message_id,user_id,emoji").in("message_id", messageIds);
    const grouped = groupReactions(reactions || []);
    const messageMap = new Map(messages.map((message) => [message.id, message]));
    const attachments = messages.filter((message) => message.attachment_path);
    const attachmentEntries = [];
    // Limit concurrent signed-URL requests to avoid flooding Storage on large chat histories.
    for (let index = 0; index < attachments.length; index += 8) {
      const batch = attachments.slice(index, index + 8);
      const signedBatch = await Promise.all(batch.map(async (message) => {
        const { data } = await supabase.storage.from("spirit-files").createSignedUrl(message.attachment_path, 3600);
        return [message.id, data?.signedUrl || null];
      }));
      attachmentEntries.push(...signedBatch);
    }
    const attachmentUrls = new Map(attachmentEntries);
    const rendered = await Promise.all(messages.map((message) => buildMessage(message, profiles, messageMap, grouped.get(message.id) || [], attachmentUrls.get(message.id))));
    const fragment = document.createDocumentFragment();
    rendered.forEach((element) => fragment.append(element));
    list.append(fragment);
  }
  list.scrollTop = list.scrollHeight;
  if (!state.chatChannel) {
    state.chatChannel = supabase.channel(`room-chat-${state.room.id}`).on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `room_id=eq.${state.room.id}` }, () => loadMessages()).on("postgres_changes", { event: "*", schema: "public", table: "chat_reactions" }, () => loadMessages()).subscribe();
  }
}

async function loadProfiles(ids) {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const { data, error } = await supabase.from("profiles").select("id,display_name").in("id", unique);
  if (error) return new Map();
  return new Map((data || []).map((profile) => [profile.id, profile.display_name]));
}

function groupReactions(reactions) {
  const grouped = new Map();
  for (const reaction of reactions) {
    const key = reaction.message_id || reaction.subject_message_id;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(reaction);
  }
  return grouped;
}

async function buildMessage(message, profiles, messageMap, reactions, attachmentUrl) {
  const name = getProfileName(message.user_id, profiles);
  const own = message.user_id === state.user.id;
  const article = document.createElement("article");
  article.className = `message${own ? " own" : ""}`;
  const avatar = document.createElement("span");
  avatar.className = "message-avatar";
  avatar.textContent = name.trim().charAt(0).toUpperCase() || "S";
  const body = document.createElement("div");
  body.className = "message-body";
  const meta = document.createElement("p");
  meta.className = "message-meta";
  meta.textContent = `${own ? "You" : name} · ${new Date(message.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  if (message.reply_to_id && messageMap.has(message.reply_to_id)) {
    const parent = messageMap.get(message.reply_to_id);
    const quote = document.createElement("div");
    quote.className = "message-quote";
    quote.textContent = `↳ ${getProfileName(parent.user_id, profiles)}: ${parent.body || "GIF"}`;
    bubble.append(quote);
  }
  if (message.message_kind === "sticker") {
    const sticker = STICKERS.find((item) => `${item.icon} ${item.text}` === message.body);
    if (sticker) {
      bubble.className = "sticker-bubble";
      const icon = document.createElement("span");
      icon.textContent = sticker.icon;
      bubble.append(icon, document.createTextNode(sticker.text));
    } else bubble.textContent = message.body;
  } else if (message.body) bubble.textContent = message.body;
  if (message.attachment_path && attachmentUrl) {
    const image = document.createElement("img");
    image.className = "message-gif";
    image.src = attachmentUrl;
    image.alt = "GIF shared in chat";
    image.loading = "lazy";
    image.decoding = "async";
    bubble.append(image);
  }
  body.append(meta, bubble);
  if (reactions.length) {
    const strip = document.createElement("div");
    strip.className = "reaction-strip";
    for (const reaction of reactions) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `reaction-chip${reaction.user_id === state.user.id ? " mine" : ""}`;
      chip.textContent = reaction.emoji;
      chip.setAttribute("aria-label", `Remove your ${reaction.emoji} reaction`);
      chip.addEventListener("click", () => toggleReaction({ message_id: message.id }, reaction.emoji));
      strip.append(chip);
    }
    body.append(strip);
  }
  const actions = document.createElement("div");
  actions.className = "message-actions";
  const reply = document.createElement("button");
  reply.type = "button";
  reply.textContent = "Reply";
  reply.addEventListener("click", () => setRoomReply(message, profiles));
  actions.append(reply);
  for (const emoji of ["❤️", "😂", "👍", "🔥", "👀", "🙌"]) {
    const react = document.createElement("button");
    react.type = "button";
    react.textContent = emoji;
    react.setAttribute("aria-label", `React ${emoji}`);
    react.addEventListener("click", () => toggleReaction({ message_id: message.id }, emoji));
    actions.append(react);
  }
  body.append(actions);
  article.append(avatar, body);
  return article;
}

function setRoomReply(message, profiles) {
  state.replyTo = message;
  $("#reply-context-label").textContent = `Replying to ${getProfileName(message.user_id, profiles)} · ${message.body || "GIF"}`;
  $("#reply-context").hidden = false;
  $("#chat-input").focus();
}

$("#cancel-reply").addEventListener("click", () => {
  state.replyTo = null;
  $("#reply-context").hidden = true;
});

async function toggleReaction(target, emoji) {
  const column = target.message_id ? "message_id" : "subject_message_id";
  let query = supabase.from("chat_reactions").select("id").eq(column, target[column]).eq("user_id", state.user.id).eq("emoji", emoji);
  const { data, error } = await query.maybeSingle();
  if (error) return toast(error.message);
  if (data) {
    const { error: removeError } = await supabase.from("chat_reactions").delete().eq("id", data.id);
    if (removeError) return toast(removeError.message);
  } else {
    const { error: addError } = await supabase.from("chat_reactions").insert({ ...target, user_id: state.user.id, emoji });
    if (addError) return toast(addError.message);
  }
  if (target.message_id) await loadMessages();
  else await loadSubjectChat();
}

$("#chat-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = $("#chat-input").value.trim();
  if (!body || !state.room) return;
  const { error } = await supabase.from("messages").insert({ room_id: state.room.id, user_id: state.user.id, body, message_kind: "text", reply_to_id: state.replyTo?.id || null });
  if (error) return toast(error.message);
  $("#chat-input").value = "";
  state.replyTo = null;
  $("#reply-context").hidden = true;
  await loadMessages();
});

const picker = $("#emoji-picker");
for (const emoji of EMOJIS) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "emoji-choice";
  button.textContent = emoji;
  button.setAttribute("aria-label", `Insert ${emoji}`);
  button.addEventListener("click", () => {
    const input = $("#chat-input");
    input.value += emoji;
    input.focus();
    picker.hidden = true;
  });
  picker.append(button);
}
$("#emoji-button").addEventListener("click", () => { picker.hidden = !picker.hidden; });
const stickerPicker = $("#sticker-picker");
for (const sticker of STICKERS) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sticker-choice";
  const icon = document.createElement("span");
  icon.textContent = sticker.icon;
  button.append(icon, document.createTextNode(sticker.text));
  button.addEventListener("click", async () => {
    if (!state.room) return;
    const body = `${sticker.icon} ${sticker.text}`;
    const { error } = await supabase.from("messages").insert({ room_id: state.room.id, user_id: state.user.id, body, message_kind: "sticker" });
    if (error) toast(error.message);
    stickerPicker.hidden = true;
    if (!error) await loadMessages();
  });
  stickerPicker.append(button);
}
$("#sticker-button").addEventListener("click", () => { stickerPicker.hidden = !stickerPicker.hidden; });
document.addEventListener("click", (event) => {
  if (!picker.contains(event.target) && event.target !== $("#emoji-button")) picker.hidden = true;
  if (!stickerPicker.contains(event.target) && event.target !== $("#sticker-button")) stickerPicker.hidden = true;
});

$("#gif-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file || !state.room) return;
  if (file.type !== "image/gif") return toast("Choose a GIF image.");
  if (file.size > 5 * 1024 * 1024) return toast("Chat GIFs must be 5 MB or smaller.");
  const path = `${state.room.id}/${crypto.randomUUID()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  setBusy(true);
  const { error: uploadError } = await supabase.storage.from("spirit-files").upload(path, file, { contentType: "image/gif", upsert: false });
  if (uploadError) { setBusy(false); return toast(uploadError.message); }
  const { error } = await supabase.from("messages").insert({ room_id: state.room.id, user_id: state.user.id, body: "", attachment_path: path, attachment_type: "gif" });
  setBusy(false);
  if (error) { await supabase.storage.from("spirit-files").remove([path]); return toast(error.message); }
  await loadMessages();
});

$("#memory-files").addEventListener("change", async (event) => {
  const files = [...(event.target.files || [])];
  event.target.value = "";
  if (!state.room || !files.length) return;
  for (const file of files) {
    const media_type = ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type) ? "image" : null;
    if (!media_type) { toast(`Skipping unsupported file: ${file.name}`); continue; }
    if (file.size > MAX_UPLOAD) { toast(`${file.name} is over the 50 MB limit.`); continue; }
    if (!(await canUploadToRoom(file))) continue;
    const path = `${state.room.id}/${crypto.randomUUID()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    setBusy(true);
    const { error: uploadError } = await supabase.storage.from("spirit-memories").upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) { setBusy(false); toast(uploadError.message); continue; }
    const { error } = await supabase.from("memories").insert({ room_id: state.room.id, user_id: state.user.id, storage_path: path, media_type, file_size: file.size, caption: "" });
    if (error) {
      await supabase.storage.from("spirit-memories").remove([path]);
      toast(error.message);
    }
    setBusy(false);
  }
  await loadMemories();
  await refreshRoomStorage();
});

async function loadMemories() {
  if (!state.room) return;
  const grid = $("#memory-grid");
  grid.replaceChildren();
  const { data, error } = await supabase.from("memories").select("id,room_id,user_id,storage_path,media_type,caption,created_at").eq("room_id", state.room.id).order("created_at", { ascending: false });
  if (error) return toast(error.message);
  $("#memory-empty").hidden = !!data?.length;
  for (const memory of data || []) {
    const { data: signed, error: signedError } = await supabase.storage.from("spirit-memories").createSignedUrl(memory.storage_path, 3600);
    if (signedError) continue;
    const card = document.createElement("article");
    card.className = "memory-card";
    const media = document.createElement("img");
    media.alt = memory.caption || "A shared room memory";
    media.loading = "lazy";
    media.src = signed.signedUrl;
    card.append(media);
    if (memory.caption) {
      const caption = document.createElement("span");
      caption.className = "memory-caption";
      caption.textContent = memory.caption;
      card.append(caption);
    }
    if (memory.user_id === state.user.id || state.role === "admin") {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "memory-delete";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => removeMemory(memory));
      card.append(remove);
    }
    grid.append(card);
  }
}

async function removeMemory(memory) {
  if (!confirm("Remove this memory from the room?")) return;
  const { error } = await supabase.from("memories").delete().eq("id", memory.id);
  if (error) return toast(error.message);
  await supabase.storage.from("spirit-memories").remove([memory.storage_path]);
  await loadMemories();
  await refreshRoomStorage();
}

$("#name-room-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const display_name = $("#new-display-name").value.trim();
  if (!display_name || !state.user) return;
  const { birth_month, birth_day } = readBirthday($("#new-birthday").value);
  const { data, error } = await supabase.from("profiles").upsert({ id: state.user.id, display_name, birth_month, birth_day }).select().single();
  if (error) return toast(error.message);
  state.profile = data;
  $("#name-room-dialog").close();
  updateAccount();
  toast("Display name saved.");
});

$("#account-name").addEventListener("click", () => {
  $("#new-display-name").value = state.profile?.display_name || "";
  const month = String(state.profile?.birth_month || 1).padStart(2, "0");
  const day = String(state.profile?.birth_day || 1).padStart(2, "0");
  $("#new-birthday").value = state.profile?.birth_month && state.profile?.birth_day ? `${new Date().getFullYear()}-${month}-${day}` : "";
  openDialog("#name-room-dialog");
});
$("#account-name").setAttribute("title", "Click to edit your display name");

if ("serviceWorker" in navigator && window.location.protocol.startsWith("http")) {
  const hubApp = window.location.pathname.startsWith("/Spirit/hub/");
  const workerPath = hubApp ? "/Spirit/hub/sw.js" : "/Spirit/sw.js";
  const workerScope = hubApp ? "/Spirit/hub/" : "/Spirit/";
  navigator.serviceWorker.register(workerPath, { scope: workerScope }).catch(() => {});
}

let pendingInstallPrompt = null;
const installButton = $("#install-app");
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  pendingInstallPrompt = event;
  installButton.hidden = false;
});
installButton.addEventListener("click", async () => {
  if (!pendingInstallPrompt) {
    toast("On iPhone/iPad, open Share and choose Add to Home Screen.");
    return;
  }
  pendingInstallPrompt.prompt();
  await pendingInstallPrompt.userChoice;
  pendingInstallPrompt = null;
  installButton.hidden = true;
});
window.addEventListener("appinstalled", () => {
  pendingInstallPrompt = null;
  installButton.hidden = true;
  toast("SpiritHUB is installed.");
});

function updateOnlineState() {
  $("#offline-banner").hidden = navigator.onLine;
}
window.addEventListener("online", updateOnlineState);
window.addEventListener("offline", updateOnlineState);
updateOnlineState();

