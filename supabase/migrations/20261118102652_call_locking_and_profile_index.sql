create or replace function private.start_direct_call(p_peer uuid,p_chat uuid,p_mode text) returns public.calls language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); r public.call_rooms; c public.calls;
begin
 if me is null or me=p_peer or not private.is_chat_member(p_chat) or not exists(select 1 from public.chat_participants where chat_id=p_chat and user_id=p_peer) then raise exception 'Нет доступа к звонку'; end if;
 perform id from public.profiles where id in(me,p_peer) order by id for update;
 update public.calls set status='missed',ended_at=now() where status='ringing' and created_at<now()-interval '45 seconds';
 if exists(select 1 from public.calls existing_call join public.call_rooms existing_room on existing_room.id=existing_call.room_id where existing_call.status in('ringing','accepted') and existing_room.status<>'ended' and existing_room.updated_at>now()-interval '2 minutes' and(me in(existing_call.caller_id,existing_call.callee_id) or p_peer in(existing_call.caller_id,existing_call.callee_id))) then raise exception 'Пользователь занят'; end if;
 insert into public.call_rooms(owner_id,title,mode,max_participants,is_private) values(me,'Личный звонок',p_mode,2,true) returning * into r;
 insert into public.calls(caller_id,callee_id,chat_id,room_id,mode) values(me,p_peer,p_chat,r.id,p_mode) returning * into c;
 insert into public.call_events(callee_id,caller_user_id,call_id,mode) values(p_peer,me,c.id,p_mode);
 return c;
end $$;
create index chats_creator_idx on public.chats(created_by);
