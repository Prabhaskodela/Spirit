-- SpiritHUB Workspaces update 005: photos.
-- Admins can give each workspace a photo (shown instead of its initials) and a chat background,
-- and everyone can add a profile photo that classmates see next to their messages.
-- Run once in the Supabase SQL Editor after update 004. Safe to run twice.

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
  using (bucket_id = 'hub-files' and ((storage.foldername(name))[1] = auth.uid()::text
    or public.hub_shares_workspace(((storage.foldername(name))[1])::uuid)));
drop policy if exists "hub: add your own profile photo" on storage.objects;
create policy "hub: add your own profile photo" on storage.objects for insert to authenticated
  with check (bucket_id = 'hub-files' and (storage.foldername(name))[1] = auth.uid()::text);
