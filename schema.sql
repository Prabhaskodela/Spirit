-- Spirit database schema for Supabase. Run this in the project's SQL Editor.
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 32),
  birth_month integer check (birth_month between 1 and 12),
  birth_day integer check (birth_day between 1 and 31),
  created_at timestamptz not null default now()
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  academic_year text not null default '',
  room_code text not null unique check (room_code ~ '^[A-F0-9]{8}$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.room_members (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin','member')),
  joined_at timestamptz not null default now(),
  primary key (room_id,user_id)
);

create table public.semesters (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (room_id,name)
);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  semester_id uuid not null references public.semesters(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  course_code text not null default '',
  created_at timestamptz not null default now(),
  unique (semester_id,name)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 1200),
  message_kind text not null default 'text' check (message_kind in ('text','sticker')),
  attachment_path text,
  attachment_type text check (attachment_type in ('gif')),
  reply_to_id uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  check (char_length(body) > 0 or attachment_path is not null)
);

create table public.subject_files (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 180),
  storage_path text not null unique,
  mime_type text not null,
  file_size bigint not null check (file_size between 1 and 52428800),
  created_at timestamptz not null default now()
);

create table public.subject_messages (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 1200),
  attachment_path text,
  attachment_name text,
  attachment_type text,
  attachment_size bigint,
  reply_to_id uuid references public.subject_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  check (char_length(body) > 0 or attachment_path is not null)
);

create table public.memories (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  media_type text not null check (media_type = 'image'),
  caption text not null default '' check (char_length(caption) <= 160),
  file_size bigint not null check (file_size between 1 and 52428800),
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete cascade,
  notification_type text not null check (notification_type in ('message','birthday')),
  event_key text not null unique,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.chat_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references public.messages(id) on delete cascade,
  subject_message_id uuid references public.subject_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  check ((message_id is not null) <> (subject_message_id is not null))
);
create unique index chat_reactions_room_unique on public.chat_reactions(message_id,user_id,emoji) where message_id is not null;
create unique index chat_reactions_subject_unique on public.chat_reactions(subject_message_id,user_id,emoji) where subject_message_id is not null;
create index chat_reactions_room_idx on public.chat_reactions(message_id);
create index chat_reactions_subject_idx on public.chat_reactions(subject_message_id);

create index room_members_user_idx on public.room_members(user_id);
create index semesters_room_idx on public.semesters(room_id,position);
create index subjects_semester_idx on public.subjects(semester_id);
create index messages_room_time_idx on public.messages(room_id,created_at desc);
create index subject_files_subject_time_idx on public.subject_files(subject_id,created_at desc);
create index subject_messages_subject_time_idx on public.subject_messages(subject_id,created_at desc);
create index memories_room_time_idx on public.memories(room_id,created_at desc);
create index notifications_user_time_idx on public.notifications(user_id,created_at desc);

create or replace function public.enforce_room_storage_quota()
returns trigger language plpgsql security definer set search_path = public as $$
declare current_bytes bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.room_id::text,0));
  select coalesce((select sum(file_size) from public.subject_files where room_id=new.room_id),0)
       + coalesce((select sum(file_size) from public.memories where room_id=new.room_id),0)
    into current_bytes;
  if current_bytes + new.file_size > 104857600 then
    raise exception 'This room has reached its 100 MB storage limit';
  end if;
  return new;
end;
$$;

create trigger subject_files_room_quota before insert on public.subject_files
for each row execute function public.enforce_room_storage_quota();
create trigger memories_room_quota before insert on public.memories
for each row execute function public.enforce_room_storage_quota();

create or replace function public.is_room_member(target_room uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.room_members where room_id=target_room and user_id=auth.uid())
$$;

create or replace function public.is_room_admin(target_room uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.room_members where room_id=target_room and user_id=auth.uid() and role='admin')
$$;

create or replace function public.is_room_creator(target_room uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.rooms where id=target_room and created_by=auth.uid())
$$;

