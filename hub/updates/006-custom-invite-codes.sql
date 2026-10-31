-- SpiritHUB Workspaces update 006: let admins choose a stable room invite code.
-- Run once in the Supabase SQL Editor. This adds no tables or columns.

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

revoke all on function public.hub_set_invite(uuid, text) from public, anon, authenticated;
grant execute on function public.hub_set_invite(uuid, text) to authenticated;

