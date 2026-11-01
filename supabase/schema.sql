-- SpiritHUB Workspaces: run this once in your Supabase project's SQL Editor.
-- Tables are prefixed hub_ so they can live beside the main app's tables in the same project.

-- ---------- Tables ----------

create table public.hub_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  created_at timestamptz not null default now()
);

create table public.hub_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  academic_year text check (char_length(academic_year) <= 40),
  created_by uuid not null references public.hub_profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.hub_members (
  workspace_id uuid not null references public.hub_workspaces(id) on delete cascade,
  user_id uuid not null references public.hub_profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- One invite code per workspace; every member can copy it, only admins can reset it.
create table public.hub_invites (
  workspace_id uuid primary key references public.hub_workspaces(id) on delete cascade,
  code text not null unique,
  updated_at timestamptz not null default now()
);

create table public.hub_semesters (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.hub_workspaces(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  position int not null default 0,
  created_at timestamptz not null default now()
);

-- semester_id null = a workspace-wide channel such as #general.
create table public.hub_channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.hub_workspaces(id) on delete cascade,
  semester_id uuid references public.hub_semesters(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  course_code text check (char_length(course_code) <= 20),
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table public.hub_files (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.hub_workspaces(id) on delete cascade,
  channel_id uuid not null references public.hub_channels(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.hub_profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  path text not null unique,
  mime text not null check (mime in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif')),
  size bigint not null check (size between 1 and 52428800),
  summary text check (char_length(summary) <= 20000),
  summarized_by uuid references public.hub_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.hub_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.hub_workspaces(id) on delete cascade,
  channel_id uuid not null references public.hub_channels(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.hub_profiles(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 4000),
  file_id uuid references public.hub_files(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (char_length(btrim(body)) > 0 or file_id is not null)
);

create index hub_members_user_idx on public.hub_members (user_id);
create index hub_semesters_workspace_idx on public.hub_semesters (workspace_id);
create index hub_channels_workspace_idx on public.hub_channels (workspace_id);
create index hub_files_channel_idx on public.hub_files (channel_id, created_at desc);
create index hub_messages_channel_idx on public.hub_messages (channel_id, created_at desc);

-- ---------- Helpers ----------

create or replace function public.hub_is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.hub_members where workspace_id = ws and user_id = auth.uid());
$$;

create or replace function public.hub_is_admin(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.hub_members where workspace_id = ws and user_id = auth.uid() and role = 'admin');
$$;

create or replace function public.hub_shares_workspace(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.hub_members mine
    join public.hub_members theirs on theirs.workspace_id = mine.workspace_id
    where mine.user_id = auth.uid() and theirs.user_id = other
  );
$$;

-- 12 hex characters (48 random bits) from a v4 UUID.
create or replace function public.hub_new_code() returns text
language sql volatile set search_path = public as $$
  select substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
$$;

-- Create the profile from the display name the sign-up form sends.
create or replace function public.hub_handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.raw_user_meta_data ? 'hub_display_name' then
    insert into public.hub_profiles (id, display_name)
    values (new.id, coalesce(nullif(left(btrim(new.raw_user_meta_data ->> 'hub_display_name'), 40), ''), 'Student'))
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

create trigger hub_on_auth_user_created
after insert on auth.users
for each row execute function public.hub_handle_new_user();

-- Whoever saves a summary is recorded as its author.
create or replace function public.hub_stamp_summary() returns trigger
language plpgsql set search_path = public as $$
begin
  new.summarized_by := auth.uid();
  return new;
end;
$$;

create trigger hub_files_stamp_summary
before update of summary on public.hub_files
for each row execute function public.hub_stamp_summary();

-- 100 MB of files per workspace, like the original rooms.
create or replace function public.hub_enforce_storage_quota() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  used bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text, 0));
  select coalesce(sum(size), 0) into used from public.hub_files where workspace_id = new.workspace_id;
  if used + new.size > 104857600 then
    raise exception 'This workspace has reached its 100 MB storage limit. Ask an admin to delete old files.';
  end if;
  return new;
end;
$$;

create trigger hub_files_storage_quota
before insert on public.hub_files
for each row execute function public.hub_enforce_storage_quota();

-- ---------- Actions (called from the app with supabase.rpc) ----------

create or replace function public.hub_create_workspace(workspace_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  ws uuid;
  first_semester uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not exists (select 1 from public.hub_profiles where id = auth.uid()) then
    raise exception 'Set your display name first';
  end if;
  insert into public.hub_workspaces (name, created_by) values (btrim(workspace_name), auth.uid()) returning id into ws;
  insert into public.hub_members (workspace_id, user_id, role) values (ws, auth.uid(), 'admin');
  insert into public.hub_invites (workspace_id, code) values (ws, public.hub_new_code());
  insert into public.hub_channels (workspace_id, name, position) values (ws, 'general', 0);
  insert into public.hub_semesters (workspace_id, name, position) values (ws, 'Sem 1', 1) returning id into first_semester;
  insert into public.hub_channels (workspace_id, semester_id, name, position) values (ws, first_semester, 'notes', 1);
  return ws;
end;
$$;

create or replace function public.hub_join(invite_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  ws uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select workspace_id into ws from public.hub_invites where code = lower(btrim(invite_code));
  if ws is null then raise exception 'This invite link is invalid or has been reset'; end if;
  insert into public.hub_members (workspace_id, user_id) values (ws, auth.uid()) on conflict do nothing;
  return ws;
end;
$$;

-- Lets the sign-up screen say which workspace an invite is for. The code itself is the secret.
create or replace function public.hub_invite_preview(invite_code text)
returns table (workspace_name text, member_count bigint)
language sql stable security definer set search_path = public as $$
  select w.name, (select count(*) from public.hub_members m where m.workspace_id = w.id)
  from public.hub_invites i
  join public.hub_workspaces w on w.id = i.workspace_id
  where i.code = lower(btrim(invite_code));
$$;

create or replace function public.hub_set_invite(ws uuid, invite_code text) returns text
language plpgsql security definer set search_path = public as $$
declare
  normalized_code text := lower(btrim(invite_code));
begin
  if not public.hub_is_admin(ws) then
    raise exception 'Only room admins can change the invite code';
  end if;
  if normalized_code !~ '^[a-z0-9]{4,24}$' then
    raise exception 'Invite codes must be 4 to 24 letters or numbers';
  end if;

  update public.hub_invites as i
  set code = normalized_code, updated_at = now()
  where i.workspace_id = ws;
  if not found then
    raise exception 'This room does not have an invite code yet';
  end if;
  return normalized_code;
exception
  when unique_violation then
    raise exception 'That invite code is already in use';
end;
$$;

create or replace function public.hub_reset_invite(ws uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  new_code text := public.hub_new_code();
begin
  if not public.hub_is_admin(ws) then
    raise exception 'Only admins can reset the invite link';
  end if;
  update public.hub_invites set code = new_code, updated_at = now() where workspace_id = ws;
  if not found then
    raise exception 'This room does not have an invite code yet';
  end if;
  return new_code;
end;
$$;

revoke execute on function public.hub_new_code() from public, anon, authenticated;
revoke execute on function public.hub_handle_new_user() from public, anon, authenticated;
revoke execute on function public.hub_stamp_summary() from public, anon, authenticated;
revoke execute on function public.hub_enforce_storage_quota() from public, anon, authenticated;
revoke execute on function public.hub_create_workspace(text) from public, anon;
revoke execute on function public.hub_join(text) from public, anon;
revoke execute on function public.hub_reset_invite(uuid) from public, anon;
revoke execute on function public.hub_set_invite(uuid, text) from public, anon;
revoke execute on function public.hub_is_member(uuid) from public, anon;
revoke execute on function public.hub_is_admin(uuid) from public, anon;
revoke execute on function public.hub_shares_workspace(uuid) from public, anon;
grant execute on function public.hub_is_member(uuid), public.hub_is_admin(uuid), public.hub_shares_workspace(uuid) to authenticated;
grant execute on function public.hub_create_workspace(text) to authenticated;
grant execute on function public.hub_join(text) to authenticated;
grant execute on function public.hub_reset_invite(uuid) to authenticated;
grant execute on function public.hub_set_invite(uuid, text) to authenticated;
grant execute on function public.hub_invite_preview(text) to anon, authenticated;

-- ---------- Row-level security ----------

alter table public.hub_profiles enable row level security;
alter table public.hub_workspaces enable row level security;
alter table public.hub_members enable row level security;
alter table public.hub_invites enable row level security;
alter table public.hub_semesters enable row level security;
alter table public.hub_channels enable row level security;
alter table public.hub_files enable row level security;
alter table public.hub_messages enable row level security;

create policy "hub: see yourself and workspace mates" on public.hub_profiles for select to authenticated
  using (id = (select auth.uid()) or public.hub_shares_workspace(id));
create policy "hub: create your own profile" on public.hub_profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy "hub: edit your own profile" on public.hub_profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "hub: members see their workspaces" on public.hub_workspaces for select to authenticated
  using (public.hub_is_member(id));
create policy "hub: admins rename workspaces" on public.hub_workspaces for update to authenticated
  using (public.hub_is_admin(id)) with check (public.hub_is_admin(id));
create policy "hub: owners delete workspaces" on public.hub_workspaces for delete to authenticated
  using (created_by = (select auth.uid()));

create policy "hub: members see each other" on public.hub_members for select to authenticated
  using (public.hub_is_member(workspace_id));
create policy "hub: admins change roles, never the owner's" on public.hub_members for update to authenticated
  using (public.hub_is_admin(workspace_id)
    and user_id <> (select w.created_by from public.hub_workspaces w where w.id = hub_members.workspace_id))
  with check (public.hub_is_admin(workspace_id));
create policy "hub: leave, or admins remove members (not the owner)" on public.hub_members for delete to authenticated
  using ((user_id = (select auth.uid()) or public.hub_is_admin(workspace_id))
    and user_id <> (select w.created_by from public.hub_workspaces w where w.id = hub_members.workspace_id));

create policy "hub: members see the invite code" on public.hub_invites for select to authenticated
  using (public.hub_is_member(workspace_id));

create policy "hub: members see semesters" on public.hub_semesters for select to authenticated
  using (public.hub_is_member(workspace_id));
create policy "hub: admins add semesters" on public.hub_semesters for insert to authenticated
  with check (public.hub_is_admin(workspace_id));
create policy "hub: admins edit semesters" on public.hub_semesters for update to authenticated
  using (public.hub_is_admin(workspace_id)) with check (public.hub_is_admin(workspace_id));
create policy "hub: admins delete semesters" on public.hub_semesters for delete to authenticated
  using (public.hub_is_admin(workspace_id));

create policy "hub: members see channels" on public.hub_channels for select to authenticated
  using (public.hub_is_member(workspace_id));
create policy "hub: admins add channels" on public.hub_channels for insert to authenticated
  with check (public.hub_is_admin(workspace_id) and (semester_id is null or exists (
    select 1 from public.hub_semesters s where s.id = semester_id and s.workspace_id = hub_channels.workspace_id)));
create policy "hub: admins edit channels" on public.hub_channels for update to authenticated
  using (public.hub_is_admin(workspace_id)) with check (public.hub_is_admin(workspace_id));
create policy "hub: admins delete channels" on public.hub_channels for delete to authenticated
  using (public.hub_is_admin(workspace_id));

create policy "hub: members see files" on public.hub_files for select to authenticated
  using (public.hub_is_member(workspace_id));
create policy "hub: members upload files" on public.hub_files for insert to authenticated
  with check (user_id = (select auth.uid()) and public.hub_is_member(workspace_id)
    and exists (select 1 from public.hub_channels c where c.id = channel_id and c.workspace_id = hub_files.workspace_id)
    and split_part(path, '/', 1) = workspace_id::text and split_part(path, '/', 2) = channel_id::text);
create policy "hub: members save summaries" on public.hub_files for update to authenticated
  using (public.hub_is_member(workspace_id)) with check (public.hub_is_member(workspace_id));
create policy "hub: uploaders or admins delete files" on public.hub_files for delete to authenticated
  using (user_id = (select auth.uid()) or public.hub_is_admin(workspace_id));

create policy "hub: members read messages" on public.hub_messages for select to authenticated
  using (public.hub_is_member(workspace_id));
create policy "hub: members send messages" on public.hub_messages for insert to authenticated
  with check (user_id = (select auth.uid()) and public.hub_is_member(workspace_id)
    and exists (select 1 from public.hub_channels c where c.id = channel_id and c.workspace_id = hub_messages.workspace_id)
    and (file_id is null or exists (select 1 from public.hub_files f where f.id = file_id and f.channel_id = hub_messages.channel_id)));
create policy "hub: senders or admins delete messages" on public.hub_messages for delete to authenticated
  using (user_id = (select auth.uid()) or public.hub_is_admin(workspace_id));

-- Spell out what signed-in users may do; the policies above narrow it to their own workspaces.
-- Workspaces, memberships and invites are only created through the actions above.
revoke all on public.hub_profiles, public.hub_workspaces, public.hub_members, public.hub_invites,
  public.hub_semesters, public.hub_channels, public.hub_files, public.hub_messages from anon, authenticated;
grant select on public.hub_profiles, public.hub_workspaces, public.hub_members, public.hub_invites,
  public.hub_semesters, public.hub_channels, public.hub_files, public.hub_messages to authenticated;
grant insert on public.hub_profiles, public.hub_semesters, public.hub_channels, public.hub_files, public.hub_messages to authenticated;
grant delete on public.hub_workspaces, public.hub_members, public.hub_semesters, public.hub_channels,
  public.hub_files, public.hub_messages to authenticated;
grant update (display_name) on public.hub_profiles to authenticated;
grant update (name, academic_year) on public.hub_workspaces to authenticated;
grant update (course_code) on public.hub_channels to authenticated;
grant update (role) on public.hub_members to authenticated;
grant update (name, position) on public.hub_semesters, public.hub_channels to authenticated;
grant update (summary) on public.hub_files to authenticated;

-- ---------- Realtime: new messages, uploads and saved summaries appear live ----------

alter publication supabase_realtime add table public.hub_messages, public.hub_files;

-- ---------- Storage: private bucket, folders are <workspace id>/<channel id>/ ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hub-files', 'hub-files', false, 52428800,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy "hub: members read workspace files" on storage.objects for select to authenticated
  using (bucket_id = 'hub-files' and public.hub_is_member(((storage.foldername(name))[1])::uuid));
create policy "hub: members upload workspace files" on storage.objects for insert to authenticated
  with check (bucket_id = 'hub-files' and public.hub_is_member(((storage.foldername(name))[1])::uuid));
create policy "hub: uploaders or admins remove workspace files" on storage.objects for delete to authenticated
  using (bucket_id = 'hub-files' and (owner_id = (select auth.uid())::text
    or public.hub_is_admin(((storage.foldername(name))[1])::uuid)));

-- ---------- Member features: replies, reactions, stickers, memories, birthdays, notifications ----------
-- (Projects set up before this was added run supabase/updates/002-member-features.sql instead.)

-- ---------- Replies and stickers ----------

alter table public.hub_messages add column if not exists reply_to_id uuid references public.hub_messages(id) on delete set null;
alter table public.hub_messages add column if not exists kind text not null default 'text';
alter table public.hub_messages drop constraint if exists hub_messages_kind_check;
alter table public.hub_messages add constraint hub_messages_kind_check check (kind in ('text', 'sticker'));

drop policy if exists "hub: members send messages" on public.hub_messages;
create policy "hub: members send messages" on public.hub_messages for insert to authenticated
  with check (user_id = (select auth.uid()) and public.hub_is_member(workspace_id)
    and exists (select 1 from public.hub_channels c where c.id = channel_id and c.workspace_id = hub_messages.workspace_id)
    and (file_id is null or exists (select 1 from public.hub_files f where f.id = file_id and f.channel_id = hub_messages.channel_id))
    and (reply_to_id is null or exists (select 1 from public.hub_messages r where r.id = hub_messages.reply_to_id and r.channel_id = hub_messages.channel_id)));

-- ---------- Reactions ----------

create table if not exists public.hub_reactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.hub_workspaces(id) on delete cascade,
  channel_id uuid not null references public.hub_channels(id) on delete cascade,
  message_id uuid not null references public.hub_messages(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.hub_profiles(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);
create index if not exists hub_reactions_channel_idx on public.hub_reactions (channel_id);
alter table public.hub_reactions enable row level security;

drop policy if exists "hub: members see reactions" on public.hub_reactions;
create policy "hub: members see reactions" on public.hub_reactions for select to authenticated
  using (public.hub_is_member(workspace_id));
drop policy if exists "hub: members react" on public.hub_reactions;
create policy "hub: members react" on public.hub_reactions for insert to authenticated
  with check (user_id = (select auth.uid()) and public.hub_is_member(workspace_id)
    and exists (select 1 from public.hub_messages m where m.id = message_id
      and m.channel_id = hub_reactions.channel_id and m.workspace_id = hub_reactions.workspace_id));
drop policy if exists "hub: remove your own reactions" on public.hub_reactions;
create policy "hub: remove your own reactions" on public.hub_reactions for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.hub_reactions from anon, authenticated;
grant select, insert, delete on public.hub_reactions to authenticated;

-- ---------- Memories gallery (photos share the workspace's 100 MB) ----------

create table if not exists public.hub_memories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.hub_workspaces(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.hub_profiles(id) on delete cascade,
  path text not null unique,
  mime text not null check (mime in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
  caption text not null default '' check (char_length(caption) <= 160),
  size bigint not null check (size between 1 and 52428800),
  created_at timestamptz not null default now()
);
create index if not exists hub_memories_workspace_idx on public.hub_memories (workspace_id, created_at desc);
alter table public.hub_memories enable row level security;

drop policy if exists "hub: members see memories" on public.hub_memories;
create policy "hub: members see memories" on public.hub_memories for select to authenticated
  using (public.hub_is_member(workspace_id));
drop policy if exists "hub: members add memories" on public.hub_memories;
create policy "hub: members add memories" on public.hub_memories for insert to authenticated
  with check (user_id = (select auth.uid()) and public.hub_is_member(workspace_id)
    and split_part(path, '/', 1) = workspace_id::text and split_part(path, '/', 2) = 'memories');
drop policy if exists "hub: uploaders or admins delete memories" on public.hub_memories;
create policy "hub: uploaders or admins delete memories" on public.hub_memories for delete to authenticated
  using (user_id = (select auth.uid()) or public.hub_is_admin(workspace_id));

revoke all on public.hub_memories from anon, authenticated;
grant select, insert, delete on public.hub_memories to authenticated;

create or replace function public.hub_enforce_storage_quota() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  used bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text, 0));
  select coalesce((select sum(size) from public.hub_files where workspace_id = new.workspace_id), 0)
       + coalesce((select sum(size) from public.hub_memories where workspace_id = new.workspace_id), 0)
    into used;
  if used + new.size > 104857600 then
    raise exception 'This workspace has reached its 100 MB storage limit. Ask an admin to delete old files.';
  end if;
  return new;
end;
$$;

drop trigger if exists hub_memories_storage_quota on public.hub_memories;
create trigger hub_memories_storage_quota
before insert on public.hub_memories
for each row execute function public.hub_enforce_storage_quota();

-- ---------- Birthdays (month and day only, never the year) ----------

alter table public.hub_profiles add column if not exists birth_month int check (birth_month between 1 and 12);
alter table public.hub_profiles add column if not exists birth_day int check (birth_day between 1 and 31);
grant update (birth_month, birth_day) on public.hub_profiles to authenticated;

-- ---------- Notifications ----------

create table if not exists public.hub_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.hub_profiles(id) on delete cascade,
  workspace_id uuid not null references public.hub_workspaces(id) on delete cascade,
  channel_id uuid references public.hub_channels(id) on delete cascade,
  kind text not null check (kind in ('message', 'birthday')),
  event_key text not null unique,
  title text not null check (char_length(title) <= 200),
  body text not null default '' check (char_length(body) <= 300),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists hub_notifications_user_idx on public.hub_notifications (user_id, created_at desc);
alter table public.hub_notifications enable row level security;

drop policy if exists "hub: see your notifications" on public.hub_notifications;
create policy "hub: see your notifications" on public.hub_notifications for select to authenticated
  using (user_id = (select auth.uid()));
-- Message notifications come from the trigger below; the app only adds birthday reminders for you.
drop policy if exists "hub: add your birthday reminders" on public.hub_notifications;
create policy "hub: add your birthday reminders" on public.hub_notifications for insert to authenticated
  with check (user_id = (select auth.uid()) and kind = 'birthday' and public.hub_is_member(workspace_id));
drop policy if exists "hub: mark your notifications read" on public.hub_notifications;
create policy "hub: mark your notifications read" on public.hub_notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "hub: clear your notifications" on public.hub_notifications;
create policy "hub: clear your notifications" on public.hub_notifications for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.hub_notifications from anon, authenticated;
grant select, insert, delete on public.hub_notifications to authenticated;
grant update (read_at) on public.hub_notifications to authenticated;

create or replace function public.hub_notify_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  sender text;
  channel_name text;
  file_name text;
  preview text;
begin
  select display_name into sender from public.hub_profiles where id = new.user_id;
  select name into channel_name from public.hub_channels where id = new.channel_id;
  if new.file_id is not null then
    select name into file_name from public.hub_files where id = new.file_id;
  end if;
  preview := case
    when new.kind = 'sticker' then 'Sent a sticker'
    when btrim(new.body) = '' then 'Shared ' || coalesce(file_name, 'a file')
    else left(new.body, 120)
  end;
  insert into public.hub_notifications (user_id, workspace_id, channel_id, kind, event_key, title, body)
  select m.user_id, new.workspace_id, new.channel_id, 'message', 'message:' || new.id || ':' || m.user_id,
    '#' || coalesce(channel_name, 'channel') || ' · ' || coalesce(sender, 'A classmate'), preview
  from public.hub_members m
  where m.workspace_id = new.workspace_id and m.user_id <> new.user_id
  on conflict (event_key) do nothing;
  return new;
end;
$$;

drop trigger if exists hub_messages_notify on public.hub_messages;
create trigger hub_messages_notify
after insert on public.hub_messages
for each row execute function public.hub_notify_message();

revoke execute on function public.hub_notify_message() from public, anon, authenticated;

-- ---------- Realtime: reactions and notifications arrive live ----------

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'hub_reactions') then
    alter publication supabase_realtime add table public.hub_reactions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'hub_notifications') then
    alter publication supabase_realtime add table public.hub_notifications;
  end if;
end;
$$;

-- ---------- Update 004: freeing up space and @mentions ----------
-- (Projects set up before this was added run supabase/updates/004-free-up-space-and-mentions.sql instead.)

alter table public.hub_files add column if not exists archived_at timestamptz;

-- Everything in the project's file storage, including the main SpiritHUB app's files when it shares this project.
create or replace function public.hub_project_storage() returns bigint
language plpgsql stable security definer set search_path = public as $$
declare
  hub_used bigint;
  all_used bigint := 0;
begin
  select coalesce((select sum(size) from public.hub_files where archived_at is null), 0)
       + coalesce((select sum(size) from public.hub_memories), 0)
    into hub_used;
  begin
    select coalesce(sum((metadata->>'size')::bigint), 0) into all_used from storage.objects;
  exception when others then
    all_used := 0; -- without access to storage, SpiritHUB's own tables still give a lower bound
  end;
  return greatest(hub_used, all_used);
end;
$$;

create or replace function public.hub_enforce_storage_quota() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  used bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text, 0));
  select coalesce((select sum(size) from public.hub_files where workspace_id = new.workspace_id and archived_at is null), 0)
       + coalesce((select sum(size) from public.hub_memories where workspace_id = new.workspace_id), 0)
    into used;
  if used + new.size > 104857600 then
    raise exception 'This workspace has reached its 100 MB storage limit. An admin can free up space in the Admin panel.';
  end if;
  -- Supabase's free plan holds 1 GB of files for the whole project; stop at 950 MB so it never gets stuck.
  if public.hub_project_storage() + new.size > 996147200 then
    raise exception 'SpiritHUB''s shared storage is almost full. Workspace admins can free up space in the Admin panel.';
  end if;
  return new;
end;
$$;

-- Marks files archived once an admin's device has saved them and removed them from Storage.
create or replace function public.hub_archive_files(file_ids uuid[]) returns integer
language plpgsql security definer set search_path = public as $$
declare
  archived integer;
begin
  update public.hub_files set archived_at = now()
  where id = any(file_ids) and archived_at is null and public.hub_is_admin(workspace_id);
  get diagnostics archived = row_count;
  return archived;
end;
$$;

revoke execute on function public.hub_project_storage() from public, anon;
grant execute on function public.hub_project_storage() to authenticated;
revoke execute on function public.hub_archive_files(uuid[]) from public, anon;
grant execute on function public.hub_archive_files(uuid[]) to authenticated;

-- ---------- @mentions ----------

alter table public.hub_messages add column if not exists mentions uuid[] not null default '{}' check (cardinality(mentions) <= 50);
alter table public.hub_notifications drop constraint if exists hub_notifications_kind_check;
alter table public.hub_notifications add constraint hub_notifications_kind_check check (kind in ('message', 'birthday', 'mention'));

-- People mentioned with @ get a "mentioned you" notification instead of the usual one.
create or replace function public.hub_notify_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  sender text;
  channel_name text;
  file_name text;
  preview text;
begin
  select display_name into sender from public.hub_profiles where id = new.user_id;
  select name into channel_name from public.hub_channels where id = new.channel_id;
  if new.file_id is not null then
    select name into file_name from public.hub_files where id = new.file_id;
  end if;
  preview := case
    when new.kind = 'sticker' then 'Sent a sticker'
    when btrim(new.body) = '' then 'Shared ' || coalesce(file_name, 'a file')
    else left(new.body, 120)
  end;
  insert into public.hub_notifications (user_id, workspace_id, channel_id, kind, event_key, title, body)
  select m.user_id, new.workspace_id, new.channel_id,
    case when m.user_id = any(new.mentions) then 'mention' else 'message' end,
    'message:' || new.id || ':' || m.user_id,
    case when m.user_id = any(new.mentions)
      then coalesce(sender, 'A classmate') || ' mentioned you in ' || coalesce(channel_name, 'a channel')
      else coalesce(channel_name, 'A channel') || ' · ' || coalesce(sender, 'A classmate')
    end,
    preview
  from public.hub_members m
  where m.workspace_id = new.workspace_id and m.user_id <> new.user_id
  on conflict (event_key) do nothing;
  return new;
end;
$$;

-- ---------- Update 005: workspace photos, chat backgrounds and profile photos ----------
-- (Projects set up before this was added run supabase/updates/005-photos.sql instead.)

alter table public.hub_workspaces add column if not exists icon_path text;
alter table public.hub_workspaces add column if not exists background_path text;
alter table public.hub_workspaces drop constraint if exists hub_workspaces_photos_check;
alter table public.hub_workspaces add constraint hub_workspaces_photos_check check (
  (icon_path is null or split_part(icon_path, '/', 1) = id::text)
  and (background_path is null or split_part(background_path, '/', 1) = id::text));
grant update (icon_path, background_path) on public.hub_workspaces to authenticated;

alter table public.hub_profiles add column if not exists avatar_path text;
alter table public.hub_profiles drop constraint if exists hub_profiles_avatar_check;
alter table public.hub_profiles add constraint hub_profiles_avatar_check check (avatar_path is null or split_part(avatar_path, '/', 1) = id::text);
grant update (avatar_path) on public.hub_profiles to authenticated;

-- Workspace photos sit in the workspace's own folder, so the existing file rules cover them.
-- Profile photos sit in a folder named after their owner: you add your own, and anyone who shares
-- a workspace with you can see it. Removing your own is already allowed, since you uploaded it.
drop policy if exists "hub: see classmates' profile photos" on storage.objects;
create policy "hub: see classmates' profile photos" on storage.objects for select to authenticated
  using (bucket_id = 'hub-files' and ((storage.foldername(name))[1] = (select auth.uid())::text
    or public.hub_shares_workspace(((storage.foldername(name))[1])::uuid)));
drop policy if exists "hub: add your own profile photo" on storage.objects;
create policy "hub: add your own profile photo" on storage.objects for insert to authenticated
  with check (bucket_id = 'hub-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
 then
    raise exception 'Invite codes must be 4 to 24 letters or numbers';
  end if;

  update public.hub_invites as i
  set code = normalized_code, updated_at = now()
  where i.workspace_id = ws;
  if not found then
    raise exception 'This room does not have an invite code yet';
  end if;
  return normalized_code;
exception
  when unique_violation then
    raise exception 'That invite code is already in use';
end;
$;

create or replace function public.hub_reset_invite(ws uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  new_code text := public.hub_new_code();
begin
  if not public.hub_is_admin(ws) then raise exception 'Only admins can reset the invite link'; end if;
  update public.hub_invites set code = new_code, updated_at = now() where workspace_id = ws;
  return new_code;
end;
$$;

revoke execute on function public.hub_new_code() from public, anon, authenticated;
revoke execute on function public.hub_handle_new_user() from public, anon, authenticated;
revoke execute on function public.hub_stamp_summary() from public, anon, authenticated;
revoke execute on function public.hub_enforce_storage_quota() from public, anon, authenticated;
revoke execute on function public.hub_create_workspace(text) from public, anon;
revoke execute on function public.hub_join(text) from public, anon;
revoke execute on function public.hub_reset_invite(uuid) from public, anon;
grant execute on function public.hub_is_member(uuid), public.hub_is_admin(uuid), public.hub_shares_workspace(uuid) to authenticated;
grant execute on function public.hub_create_workspace(text) to authenticated;
grant execute on function public.hub_join(text) to authenticated;
grant execute on function public.hub_reset_invite(uuid) to authenticated;
grant execute on function public.hub_invite_preview(text) to anon, authenticated;

-- ---------- Row-level security ----------

alter table public.hub_profiles enable row level security;
alter table public.hub_workspaces enable row level security;
alter table public.hub_members enable row level security;
alter table public.hub_invites enable row level security;
alter table public.hub_semesters enable row level security;
alter table public.hub_channels enable row level security;
alter table public.hub_files enable row level security;
alter table public.hub_messages enable row level security;

create policy "hub: see yourself and workspace mates" on public.hub_profiles for select to authenticated
  using (id = (select auth.uid()) or public.hub_shares_workspace(id));
create policy "hub: create your own profile" on public.hub_profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy "hub: edit your own profile" on public.hub_profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "hub: members see their workspaces" on public.hub_workspaces for select to authenticated
  using (public.hub_is_member(id));
create policy "hub: admins rename workspaces" on public.hub_workspaces for update to authenticated
  using (public.hub_is_admin(id)) with check (public.hub_is_admin(id));
create policy "hub: owners delete workspaces" on public.hub_workspaces for delete to authenticated
  using (created_by = (select auth.uid()));

create policy "hub: members see each other" on public.hub_members for select to authenticated
  using (public.hub_is_member(workspace_id));
create policy "hub: admins change roles, never the owner's" on public.hub_members for update to authenticated
  using (public.hub_is_admin(workspace_id)
    and user_id <> (select w.created_by from public.hub_workspaces w where w.id = hub_members.workspace_id))
  with check (public.hub_is_admin(workspace_id));
create policy "hub: leave, or admins remove members (not the owner)" on public.hub_members for delete to authenticated
  using ((user_id = (select auth.uid()) or public.hub_is_admin(workspace_id))
    and user_id <> (select w.created_by from public.hub_workspaces w where w.id = hub_members.workspace_id));

create policy "hub: members see the invite code" on public.hub_invites for select to authenticated
  using (public.hub_is_member(workspace_id));

create policy "hub: members see semesters" on public.hub_semesters for select to authenticated
  using (public.hub_is_member(workspace_id));
create policy "hub: admins add semesters" on public.hub_semesters for insert to authenticated
  with check (public.hub_is_admin(workspace_id));
create policy "hub: admins edit semesters" on public.hub_semesters for update to authenticated
  using (public.hub_is_admin(workspace_id)) with check (public.hub_is_admin(workspace_id));
create policy "hub: admins delete semesters" on public.hub_semesters for delete to authenticated
  using (public.hub_is_admin(workspace_id));

create policy "hub: members see channels" on public.hub_channels for select to authenticated
  using (public.hub_is_member(workspace_id));
create policy "hub: admins add channels" on public.hub_channels for insert to authenticated
  with check (public.hub_is_admin(workspace_id) and (semester_id is null or exists (
    select 1 from public.hub_semesters s where s.id = semester_id and s.workspace_id = hub_channels.workspace_id)));
create policy "hub: admins edit channels" on public.hub_channels for update to authenticated
  using (public.hub_is_admin(workspace_id)) with check (public.hub_is_admin(workspace_id));
create policy "hub: admins delete channels" on public.hub_channels for delete to authenticated
  using (public.hub_is_admin(workspace_id));

create policy "hub: members see files" on public.hub_files for select to authenticated
  using (public.hub_is_member(workspace_id));
create policy "hub: members upload files" on public.hub_files for insert to authenticated
  with check (user_id = (select auth.uid()) and public.hub_is_member(workspace_id)
    and exists (select 1 from public.hub_channels c where c.id = channel_id and c.workspace_id = hub_files.workspace_id)
    and split_part(path, '/', 1) = workspace_id::text and split_part(path, '/', 2) = channel_id::text);
create policy "hub: members save summaries" on public.hub_files for update to authenticated
  using (public.hub_is_member(workspace_id)) with check (public.hub_is_member(workspace_id));
create policy "hub: uploaders or admins delete files" on public.hub_files for delete to authenticated
  using (user_id = (select auth.uid()) or public.hub_is_admin(workspace_id));

create policy "hub: members read messages" on public.hub_messages for select to authenticated
  using (public.hub_is_member(workspace_id));
create policy "hub: members send messages" on public.hub_messages for insert to authenticated
  with check (user_id = (select auth.uid()) and public.hub_is_member(workspace_id)
    and exists (select 1 from public.hub_channels c where c.id = channel_id and c.workspace_id = hub_messages.workspace_id)
    and (file_id is null or exists (select 1 from public.hub_files f where f.id = file_id and f.channel_id = hub_messages.channel_id)));
create policy "hub: senders or admins delete messages" on public.hub_messages for delete to authenticated
  using (user_id = (select auth.uid()) or public.hub_is_admin(workspace_id));

-- Spell out what signed-in users may do; the policies above narrow it to their own workspaces.
-- Workspaces, memberships and invites are only created through the actions above.
revoke all on public.hub_profiles, public.hub_workspaces, public.hub_members, public.hub_invites,
  public.hub_semesters, public.hub_channels, public.hub_files, public.hub_messages from anon, authenticated;
grant select on public.hub_profiles, public.hub_workspaces, public.hub_members, public.hub_invites,
  public.hub_semesters, public.hub_channels, public.hub_files, public.hub_messages to authenticated;
grant insert on public.hub_profiles, public.hub_semesters, public.hub_channels, public.hub_files, public.hub_messages to authenticated;
grant delete on public.hub_workspaces, public.hub_members, public.hub_semesters, public.hub_channels,
  public.hub_files, public.hub_messages to authenticated;
grant update (display_name) on public.hub_profiles to authenticated;
grant update (name, academic_year) on public.hub_workspaces to authenticated;
grant update (course_code) on public.hub_channels to authenticated;
grant update (role) on public.hub_members to authenticated;
grant update (name, position) on public.hub_semesters, public.hub_channels to authenticated;
grant update (summary) on public.hub_files to authenticated;

-- ---------- Realtime: new messages, uploads and saved summaries appear live ----------

alter publication supabase_realtime add table public.hub_messages, public.hub_files;

-- ---------- Storage: private bucket, folders are <workspace id>/<channel id>/ ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hub-files', 'hub-files', false, 52428800,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy "hub: members read workspace files" on storage.objects for select to authenticated
  using (bucket_id = 'hub-files' and public.hub_is_member(((storage.foldername(name))[1])::uuid));
create policy "hub: members upload workspace files" on storage.objects for insert to authenticated
  with check (bucket_id = 'hub-files' and public.hub_is_member(((storage.foldername(name))[1])::uuid));
create policy "hub: uploaders or admins remove workspace files" on storage.objects for delete to authenticated
  using (bucket_id = 'hub-files' and (owner_id = (select auth.uid())::text
    or public.hub_is_admin(((storage.foldername(name))[1])::uuid)));

-- ---------- Member features: replies, reactions, stickers, memories, birthdays, notifications ----------
-- (Projects set up before this was added run supabase/updates/002-member-features.sql instead.)

-- ---------- Replies and stickers ----------

alter table public.hub_messages add column if not exists reply_to_id uuid references public.hub_messages(id) on delete set null;
alter table public.hub_messages add column if not exists kind text not null default 'text';
alter table public.hub_messages drop constraint if exists hub_messages_kind_check;
alter table public.hub_messages add constraint hub_messages_kind_check check (kind in ('text', 'sticker'));

drop policy if exists "hub: members send messages" on public.hub_messages;
create policy "hub: members send messages" on public.hub_messages for insert to authenticated
  with check (user_id = (select auth.uid()) and public.hub_is_member(workspace_id)
    and exists (select 1 from public.hub_channels c where c.id = channel_id and c.workspace_id = hub_messages.workspace_id)
    and (file_id is null or exists (select 1 from public.hub_files f where f.id = file_id and f.channel_id = hub_messages.channel_id))
    and (reply_to_id is null or exists (select 1 from public.hub_messages r where r.id = hub_messages.reply_to_id and r.channel_id = hub_messages.channel_id)));

-- ---------- Reactions ----------

create table if not exists public.hub_reactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.hub_workspaces(id) on delete cascade,
  channel_id uuid not null references public.hub_channels(id) on delete cascade,
  message_id uuid not null references public.hub_messages(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.hub_profiles(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);
create index if not exists hub_reactions_channel_idx on public.hub_reactions (channel_id);
alter table public.hub_reactions enable row level security;

drop policy if exists "hub: members see reactions" on public.hub_reactions;
create policy "hub: members see reactions" on public.hub_reactions for select to authenticated
  using (public.hub_is_member(workspace_id));
drop policy if exists "hub: members react" on public.hub_reactions;
create policy "hub: members react" on public.hub_reactions for insert to authenticated
  with check (user_id = (select auth.uid()) and public.hub_is_member(workspace_id)
    and exists (select 1 from public.hub_messages m where m.id = message_id
      and m.channel_id = hub_reactions.channel_id and m.workspace_id = hub_reactions.workspace_id));
drop policy if exists "hub: remove your own reactions" on public.hub_reactions;
create policy "hub: remove your own reactions" on public.hub_reactions for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.hub_reactions from anon, authenticated;
grant select, insert, delete on public.hub_reactions to authenticated;

-- ---------- Memories gallery (photos share the workspace's 100 MB) ----------

create table if not exists public.hub_memories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.hub_workspaces(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.hub_profiles(id) on delete cascade,
  path text not null unique,
  mime text not null check (mime in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
  caption text not null default '' check (char_length(caption) <= 160),
  size bigint not null check (size between 1 and 52428800),
  created_at timestamptz not null default now()
);
create index if not exists hub_memories_workspace_idx on public.hub_memories (workspace_id, created_at desc);
alter table public.hub_memories enable row level security;

drop policy if exists "hub: members see memories" on public.hub_memories;
create policy "hub: members see memories" on public.hub_memories for select to authenticated
  using (public.hub_is_member(workspace_id));
drop policy if exists "hub: members add memories" on public.hub_memories;
create policy "hub: members add memories" on public.hub_memories for insert to authenticated
  with check (user_id = (select auth.uid()) and public.hub_is_member(workspace_id)
    and split_part(path, '/', 1) = workspace_id::text and split_part(path, '/', 2) = 'memories');
drop policy if exists "hub: uploaders or admins delete memories" on public.hub_memories;
create policy "hub: uploaders or admins delete memories" on public.hub_memories for delete to authenticated
  using (user_id = (select auth.uid()) or public.hub_is_admin(workspace_id));

revoke all on public.hub_memories from anon, authenticated;
grant select, insert, delete on public.hub_memories to authenticated;

create or replace function public.hub_enforce_storage_quota() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  used bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text, 0));
  select coalesce((select sum(size) from public.hub_files where workspace_id = new.workspace_id), 0)
       + coalesce((select sum(size) from public.hub_memories where workspace_id = new.workspace_id), 0)
    into used;
  if used + new.size > 104857600 then
    raise exception 'This workspace has reached its 100 MB storage limit. Ask an admin to delete old files.';
  end if;
  return new;
end;
$$;

drop trigger if exists hub_memories_storage_quota on public.hub_memories;
create trigger hub_memories_storage_quota
before insert on public.hub_memories
for each row execute function public.hub_enforce_storage_quota();

-- ---------- Birthdays (month and day only, never the year) ----------

alter table public.hub_profiles add column if not exists birth_month int check (birth_month between 1 and 12);
alter table public.hub_profiles add column if not exists birth_day int check (birth_day between 1 and 31);
grant update (birth_month, birth_day) on public.hub_profiles to authenticated;

-- ---------- Notifications ----------

create table if not exists public.hub_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.hub_profiles(id) on delete cascade,
  workspace_id uuid not null references public.hub_workspaces(id) on delete cascade,
  channel_id uuid references public.hub_channels(id) on delete cascade,
  kind text not null check (kind in ('message', 'birthday')),
  event_key text not null unique,
  title text not null check (char_length(title) <= 200),
  body text not null default '' check (char_length(body) <= 300),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists hub_notifications_user_idx on public.hub_notifications (user_id, created_at desc);
alter table public.hub_notifications enable row level security;

drop policy if exists "hub: see your notifications" on public.hub_notifications;
create policy "hub: see your notifications" on public.hub_notifications for select to authenticated
  using (user_id = (select auth.uid()));
-- Message notifications come from the trigger below; the app only adds birthday reminders for you.
drop policy if exists "hub: add your birthday reminders" on public.hub_notifications;
create policy "hub: add your birthday reminders" on public.hub_notifications for insert to authenticated
  with check (user_id = (select auth.uid()) and kind = 'birthday' and public.hub_is_member(workspace_id));
drop policy if exists "hub: mark your notifications read" on public.hub_notifications;
create policy "hub: mark your notifications read" on public.hub_notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "hub: clear your notifications" on public.hub_notifications;
create policy "hub: clear your notifications" on public.hub_notifications for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.hub_notifications from anon, authenticated;
grant select, insert, delete on public.hub_notifications to authenticated;
grant update (read_at) on public.hub_notifications to authenticated;

create or replace function public.hub_notify_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  sender text;
  channel_name text;
  file_name text;
  preview text;
begin
  select display_name into sender from public.hub_profiles where id = new.user_id;
  select name into channel_name from public.hub_channels where id = new.channel_id;
  if new.file_id is not null then
    select name into file_name from public.hub_files where id = new.file_id;
  end if;
  preview := case
    when new.kind = 'sticker' then 'Sent a sticker'
    when btrim(new.body) = '' then 'Shared ' || coalesce(file_name, 'a file')
    else left(new.body, 120)
  end;
  insert into public.hub_notifications (user_id, workspace_id, channel_id, kind, event_key, title, body)
  select m.user_id, new.workspace_id, new.channel_id, 'message', 'message:' || new.id || ':' || m.user_id,
    '#' || coalesce(channel_name, 'channel') || ' · ' || coalesce(sender, 'A classmate'), preview
  from public.hub_members m
  where m.workspace_id = new.workspace_id and m.user_id <> new.user_id
  on conflict (event_key) do nothing;
  return new;
end;
$$;

drop trigger if exists hub_messages_notify on public.hub_messages;
create trigger hub_messages_notify
after insert on public.hub_messages
for each row execute function public.hub_notify_message();

revoke execute on function public.hub_notify_message() from public, anon, authenticated;

-- ---------- Realtime: reactions and notifications arrive live ----------

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'hub_reactions') then
    alter publication supabase_realtime add table public.hub_reactions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'hub_notifications') then
    alter publication supabase_realtime add table public.hub_notifications;
  end if;
end;
$$;

-- ---------- Update 004: freeing up space and @mentions ----------
-- (Projects set up before this was added run supabase/updates/004-free-up-space-and-mentions.sql instead.)

alter table public.hub_files add column if not exists archived_at timestamptz;

-- Everything in the project's file storage, including the main SpiritHUB app's files when it shares this project.
create or replace function public.hub_project_storage() returns bigint
language plpgsql stable security definer set search_path = public as $$
declare
  hub_used bigint;
  all_used bigint := 0;
begin
  select coalesce((select sum(size) from public.hub_files where archived_at is null), 0)
       + coalesce((select sum(size) from public.hub_memories), 0)
    into hub_used;
  begin
    select coalesce(sum((metadata->>'size')::bigint), 0) into all_used from storage.objects;
  exception when others then
    all_used := 0; -- without access to storage, SpiritHUB's own tables still give a lower bound
  end;
  return greatest(hub_used, all_used);
end;
$$;

create or replace function public.hub_enforce_storage_quota() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  used bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text, 0));
  select coalesce((select sum(size) from public.hub_files where workspace_id = new.workspace_id and archived_at is null), 0)
       + coalesce((select sum(size) from public.hub_memories where workspace_id = new.workspace_id), 0)
    into used;
  if used + new.size > 104857600 then
    raise exception 'This workspace has reached its 100 MB storage limit. An admin can free up space in the Admin panel.';
  end if;
  -- Supabase's free plan holds 1 GB of files for the whole project; stop at 950 MB so it never gets stuck.
  if public.hub_project_storage() + new.size > 996147200 then
    raise exception 'SpiritHUB''s shared storage is almost full. Workspace admins can free up space in the Admin panel.';
  end if;
  return new;
end;
$$;

-- Marks files archived once an admin's device has saved them and removed them from Storage.
create or replace function public.hub_archive_files(file_ids uuid[]) returns integer
language plpgsql security definer set search_path = public as $$
declare
  archived integer;
begin
  update public.hub_files set archived_at = now()
  where id = any(file_ids) and archived_at is null and public.hub_is_admin(workspace_id);
  get diagnostics archived = row_count;
  return archived;
end;
$$;

revoke execute on function public.hub_project_storage() from public, anon;
grant execute on function public.hub_project_storage() to authenticated;
revoke execute on function public.hub_archive_files(uuid[]) from public, anon;
grant execute on function public.hub_archive_files(uuid[]) to authenticated;

-- ---------- @mentions ----------

alter table public.hub_messages add column if not exists mentions uuid[] not null default '{}' check (cardinality(mentions) <= 50);
alter table public.hub_notifications drop constraint if exists hub_notifications_kind_check;
alter table public.hub_notifications add constraint hub_notifications_kind_check check (kind in ('message', 'birthday', 'mention'));

-- People mentioned with @ get a "mentioned you" notification instead of the usual one.
create or replace function public.hub_notify_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  sender text;
  channel_name text;
  file_name text;
  preview text;
begin
  select display_name into sender from public.hub_profiles where id = new.user_id;
  select name into channel_name from public.hub_channels where id = new.channel_id;
  if new.file_id is not null then
    select name into file_name from public.hub_files where id = new.file_id;
  end if;
  preview := case
    when new.kind = 'sticker' then 'Sent a sticker'
    when btrim(new.body) = '' then 'Shared ' || coalesce(file_name, 'a file')
    else left(new.body, 120)
  end;
  insert into public.hub_notifications (user_id, workspace_id, channel_id, kind, event_key, title, body)
  select m.user_id, new.workspace_id, new.channel_id,
    case when m.user_id = any(new.mentions) then 'mention' else 'message' end,
    'message:' || new.id || ':' || m.user_id,
    case when m.user_id = any(new.mentions)
      then coalesce(sender, 'A classmate') || ' mentioned you in ' || coalesce(channel_name, 'a channel')
      else coalesce(channel_name, 'A channel') || ' · ' || coalesce(sender, 'A classmate')
    end,
    preview
  from public.hub_members m
  where m.workspace_id = new.workspace_id and m.user_id <> new.user_id
  on conflict (event_key) do nothing;
  return new;
end;
$$;

-- ---------- Update 005: workspace photos, chat backgrounds and profile photos ----------
-- (Projects set up before this was added run supabase/updates/005-photos.sql instead.)

alter table public.hub_workspaces add column if not exists icon_path text;
alter table public.hub_workspaces add column if not exists background_path text;
alter table public.hub_workspaces drop constraint if exists hub_workspaces_photos_check;
alter table public.hub_workspaces add constraint hub_workspaces_photos_check check (
  (icon_path is null or split_part(icon_path, '/', 1) = id::text)
  and (background_path is null or split_part(background_path, '/', 1) = id::text));
grant update (icon_path, background_path) on public.hub_workspaces to authenticated;

alter table public.hub_profiles add column if not exists avatar_path text;
alter table public.hub_profiles drop constraint if exists hub_profiles_avatar_check;
alter table public.hub_profiles add constraint hub_profiles_avatar_check check (avatar_path is null or split_part(avatar_path, '/', 1) = id::text);
grant update (avatar_path) on public.hub_profiles to authenticated;

-- Workspace photos sit in the workspace's own folder, so the existing file rules cover them.
-- Profile photos sit in a folder named after their owner: you add your own, and anyone who shares
-- a workspace with you can see it. Removing your own is already allowed, since you uploaded it.
drop policy if exists "hub: see classmates' profile photos" on storage.objects;
create policy "hub: see classmates' profile photos" on storage.objects for select to authenticated
  using (bucket_id = 'hub-files' and ((storage.foldername(name))[1] = (select auth.uid())::text
    or public.hub_shares_workspace(((storage.foldername(name))[1])::uuid)));
drop policy if exists "hub: add your own profile photo" on storage.objects;
create policy "hub: add your own profile photo" on storage.objects for insert to authenticated
  with check (bucket_id = 'hub-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Index foreign-key columns not already covered by a leading index column.
create index if not exists hub_channels_semester_id_fk_idx on public.hub_channels (semester_id);
create index if not exists hub_files_summarized_by_fk_idx on public.hub_files 