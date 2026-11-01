-- SpiritHUB Workspaces update 001: admin options from the original SpiritHUB app.
-- Run once in the Supabase SQL Editor of a project that already ran supabase/schema.sql.
-- Safe to run twice. New projects don't need it: supabase/schema.sql already includes it.

-- Academic year on workspaces, course code on channels.
alter table public.hub_workspaces add column if not exists academic_year text check (char_length(academic_year) <= 40);
alter table public.hub_channels add column if not exists course_code text check (char_length(course_code) <= 20);
grant update (academic_year) on public.hub_workspaces to authenticated;
grant update (course_code) on public.hub_channels to authenticated;

-- Every member can copy the invite link, like the original Room ID. Only admins can reset it.
drop policy if exists "hub: admins see the invite code" on public.hub_invites;
drop policy if exists "hub: members see the invite code" on public.hub_invites;
create policy "hub: members see the invite code" on public.hub_invites for select to authenticated
  using (public.hub_is_member(workspace_id));

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

drop trigger if exists hub_files_storage_quota on public.hub_files;
create trigger hub_files_storage_quota
before insert on public.hub_files
for each row execute function public.hub_enforce_storage_quota();

revoke execute on function public.hub_enforce_storage_quota(