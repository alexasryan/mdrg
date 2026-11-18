create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null check(length(display_name) between 2 and 60),
 username text not null unique check(username ~ '^[a-z0-9_]{3,30}$'),
 avatar_url text, status_text text not null default '' check(length(status_text)<=120),
 is_online boolean not null default false, last_seen timestamptz, created_at timestamptz not null default now()
);
create function private.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,display_name,username) values(new.id,
 coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'),''),'Пользователь'),
 coalesce(nullif(lower(trim(new.raw_user_meta_data->>'username')),''),'u'||substr(replace(new.id::text,'-',''),1,16)));
 return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

create table public.chats (
 id uuid primary key default gen_random_uuid(), type text not null default 'direct' check(type='direct'),
 title text, created_by uuid not null references public.profiles(id), direct_key text not null unique,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.chat_participants (
 chat_id uuid not null references public.chats(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,
 joined_at timestamptz not null default now(), primary key(chat_id,user_id)
);
create index participants_user_idx on public.chat_participants(user_id,chat_id);
create function private.is_chat_member(p_chat uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.chat_participants where chat_id=p_chat and user_id=auth.uid())
$$;
create table public.messages (
 id uuid primary key default gen_random_uuid(), chat_id uuid not null references public.chats(id) on delete cascade,
 sender_id uuid not null references public.profiles(id), content text not null default '' check(length(content)<=4000),
 reply_to uuid references public.messages(id) on delete set null, attachment jsonb,
 type text not null default 'text' check(type='text'), read_by uuid[] not null default '{}',
 created_at timestamptz not null default now(), deleted_at timestamptz,
 check(length(trim(content))>0 or attachment is not null or deleted_at is not null)
);
create index messages_chat_created_idx on public.messages(chat_id,created_at desc,id desc);
create index messages_sender_idx on public.messages(sender_id);
create index messages_reply_idx on public.messages(reply_to) where reply_to is not null;
create function private.touch_chat() returns trigger language plpgsql security definer set search_path='' as $$
begin update public.chats set updated_at=now() where id=new.chat_id; return new; end $$;
create trigger message_touches_chat after insert or update on public.messages for each row execute function private.touch_chat();

create table public.call_rooms (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id),
 title text not null check(length(title) between 1 and 60), mode text not null check(mode in('audio','video')),
 status text not null default 'waiting' check(status in('waiting','active','ended')),
 max_participants int not null default 4 check(max_participants between 2 and 8), is_private boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), ended_at timestamptz
);
create index rooms_owner_idx on public.call_rooms(owner_id);
create table public.calls (
 id uuid primary key default gen_random_uuid(),chat_id uuid not null references public.chats(id),
 room_id uuid not null references public.call_rooms(id),caller_id uuid not null references public.profiles(id),
 callee_id uuid not null references public.profiles(id),mode text not null check(mode in('audio','video')),
 status text not null default 'ringing' check(status in('ringing','accepted','declined','missed','ended','failed')),
 created_at timestamptz not null default now(),ended_at timestamptz, check(caller_id<>callee_id)
);
create index calls_caller_idx on public.calls(caller_id,created_at desc);
create index calls_callee_idx on public.calls(callee_id,created_at desc);
create index calls_room_idx on public.calls(room_id);
create index calls_chat_idx on public.calls(chat_id);
create table public.call_events (
 id bigint generated always as identity primary key, callee_id uuid not null references public.profiles(id),
 caller_user_id uuid not null references public.profiles(id),call_id uuid not null references public.calls(id) on delete cascade,
 mode text not null check(mode in('audio','video')),created_at timestamptz not null default now()
);
create index events_callee_idx on public.call_events(callee_id,created_at desc);
create index events_call_idx on public.call_events(call_id);
create index events_caller_idx on public.call_events(caller_user_id);
create table public.room_participants (
 id uuid primary key default gen_random_uuid(),room_id uuid not null references public.call_rooms(id) on delete cascade,
 user_id uuid not null references public.profiles(id) on delete cascade,display_name text not null check(length(display_name) between 2 and 40),
 is_host boolean not null default false,joined_at timestamptz not null default now(),last_active timestamptz not null default now(),
 unique(room_id,user_id)
);
create index room_parts_user_idx on public.room_participants(user_id,room_id);
create function private.is_room_member(p_room uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.room_participants where room_id=p_room and user_id=auth.uid() and last_active>now()-interval '90 seconds')
$$;
create function private.can_read_room(p_room uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (exists(select 1 from public.call_rooms where id=p_room and owner_id=auth.uid())
 or private.is_room_member(p_room) or exists(select 1 from public.calls where room_id=p_room and auth.uid() in(caller_id,callee_id)))
$$;
create table public.call_signals (
 id bigint generated always as identity primary key,room_id uuid not null references public.call_rooms(id) on delete cascade,
 sender_peer uuid not null references public.room_participants(id) on delete cascade,
 target_peer uuid references public.room_participants(id) on delete cascade,payload jsonb not null,
 created_at timestamptz not null default now(),
 check(payload->>'type' in('offer','answer','ice','leave','ready','ping')),check(octet_length(payload::text)<=100000)
);
create index signals_room_id_idx on public.call_signals(room_id,id);
create index signals_sender_idx on public.call_signals(sender_peer);
create index signals_target_idx on public.call_signals(target_peer) where target_peer is not null;

-- Public tables are read-only except a narrow set of profile columns. Mutations
-- use invoker wrappers around private, authorized, transactional operations.
alter table public.profiles enable row level security;
alter table public.chats enable row level security;
alter table public.chat_participants enable row level security;
alter table public.messages enable row level security;
alter table public.calls enable row level security;
alter table public.call_events enable row level security;
alter table public.call_rooms enable row level security;
alter table public.room_participants enable row level security;
alter table public.call_signals enable row level security;
revoke all on all tables in schema public from anon,authenticated;
grant select on public.profiles,public.chats,public.chat_participants,public.messages,public.calls,public.call_events,public.call_rooms,public.room_participants,public.call_signals to authenticated;
grant update(display_name,status_text,avatar_url,is_online,last_seen) on public.profiles to authenticated;
grant insert on public.call_signals to authenticated;
grant usage on sequence public.call_signals_id_seq to authenticated;
create policy profiles_read on public.profiles for select to authenticated using(true);
create policy profiles_own_update on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
create policy chats_read on public.chats for select to authenticated using(private.is_chat_member(id));
create policy participants_read on public.chat_participants for select to authenticated using(private.is_chat_member(chat_id));
create policy messages_read on public.messages for select to authenticated using(private.is_chat_member(chat_id));
create policy calls_read on public.calls for select to authenticated using((select auth.uid()) in(caller_id,callee_id));
create policy events_read on public.call_events for select to authenticated using(callee_id=(select auth.uid()));
create policy rooms_read on public.call_rooms for select to authenticated using(private.can_read_room(id));
create policy room_parts_read on public.room_participants for select to authenticated using(private.can_read_room(room_id));
create policy signals_read on public.call_signals for select to authenticated using(private.is_room_member(room_id) and
 (target_peer is null or exists(select 1 from public.room_participants p where p.id=target_peer and p.user_id=(select auth.uid()))));
create policy signals_insert on public.call_signals for insert to authenticated with check(
 exists(select 1 from public.room_participants p join public.call_rooms r on r.id=p.room_id where p.id=sender_peer and p.room_id=call_signals.room_id
 and p.user_id=(select auth.uid()) and p.last_active>now()-interval '90 seconds' and r.status='active')
 and(target_peer is null or exists(select 1 from public.room_participants p where p.id=target_peer and p.room_id=call_signals.room_id and p.last_active>now()-interval '90 seconds')));

create function private.create_direct_chat(p_peer uuid) returns public.chats language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); result public.chats; pair text;
begin
 if me is null or me=p_peer then raise exception 'Недопустимый собеседник'; end if;
 if not exists(select 1 from public.profiles where id=p_peer) then raise exception 'Пользователь не найден'; end if;
 pair:=least(me,p_peer)::text||':'||greatest(me,p_peer)::text;
 perform pg_advisory_xact_lock(hashtextextended(pair,0));
 select * into result from public.chats where direct_key=pair;
 if not found then
 insert into public.chats(created_by,direct_key) values(me,pair) returning * into result;
 insert into public.chat_participants(chat_id,user_id) values(result.id,me),(result.id,p_peer);
 end if;
 return result;
