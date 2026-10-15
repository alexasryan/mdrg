-- ============================================================
-- Nexus Messenger — схема базы данных Supabase (миграция 001)
-- Запускать через `supabase db push` или SQL Editor.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- профили ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 60),
  username text not null unique check (username ~ '^[a-z0-9_]{3,30}$'),
  avatar_url text,
  status_text text not null default '' check (char_length(status_text) <= 120),
  is_online boolean not null default false,
  last_seen timestamptz default now(),
  created_at timestamptz not null default now()
);

-- создание профиля при регистрации (триггер на auth.users, выполняется service role)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)),
    coalesce(new.raw_user_meta_data->>'username', 'u' || substr(replace(new.id::text,'-',''),1,12))
  );
  return new;
end; $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------- чаты ----------
create table public.chats (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'direct' check (type in ('direct','room')),
  title text,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chat_participants (
  chat_id uuid references public.chats(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

-- ---------- сообщения ----------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  content text not null default '' check (char_length(content) <= 4000),
  reply_to uuid references public.messages(id) on delete set null,
  attachment jsonb,
  type text not null default 'text' check (type in ('text','system')),
  read_by uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index messages_chat_created_idx on public.messages (chat_id, created_at desc);

-- helper: является ли пользователь участником чата
create or replace function public.is_chat_member(p_chat uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from chat_participants where chat_id = p_chat and user_id = auth.uid());
$$;

-- пометка прочтения (защита от подмены p_user)
create or replace function public.mark_chat_read(p_chat uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user <> auth.uid() then
    raise exception 'forbidden'; -- нельзя отметить прочитанным чужой аккаунт
  end if;
  if not public.is_chat_member(p_chat) then
    raise exception 'not a member';
  end if;
  update messages set read_by = array_append(read_by, p_user)
   where chat_id = p_chat and sender_id <> p_user and not (p_user = any(read_by));
end; $$;

-- ---------- звонки 1:1 ----------
create table public.calls (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid references public.chats(id) on delete set null,
  room_id uuid,
  caller_id uuid not null references public.profiles(id) on delete cascade,
  callee_id uuid references public.profiles(id) on delete cascade,
  mode text not null check (mode in ('audio','video')),
  status text not null default 'ringing' check (status in ('ringing','accepted','declined','missed','ended','failed')),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create index calls_callee_status_idx on public.calls (callee_id, status);

-- события входящих звонков (для realtime-подписки получателя)
create table public.call_events (
  id bigint generated always as identity primary key,
  callee_id uuid not null,
  caller_user_id uuid not null,
  call_id uuid not null,
  mode text not null,
  created_at timestamptz not null default now()
);

-- ---------- комнаты (ссылки-приглашения) ----------
create table public.call_rooms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) <= 60),
  mode text not null default 'video' check (mode in ('audio','video')),
  status text not null default 'waiting' check (status in ('waiting','active','ended')),
  max_participants int not null default 4 check (max_participants between 2 and 8),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz
);

create table public.room_participants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.call_rooms(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  display_name text not null check (char_length(display_name) between 2 and 40),
  is_host boolean not null default false,
  joined_at timestamptz not null default now(),
  last_active timestamptz not null default now()
);
create index room_parts_room_idx on public.room_participants (room_id);

-- ограничение числа живых участников и закрытых комнат на уровне БД
create or replace function public.check_room_capacity() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int; m int; st text;
begin
  select status into st from call_rooms where id = new.room_id;
  if st is null then raise exception 'room not found'; end if;
  if st = 'ended' then raise exception 'call has ended'; end if;
  select count(*) into n from room_participants
   where room_id = new.room_id and last_active > now() - interval '90 seconds';
  select max_participants into m from call_rooms where id = new.room_id;
  if n >= m then raise exception 'room is full'; end if;
  return new;
end; $$;
create trigger room_capacity before insert on public.room_participants
for each row execute function public.check_room_capacity();

-- ---------- сигнализация WebRTC ----------
create table public.call_signals (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.call_rooms(id) on delete cascade,
  sender_peer uuid not null,
  target_peer uuid,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index signals_room_id_idx on public.call_signals (room_id, id);

-- Очистка устаревших данных (рекомендуется запускать по расписанию, pg_cron):
--   delete from call_signals where created_at < now() - interval '1 hour';
--   delete from room_participants where last_active < now() - interval '5 minutes';
--   update call_rooms set status='ended' where status <> 'ended' and updated_at < now() - interval '10 minutes';
