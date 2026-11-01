-- SpiritHUB Workspaces update 004: freeing up space, and @mentions.
-- Every device keeps its own backup of the workspaces it opens, so admins can move old files off Supabase:
-- the files stay on those devices, their names, sharers and AI summaries stay in the chat, and they stop
-- counting toward the 100 MB. Uploads also stop a little before Supabase's free 1 GB of file storage runs out.
-- @mentions notify the people you mention, and notifications show channel names without a # sign.
-- Run once in the Supabase SQL Editor after update 003. Safe to run twice.

-- ---------- Freeing up space ----------

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
  where m.workspace_id = new.