-- SpiritHUB update 007: restrict helper grants and index uncovered foreign keys.
-- Safe for existing data: this changes function privileges and adds indexes only.

revoke execute on function public.hub_is_member(uuid) from public, anon;
revoke execute on function public.hub_is_admin(uuid) from public, anon;
revoke execute on function public.hub_shares_workspace(uuid) from public, anon;
grant execute on function public.hub_is_member(uuid) to authenticated;
grant execute on function public.hub_is_admin(uuid) to authenticated;
grant execute on function public.hub_shares_workspace(uuid) to authenticated;

create index if not exists hub_channels_semester_id_fk_idx on public.hub_channels (semester_id);
create index if not exists hub_files_summarized_by_fk_idx on public.hub_files (summarized_by);
create index if not exists hub_files_user_id_fk_idx on public.hub_files (user_id);
create index if not exists hub_files_workspace_id_fk_idx on public.hub_files (workspace_id);
create index if not exists hub_memories_user_id_fk_idx on public.hub_memories (user_id);
create index if not exists hub_messages_file_id_fk_idx on public.hub_messages (file_id);
create index if not exists hub_messages_reply_to_id_fk_idx on public.hub_messages (reply_to_id);
create index if not exists hub_messages_user_id_fk_idx on public.hub_messages (user_id);
create index if not exists hub_messages_workspace_id_fk_idx on public.hub_messages (workspace_id);
create index if not exists hub_notifications_channel_id_fk_idx on public.hub_notifications (channel_id);
create index if not exists hub_notifications_workspace_id_fk_idx on public.hub_notifications (workspace_id);
create index if not exists hub_reactions_user_id_fk_idx on public.hub_reactions (user_id);
create index if not exists hub_reactions_workspace_id_fk_idx on public.hub_reactions (workspace_id);
create index if not exists hub_workspaces_created_by_fk_idx on public.hub_wo