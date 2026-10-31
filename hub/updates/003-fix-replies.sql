-- SpiritHUB Workspaces update 003: lets replies through.
-- Update 002's message rule compared a reply with itself instead of the message it answers,
-- so every reply was refused. Run once in the Supabase SQL Editor after update 002. Safe to run twice.

drop policy if exists "hub: members send messages" on public.hub_messages;
create policy "hub: members send messages" on public.hub_messages for insert to authenticated
  with check (user_id = auth.uid() and public.hub_is_member(workspace_id)
    and exists (select 1 from public.hub_channels c where c.id = channel_id and c.workspace_id = hub_messages.workspace_id)
    and (file_id is null or exists (select 1 from public.hub_files f where f.id = file_id and f.channel_id = hub_messages.channel_id))
    and (reply_to_id is null or exists (select 1 from public.hub_messages r where r.id = hub_messages.reply_to_id and r.channel_id = hub_messages.channel_id)));
