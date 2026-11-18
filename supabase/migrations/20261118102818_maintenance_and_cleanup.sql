create extension if not exists pg_cron with schema pg_catalog;
create or replace function private.maintenance() returns void language plpgsql security definer set search_path='' as $$
begin
 update public.calls set status='missed',ended_at=now() where status='ringing' and created_at<now()-interval '45 seconds';
 update public.call_rooms set status='ended',ended_at=now(),updated_at=now() where status<>'ended' and updated_at<now()-interval '10 minutes';
 update public.calls c set status='ended',ended_at=now() from public.call_rooms r where c.room_id=r.id and r.status='ended' and c.status='accepted';
 delete from public.call_signals where created_at<now()-interval '10 minutes';
 delete from public.room_participants where last_active<now()-interval '90 seconds';
 delete from public.call_events where created_at<now()-interval '1 day';
 update public.profiles set is_online=false where is_online and last_seen<now()-interval '2 minutes';
end $$;
revoke execute on function private.maintenance() from public,anon,authenticated;
select cron.schedule('mdrg-maintenance','* * * * *','select private.maintenance()');
create index messages_sender_created_idx on public.messages(sender_id,created_at desc);