end $$;
create function public.create_direct_chat(p_peer uuid) returns public.chats language sql security invoker set search_path='' as $$ select private.create_direct_chat(p_peer) $$;

create function private.send_message(p_id uuid,p_chat uuid,p_content text,p_reply uuid,p_attachment jsonb) returns public.messages language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); result public.messages; path text;
begin
 if not private.is_chat_member(p_chat) then raise exception 'Нет доступа к чату'; end if;
 select * into result from public.messages where id=p_id and sender_id=me and chat_id=p_chat;
 if found then return result; end if;
 if p_reply is not null and not exists(select 1 from public.messages where id=p_reply and chat_id=p_chat and deleted_at is null) then raise exception 'Сообщение для ответа недоступно'; end if;
 if p_attachment is not null then
 path:=p_attachment->>'storage_path';
 if path is null or split_part(path,'/',1)<>p_chat::text or split_part(path,'/',2)<>me::text
 or not exists(select 1 from storage.objects where bucket_id='chat-files' and name=path) then raise exception 'Файл недоступен'; end if;
 p_attachment:=p_attachment-'url';
 end if;
 if(select count(*) from public.messages where sender_id=me and created_at>now()-interval '1 minute')>=120 then raise exception 'Слишком много сообщений. Подождите минуту'; end if;
 insert into public.messages(id,chat_id,sender_id,content,reply_to,attachment,read_by) values(p_id,p_chat,me,trim(coalesce(p_content,'')),p_reply,p_attachment,array[me]) returning * into result;
 return result;
