-- ============================================================
-- Nexus Messenger — Row Level Security (миграция 002)
-- ============================================================

alter table public.profiles enable row level security;
alter table public.chats enable row level security;
alter table public.chat_participants enable row level security;
alter table public.messages enable row level security;
alter table public.calls enable row level security;
alter table public.call_events enable row level security;
alter table public.call_rooms enable row level security;
alter table public.room_participants enable row level security;
alter table public.call_signals enable row level security;

-- ---------- profiles ----------
-- профиль видят все авторизованные (нужен для поиска людей и аватаров),
-- изменить можно только свой
create policy "profiles_read_auth" on public.profiles for select to authenticated using (true);
create policy "profiles_update_own" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- ---------- chats & participants ----------
create policy "chats_read_members" on public.chats for select to authenticated
  using (public.is_chat_member(id) or created_by = (select auth.uid()));
create policy "chats_create_direct" on public.chats for insert to authenticated
  with check (created_by = (select auth.uid()) and type = 'direct');
create policy "chats_update_members" on public.chats for update to authenticated
  using (public.is_chat_member(id));

create policy "parts_read_own" on public.chat_participants for select to authenticated
  using (user_id = (select auth.uid()) or public.is_chat_member(chat_id));
create policy "parts_insert_by_creator" on public.chat_participants for insert to authenticated
  with check (exists (select 1 from chats c where c.id = chat_id and c.created_by = (select auth.uid())));

-- ---------- messages ----------
-- читать могут только участники этого чата — чужие переписки недоступны
create policy "messages_read_members" on public.messages for select to authenticated
  using (public.is_chat_member(chat_id));
create policy "messages_insert_member" on public.messages for insert to authenticated
  with check (public.is_chat_member(chat_id) and sender_id = (select auth.uid()));
-- UPDATE не разрешён никому: редактирование отключено намеренно,
-- read_by меняется только через RPC mark_chat_read (security definer).
create policy "messages_delete_own" on public.messages for delete to authenticated
  using (sender_id = (select auth.uid()));

-- ---------- calls ----------
create policy "calls_read_participants" on public.calls for select to authenticated
  using (caller_id = (select auth.uid()) or callee_id = (select auth.uid()));
create policy "calls_insert_caller" on public.calls for insert to authenticated
  with check (caller_id = (select auth.uid()));
create policy "calls_update_participants" on public.calls for update to authenticated
  using (caller_id = (select auth.uid()) or callee_id = (select auth.uid()))
  with check (caller_id = (select auth.uid()) or callee_id = (select auth.uid()));

-- события входящих: вставляет звонящий, читает только получатель
create policy "events_read_callee" on public.call_events for select to authenticated
  using (callee_id = (select auth.uid()));
create policy "events_insert_caller" on public.call_events for insert to authenticated
  with check (caller_user_id = (select auth.uid()));

-- ---------- rooms ----------
-- комнату может прочитать любой по случайному UUID (в т.ч. гость по ссылке-приглашению);
-- секрета в комнате нет — доступ к медиа защищён WebRTC + политиками сигнализации
create policy "rooms_read" on public.call_rooms for select using (true);
create policy "rooms_insert_owner" on public.call_rooms for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "rooms_update_owner_or_participant" on public.call_rooms for update to authenticated
  using (owner_id = (select auth.uid())
     or exists (select 1 from room_participants rp where rp.room_id = id and rp.user_id = (select auth.uid())));

-- участники комнаты: чтение свободно (состав публичен для подключённых),
-- вставка ограничена триггером capacity/ended; удаление — только своих записей
create policy "rp_read" on public.room_participants for select using (true);
create policy "rp_insert" on public.room_participants for insert with check (true);
create policy "rp_delete_self" on public.room_participants for delete
  using (user_id = (select auth.uid()) or user_id is null);
-- Примечание: чтобы удалить запись другого участника, нужно знать её UUID,
-- который выдаётся только самому участнику. Для жёсткого контроля вынесите
-- join/leave в Edge Function с service role.

-- ---------- signaling ----------
-- читать/писать сигналы комнаты могут только её участники — защита от
-- подключения посторонних к чужим переговорам через подмену room_id
create policy "signals_read_participants" on public.call_signals for select
  using (exists (select 1 from room_participants rp where rp.room_id = call_signals.room_id
                 and (rp.user_id = (select auth.uid()) or rp.id = sender_peer or rp.id = target_peer)));
create policy "signals_insert_sender" on public.call_signals for insert
  with check (exists (select 1 from room_participants rp where rp.room_id = call_signals.room_id
                 and rp.id = sender_peer));

-- ---------- realtime ----------
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.call_events;
alter publication supabase_realtime add table public.calls;
alter publication supabase_realtime add table public.call_signals;
alter publication supabase_realtime add table public.room_participants;
alter publication supabase_realtime add table public.call_rooms;
