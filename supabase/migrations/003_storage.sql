-- ============================================================
-- Nexus Messenger — buckets и политики Storage (миграция 003)
-- ============================================================

insert into storage.buckets (id, name, public) values ('avatars','avatars', true);
insert into storage.buckets (id, name, public) values ('chat-files','chat-files', false);

-- аватары: публичное чтение, запись только в свою папку <uid>/...
create policy "avatars_public_read" on storage.objects for select
  using (bucket_id = 'avatars');
create policy "avatars_own_write" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "avatars_own_update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid()::text));

-- файлы чатов: приватный bucket; скачать можно по signed URL,
-- который выдаёт только участник чата (проверка через связь путь->сообщение->чат)
create policy "chatfiles_own_write" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-files' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "chatfiles_members_read" on storage.objects for select to authenticated
  using (bucket_id = 'chat-files' and (
    (storage.foldername(name))[1] = (select auth.uid()::text)
    or exists (
      select 1 from public.messages m
      join public.chat_participants cp on cp.chat_id = m.chat_id
      where m.attachment->>'storage_path' = storage.objects.name
        and cp.user_id = (select auth.uid())
    )
  ));
create policy "chatfiles_own_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'chat-files' and (storage.foldername(name))[1] = (select auth.uid()::text));