end $$;
create function public.send_message(p_id uuid,p_chat uuid,p_content text,p_reply uuid default null,p_attachment jsonb default null) returns public.messages language sql security invoker set search_path='' as $$ select private.send_message(p_id,p_chat,p_content,p_reply,p_attachment) $$;
create function private.delete_message(p_message uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Войдите в аккаунт'; end if;
 update public.messages set content='',attachment=null,deleted_at=now() where id=p_message and sender_id=auth.uid() and private.is_chat_member(chat_id);
 if not found then raise exception 'Сообщение недоступно'; end if;
end $$;
create function public.delete_message(p_message uuid) returns void language sql security invoker set search_path='' as $$ select private.delete_message(p_message) $$;
create function private.mark_chat_read(p_chat uuid,p_user uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or p_user is distinct from auth.uid() or not private.is_chat_member(p_chat) then raise exception 'Нет доступа к чату'; end if;
 update public.messages set read_by=array_append(read_by,p_user) where chat_id=p_chat and sender_id<>p_user and deleted_at is null and not(p_user=any(read_by));
end $$;
create function public.mark_chat_read(p_chat uuid,p_user uuid) returns void language sql security invoker set search_path='' as $$ select private.mark_chat_read(p_chat,p_user) $$;
create function public.list_my_chats() returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(x.data order by x.updated_at desc),'[]'::jsonb) from(
 select c.updated_at,to_jsonb(c)-'direct_key'||jsonb_build_object(
 'participants',(select jsonb_agg(jsonb_build_object('user_id',cp.user_id,'profile',to_jsonb(p))) from public.chat_participants cp join public.profiles p on p.id=cp.user_id where cp.chat_id=c.id),
 'last_message',(select to_jsonb(m) from public.messages m where m.chat_id=c.id and m.deleted_at is null order by m.created_at desc,m.id desc limit 1)) data
 from public.chats c order by c.updated_at desc limit 100)x
$$;

create function private.create_call_room(p_title text,p_mode text) returns public.call_rooms language plpgsql security definer set search_path='' as $$
declare r public.call_rooms;
begin
 if auth.uid() is null then raise exception 'Войдите в аккаунт'; end if;
 if(select count(*) from public.call_rooms where owner_id=auth.uid() and created_at>now()-interval '1 minute')>=10 then raise exception 'Слишком много комнат. Подождите минуту'; end if;
 insert into public.call_rooms(owner_id,title,mode) values(auth.uid(),trim(p_title),p_mode) returning * into r; return r;
end $$;
create function public.create_call_room(p_title text,p_mode text) returns public.call_rooms language sql security invoker set search_path='' as $$ select private.create_call_room(p_title,p_mode) $$;
create function private.get_invited_room(p_room uuid) returns public.call_rooms language plpgsql security definer set search_path='' as $$
declare r public.call_rooms;
begin
 if auth.uid() is null then raise exception 'Войдите в аккаунт'; end if;
 select * into r from public.call_rooms where id=p_room and(not is_private or private.can_read_room(id));
 return r;
end $$;
create function public.get_invited_room(p_room uuid) returns public.call_rooms language sql security invoker set search_path='' as $$ select private.get_invited_room(p_room) $$;
create function private.join_call_room(p_room uuid,p_name text) returns public.room_participants language plpgsql security definer set search_path='' as $$
declare r public.call_rooms; p public.room_participants; me uuid:=auth.uid();
begin
 if me is null then raise exception 'Для звонка войдите в аккаунт'; end if;
 select * into r from public.call_rooms where id=p_room for update;
 if not found or(r.is_private and not private.can_read_room(p_room)) then raise exception 'Комната недоступна'; end if;
 if r.status='ended' or r.updated_at<now()-interval '10 minutes' then raise exception 'Звонок завершён'; end if;
 select * into p from public.room_participants where room_id=p_room and user_id=me;
 if found and p.last_active>now()-interval '90 seconds' then raise exception 'Вы уже подключены к этой комнате в другой вкладке'; end if;
 delete from public.room_participants where room_id=p_room and last_active<=now()-interval '90 seconds';
 if(select count(*) from public.room_participants where room_id=p_room)>=r.max_participants then raise exception 'В комнате достигнут максимум участников'; end if;
 insert into public.room_participants(room_id,user_id,display_name,is_host) values(p_room,me,trim(p_name),me=r.owner_id) returning * into p;
 update public.call_rooms set status='active',updated_at=now() where id=p_room;
 return p;
end $$;
create function public.join_call_room(p_room uuid,p_name text) returns public.room_participants language sql security invoker set search_path='' as $$ select private.join_call_room(p_room,p_name) $$;
create function private.leave_call_room(p_room uuid,p_participant uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Войдите в аккаунт'; end if;
 delete from public.room_participants where id=p_participant and room_id=p_room and user_id=auth.uid();
 update public.call_rooms set updated_at=now() where id=p_room and owner_id=auth.uid();
end $$;
create function public.leave_call_room(p_room uuid,p_participant uuid) returns void language sql security invoker set search_path='' as $$ select private.leave_call_room(p_room,p_participant) $$;
create function private.heartbeat_call_room(p_room uuid,p_participant uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Войдите в аккаунт'; end if;
 update public.room_participants set last_active=now() where id=p_participant and room_id=p_room and user_id=auth.uid();
 if not found then raise exception 'Участник недоступен'; end if;
 update public.call_rooms set updated_at=now() where id=p_room and status='active';
end $$;
create function public.heartbeat_call_room(p_room uuid,p_participant uuid) returns void language sql security invoker set search_path='' as $$ select private.heartbeat_call_room(p_room,p_participant) $$;
create function private.end_call_room(p_room uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Войдите в аккаунт'; end if;
 update public.call_rooms set status='ended',ended_at=now(),updated_at=now() where id=p_room and owner_id=auth.uid();
 if not found then raise exception 'Только создатель может закрыть комнату'; end if;
 update public.calls set status='ended',ended_at=now() where room_id=p_room and status in('ringing','accepted');
 delete from public.room_participants where room_id=p_room;
end $$;
create function public.end_call_room(p_room uuid) returns void language sql security invoker set search_path='' as $$ select private.end_call_room(p_room) $$;

create function private.start_direct_call(p_peer uuid,p_chat uuid,p_mode text) returns public.calls language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); r public.call_rooms; c public.calls;
begin
 if me is null or me=p_peer or not private.is_chat_member(p_chat) or not exists(select 1 from public.chat_participants where chat_id=p_chat and user_id=p_peer) then raise exception 'Нет доступа к звонку'; end if;
 perform id from public.profiles where id in(me,p_peer) order by id for update;
 update public.calls set status='missed',ended_at=now() where status='ringing' and created_at<now()-interval '45 seconds';
 if exists(select 1 from public.calls c join public.call_rooms r on r.id=c.room_id where c.status in('ringing','accepted') and r.status<>'ended' and r.updated_at>now()-interval '2 minutes' and(me in(c.caller_id,c.callee_id) or p_peer in(c.caller_id,c.callee_id))) then raise exception 'Пользователь занят'; end if;
 insert into public.call_rooms(owner_id,title,mode,max_participants,is_private) values(me,'Личный звонок',p_mode,2,true) returning * into r;
 insert into public.calls(caller_id,callee_id,chat_id,room_id,mode) values(me,p_peer,p_chat,r.id,p_mode) returning * into c;
 insert into public.call_events(callee_id,caller_user_id,call_id,mode) values(p_peer,me,c.id,p_mode);
 return c;
end $$;
create function public.start_direct_call(p_peer uuid,p_chat uuid,p_mode text) returns public.calls language sql security invoker set search_path='' as $$ select private.start_direct_call(p_peer,p_chat,p_mode) $$;
create function private.transition_call(p_call uuid,p_status text) returns public.calls language plpgsql security definer set search_path='' as $$
declare c public.calls; me uuid:=auth.uid();
begin
 if me is null then raise exception 'Войдите в аккаунт'; end if;
 select * into c from public.calls where id=p_call and me in(caller_id,callee_id) for update;
 if not found then raise exception 'Звонок недоступен'; end if;
 if p_status not in('accepted','declined','ended') or(p_status in('accepted','declined') and(me<>c.callee_id or c.status<>'ringing' or c.created_at<now()-interval '45 seconds')) then raise exception 'Звонок уже завершён или недоступен'; end if;
 if c.status in('ended','missed','declined','failed') then return c; end if;
 update public.calls set status=p_status,ended_at=case when p_status='accepted' then null else now() end where id=p_call returning * into c;
 if p_status<>'accepted' then update public.call_rooms set status='ended',ended_at=now(),updated_at=now() where id=c.room_id; end if;
 return c;
end $$;
create function public.transition_call(p_call uuid,p_status text) returns public.calls language sql security invoker set search_path='' as $$ select private.transition_call(p_call,p_status) $$;

-- No function gets the implicit PUBLIC execute grant.
revoke execute on all functions in schema private from public,anon;
revoke execute on all functions in schema public from public,anon;
grant execute on function private.is_chat_member(uuid),private.is_room_member(uuid),private.can_read_room(uuid),
 private.create_direct_chat(uuid),private.send_message(uuid,uuid,text,uuid,jsonb),private.delete_message(uuid),private.mark_chat_read(uuid,uuid),
 private.create_call_room(text,text),private.get_invited_room(uuid),private.join_call_room(uuid,text),private.leave_call_room(uuid,uuid),
 private.heartbeat_call_room(uuid,uuid),private.end_call_room(uuid),private.start_direct_call(uuid,uuid,text),private.transition_call(uuid,text) to authenticated;
grant execute on all functions in schema public to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('avatars','avatars',true,2097152,array['image/jpeg','image/png','image/webp']),
 ('chat-files','chat-files',false,15728640,null);
create policy avatars_read on storage.objects for select to anon,authenticated using(bucket_id='avatars');
create policy avatars_insert on storage.objects for insert to authenticated with check(bucket_id='avatars' and(storage.foldername(name))[1]=(select auth.uid())::text);
create policy avatars_update on storage.objects for update to authenticated using(bucket_id='avatars' and(storage.foldername(name))[1]=(select auth.uid())::text) with check(bucket_id='avatars' and(storage.foldername(name))[1]=(select auth.uid())::text);
create policy avatars_delete on storage.objects for delete to authenticated using(bucket_id='avatars' and(storage.foldername(name))[1]=(select auth.uid())::text);
create function private.can_access_file(p_path text) returns boolean language plpgsql stable security invoker set search_path='' as $$
begin return private.is_chat_member(split_part(p_path,'/',1)::uuid); exception when invalid_text_representation then return false; end $$;
revoke execute on function private.can_access_file(text) from public,anon;
grant execute on function private.can_access_file(text) to authenticated;
create policy chatfiles_read on storage.objects for select to authenticated using(bucket_id='chat-files' and private.can_access_file(name));
create policy chatfiles_insert on storage.objects for insert to authenticated with check(bucket_id='chat-files' and private.can_access_file(name) and(storage.foldername(name))[2]=(select auth.uid())::text);
create policy chatfiles_delete on storage.objects for delete to authenticated using(bucket_id='chat-files' and(storage.foldername(name))[2]=(select auth.uid())::text);

alter publication supabase_realtime add table public.messages,public.chats,public.chat_participants,public.profiles,public.calls,public.call_events,public.call_rooms,public.room_participants,public.call_signals;
