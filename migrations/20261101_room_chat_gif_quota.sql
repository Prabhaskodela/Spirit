-- Apply once to existing SpiritHUB databases created before room-chat GIF quota tracking.
-- Run in Supabase SQL Editor after the original schema.sql.
alter table public.messages
  add column if not exists file_size bigint not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_file_size_check'
  ) then
    alter table public.messages
      add constraint messages_file_size_check
      check (file_size between 0 and 52428800);
  end if;
end;
$$;

-- Backfill sizes for GIFs that were already uploaded.
update public.messages m
set file_size = case
  when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::bigint
  else 0
end
from storage.objects o
where m.attachment_type = 'gif'
  and m.attachment_path = o.name
  and o.bucket_id = 'spirit-files';

create or replace function public.enforce_room_storage_quota()
returns trigger language plpgsql security definer set search_path = public as $$
declare current_bytes bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.room_id::text,0));

  -- Count the actual private Storage objects, including room-chat GIFs.
  select coalesce(sum(
    case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::bigint else 0 end
  ),0)
    into current_bytes
    from storage.objects
    where bucket_id in ('spirit-files','spirit-memories')
      and (storage.foldername(name))[1] = new.room_id::text
      and name <> coalesce(
        case when tg_table_name = 'messages'
          then to_jsonb(new)->>'attachment_path'
          else to_jsonb(new)->>'storage_path'
        end,
        ''
      );

  if current_bytes + coalesce((to_jsonb(new)->>'file_size')::bigint,0) > 104857600 then
    raise exception 'This room has reached its 100 MB storage limit';
  end if;
  return new;
end;
$$;

drop trigger if exists subject_files_room_quota on public.subject_files;
drop trigger if exists memories_room_quota on public.memories;
drop trigger if exists messages_room_quota on public.messages;

create trigger subject_files_room_quota before insert on public.subject_files
for each row execute function public.enforce_room_storage_quota();
create trigger memories_room_quota before insert on public.memories
for each row execute function public.enforce_room_storage_quota();
create trigger messages_room_quota before insert on public.messages
for each row execute function public.enforce_room_storage_quota();