create or replace function public.can_see_profile(target_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select target_user=auth.uid() or exists(
    select 1 from public.room_members mine join public.room_members theirs on mine.room_id=theirs.room_id
    where mine.user_id=auth.uid() and theirs.user_id=target_user
  )
$$;

revoke all on function public.is_room_member(uuid) from public;
revoke all on function public.is_room_admin(uuid) from public;
revoke all on function public.is_room_creator(uuid) from public;
revoke all on function public.can_see_profile(uuid) from public;
grant execute on function public.is_room_member(uuid) to authenticated;
grant execute on function public.is_room_admin(uuid) to authenticated;
grant execute on function public.is_room_creator(uuid) to authenticated;
grant execute on function public.can_see_profile(uuid) to authenticated;

create or replace function public.join_room_by_code(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare target_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in is required'; end if;
  select id into target_id from public.rooms where room_code=upper(trim(p_code));
  if target_id is null then raise exception 'Room ID not found'; end if;
  insert into public.room_members(room_id,user_id,role) values(target_id,auth.uid(),'member') on conflict do nothing;
  return target_id;
end;
$$;

create or replace function public.create_room(p_name text,p_academic_year text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare new_room uuid; new_code text;
begin
  if auth.uid() is null then raise exception 'Sign in is required'; end if;
  if char_length(trim(p_name)) not between 1 and 60 then raise exception 'Room name must be 1 to 60 characters'; end if;
  loop
    new_code := upper(substr(encode(gen_random_bytes(5),'hex'),1,8));
    exit when not exists(select 1 from public.rooms where room_code=new_code);
  end loop;
  insert into public.rooms(name,academic_year,room_code,created_by)
  values(trim(p_name),coalesce(trim(p_academic_year),''),new_code,auth.uid()) returning id into new_room;
  insert into public.room_members(room_id,user_id,role) values(new_room,auth.uid(),'admin');
  insert into public.semesters(room_id,name,position) values(new_room,'Semester 1',0);
  return new_room;
end;
$$;

create or replace function public.rotate_room_code(p_room uuid)
returns text language plpgsql security definer set search_path = public as $$
declare new_code text;
begin
  if not public.is_room_admin(p_room) then raise exception 'Only a room admin can rotate the room ID'; end if;
  loop
    new_code := upper(substr(encode(gen_random_bytes(5),'hex'),1,8));
    exit when not exists(select 1 from public.rooms where room_code=new_code);
  end loop;
  update public.rooms set room_code=new_code where id=p_room;
  return new_code;
end;
$$;

revoke all on function public.create_room(text,text) from public;
grant execute on function public.create_room(text,text) to authenticated;
revoke all on function public.join_room_by_code(text) from public;
grant execute on function public.join_room_by_code(text) to authenticated;
revoke all on function public.rotate_room_code(uuid) from public;
grant execute on function public.rotate_room_code(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.semesters enable row level security;
alter table public.subjects enable row level security;
alter table public.messages enable row level security;
alter table public.subject_files enable row level security;
alter table public.subject_messages enable row level security;
alter table public.memories enable row level security;
alter table public.notifications enable row level security;
alter table public.chat_reactions enable row level security;

create policy "roommates can view display names" on public.profiles for select to authenticated using (public.can_see_profile(id));
create policy "users create their own profile" on public.profiles for insert to authenticated with check (id=auth.uid());
create policy "users update their own profile" on public.profiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid());

create policy "members view rooms" on public.rooms for select to authenticated using (public.is_room_member(id));
create policy "signed-in users create rooms" on public.rooms for insert to authenticated with check (created_by=auth.uid());
create policy "admins update rooms" on public.rooms for update to authenticated using (public.is_room_admin(id)) with check (public.is_room_admin(id));
create policy "admins delete rooms" on public.rooms for delete to authenticated using (public.is_room_admin(id));

create policy "members view room roster" on public.room_members for select to authenticated using (public.is_room_member(room_id));
create policy "creator adds first admin" on public.room_members for insert to authenticated with check (
  (user_id=auth.uid() and role='admin' and public.is_room_creator(room_id))
  or public.is_room_admin(room_id)
);
create policy "admins remove members" on public.room_members for delete to authenticated using (public.is_room_admin(room_id) or user_id=auth.uid());

create policy "members view semesters" on public.semesters for select to authenticated using (public.is_room_member(room_id));
create policy "admins add semesters" on public.semesters for insert to authenticated with check (public.is_room_admin(room_id));
create policy "admins update semesters" on public.semesters for update to authenticated using (public.is_room_admin(room_id)) with check (public.is_room_admin(room_id));
create policy "admins remove semesters" on public.semesters for delete to authenticated using (public.is_room_admin(room_id));

create policy "members view subjects" on public.subjects for select to authenticated using (
  exists(select 1 from public.semesters s where s.id=semester_id and public.is_room_member(s.room_id))
);
create policy "admins add subjects" on public.subjects for insert to authenticated with check (
  exists(select 1 from public.semesters s where s.id=semester_id and public.is_room_admin(s.room_id))
);
create policy "admins update subjects" on public.subjects for update to authenticated using (
  exists(select 1 from public.semesters s where s.id=semester_id and public.is_room_admin(s.room_id))
) with check (exists(select 1 from public.semesters s where s.id=semester_id and public.is_room_admin(s.room_id)));
create policy "admins remove subjects" on public.subjects for delete to authenticated using (
  exists(select 1 from public.semesters s where s.id=semester_id and public.is_room_admin(s.room_id))
);

create policy "members read chat" on public.messages for select to authenticated using (public.is_room_member(room_id));
create policy "members send chat" on public.messages for insert to authenticated with check (
  public.is_room_member(room_id) and user_id=auth.uid() and
  (attachment_path is null or attachment_path like room_id::text || '/%') and
  (messages.reply_to_id is null or exists(select 1 from public.messages parent where parent.id=messages.reply_to_id and parent.room_id=messages.room_id))
);
create policy "authors edit chat" on public.messages for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid() and public.is_room_member(room_id));
create policy "authors or admins delete chat" on public.messages for delete to authenticated using (user_id=auth.uid() or public.is_room_admin(room_id));

create policy "members read subject files" on public.subject_files for select to authenticated using (public.is_room_member(room_id));
create policy "members upload subject files" on public.subject_files for insert to authenticated with check (
  public.is_room_member(room_id) and user_id=auth.uid() and storage_path like room_id::text || '/%' and exists(
    select 1 from public.subjects s join public.semesters t on t.id=s.semester_id
    where s.id=subject_id and t.room_id=subject_files.room_id
  )
);
create policy "authors or admins delete subject files" on public.subject_files for delete to authenticated using (user_id=auth.uid() or public.is_room_admin(room_id));

create policy "members read subject chat" on public.subject_messages for select to authenticated using (
  public.is_room_member(room_id) and exists(select 1 from public.subjects s join public.semesters t on t.id=s.semester_id where s.id=subject_messages.subject_id and t.room_id=subject_messages.room_id)
);
create policy "members send subject chat" on public.subject_messages for insert to authenticated with check (
  public.is_room_member(room_id) and user_id=auth.uid() and (attachment_path is null or attachment_path like room_id::text || '/%')
  and exists(select 1 from public.subjects s join public.semesters t on t.id=s.semester_id where s.id=subject_messages.subject_id and t.room_id=subject_messages.room_id)
  and (subject_messages.reply_to_id is null or exists(select 1 from public.subject_messages parent where parent.id=subject_messages.reply_to_id and parent.subject_id=subject_messages.subject_id))
);
create policy "authors edit subject chat" on public.subject_messages for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid() and public.is_room_member(room_id));
create policy "authors or admins delete subject chat" on public.subject_messages for delete to authenticated using (user_id=auth.uid() or public.is_room_admin(room_id));

create policy "members view memories" on public.memories for select to authenticated using (public.is_room_member(room_id));
create policy "members add memories" on public.memories for insert to authenticated with check (
  public.is_room_member(room_id) and user_id=auth.uid() and storage_path like room_id::text || '/%'
);
create policy "authors or admins delete memories" on public.memories for delete to authenticated using (user_id=auth.uid() or public.is_room_admin(room_id));

create policy "users view own notifications" on public.notifications for select to authenticated using (user_id=auth.uid() and public.is_room_member(room_id));
create policy "users create own notifications" on public.notifications for insert to authenticated with check (user_id=auth.uid() and public.is_room_member(room_id));
create policy "users update own notifications" on public.notifications for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

create policy "room members see chat reactions" on public.chat_reactions for select to authenticated using (
  (message_id is not null and exists(select 1 from public.messages m where m.id=message_id and public.is_room_member(m.room_id)))
  or (subject_message_id is not null and exists(select 1 from public.subject_messages m where m.id=subject_message_id and public.is_room_member(m.room_id)))
);
create policy "members add own chat reactions" on public.chat_reactions for insert to authenticated with check (
  user_id=auth.uid() and (
    (message_id is not null and exists(select 1 from public.messages m where m.id=message_id and public.is_room_member(m.room_id)))
    or (subject_message_id is not null and exists(select 1 from public.subject_messages m where m.id=subject_message_id and public.is_room_member(m.room_id)))
  )
);
create policy "users remove own reactions" on public.chat_reactions for delete to authenticated using (user_id=auth.uid());

create or replace function public.notify_room_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare sender_name text; preview text;
begin
  select display_name into sender_name from public.profiles where id=new.user_id;
  preview := case when new.attachment_type='gif' then 'Shared a GIF' else left(new.body,120) end;
  insert into public.notifications(user_id,room_id,notification_type,event_key,title,body)
  select rm.user_id,new.room_id,'message','message:'||new.id::text||':'||rm.user_id::text,
    coalesce(sender_name,'A classmate')||' sent a message',preview
  from public.room_members rm where rm.room_id=new.room_id and rm.user_id<>new.user_id
  on conflict (event_key) do nothing;
  return new;
end;
$$;

create trigger messages_create_notifications after insert on public.messages
for each row execute function public.notify_room_message();

create or replace function public.notify_subject_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare sender_name text; subject_name text; preview text;
begin
  select display_name into sender_name from public.profiles where id=new.user_id;
  select name into subject_name from public.subjects where id=new.subject_id;
  preview := coalesce(nullif(left(new.body,120),''),'Shared '||coalesce(new.attachment_name,'a file'));
  insert into public.notifications(user_id,room_id,subject_id,notification_type,event_key,title,body)
  select rm.user_id,new.room_id,new.subject_id,'message','subject-message:'||new.id::text||':'||rm.user_id::text,
    coalesce(subject_name,'Subject')||' · '||coalesce(sender_name,'A classmate'),preview
  from public.room_members rm where rm.room_id=new.room_id and rm.user_id<>new.user_id
  on conflict (event_key) do nothing;
  return new;
end;
$$;

create trigger subject_messages_create_notifications after insert on public.subject_messages
for each row execute function public.notify_subject_message();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('spirit-files','spirit-files',false,52428800,array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain','image/png','image/jpeg','image/webp','image/gif']),
 ('spirit-memories','spirit-memories',false,52428800,array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy "room members can read files" on storage.objects for select to authenticated using (
  bucket_id in ('spirit-files','spirit-memories') and public.is_room_member((storage.foldername(name))[1]::uuid)
);
create policy "room members can upload files" on storage.objects for insert to authenticated with check (
  bucket_id in ('spirit-files','spirit-memories') and public.is_room_member((storage.foldername(name))[1]::uuid)
);
create policy "owners or room admins can remove files" on storage.objects for delete to authenticated using (
  bucket_id in ('spirit-files','spirit-memories') and (owner_id=auth.uid()::text or public.is_room_admin((storage.foldername(name))[1]::uuid))
);

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.subject_messages;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.chat_reactions;

