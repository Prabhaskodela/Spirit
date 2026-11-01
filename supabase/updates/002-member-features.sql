-- SpiritHUB Workspaces update 002: member features from the original SpiritHUB app.
-- Replies, reactions and stickers in chat, the memories gallery, birthdays, and notifications.
-- Run once in the Supabase SQL Editor after update 001. Safe to run twice.

-- ---------- Replies and stickers ----------

alter table public.hub_messages add column if not exists reply_to_id uuid references public.hub_messages(id) on delete set null;
alter table public.hub_messages add column if not exists kind text not null default 'text';
alter table public.hub_messages drop constraint if exists hub_messages_kind_check;
alter table public.hub_messages add constraint hub_messages_kind_check check (kind in ('text', 'sticker'));

drop policy if exists "hub: members send messages" on public.hub_messages;
create policy "hub: members send messages" on public.hub_messages for insert to authenticated
  with check (user_id = auth.uid() and public.hub_is_member(workspace_id)
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
  with check (user_id = auth.uid() and public.hub_is_member(workspace_id)
    and exists (select 1 from public.hub_messages m where m.id = message_id
      and m.channel_id = hub_reactions.channel_id and m.workspace_id = hub_reactions.workspace_id));
drop policy if exists "hub: remove your own reactions" on public.hub_reactions;
create policy "hub: remove your own reactions" on public.hub_reactions for delete to authenticated
  using (user_id = auth.uid());

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
  with check (user_id = auth.uid() and public.hub_is_member(workspace_id)
    and split_part(path, '/', 1) = workspace_id::text and split_part(path, '/', 2) = 'memories');
drop policy if exists "hub: uploaders or admins delete memories" on public.hub_memories;
create policy "hub: uploaders or admins delete memories" on public.hub_memories for delete to authenticated
  using (user_id = auth.uid() or public.hub_is_admin(workspace_id));

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
  using (user_id = auth.uid());
-- Message notifications come from the trigger below; the app only adds birthday reminders for you.
drop policy if exists "hub: add your birthday reminders" on public.hub_notifications;
create policy "hub: add your birthday reminders" on public.hub_notifications for insert to authenticated
  with check (user_id = auth.uid() and kind = 'birthday' and public.hub_is_member(workspace_id));
drop policy if exists "hub: mark your notifications read" on public.hub_notifications;
create policy "hub: mark your notifications read" on public.hub_notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "hub: clear your notifications" on public.hub_notifications;
create policy "hub: clear your notifications" on public.hub_notifications for delete to authenticated
  using (user_id = auth.uid());

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
  if not exists (select 1 from pg_publication_tables where pubname = 's