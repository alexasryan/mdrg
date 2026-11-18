import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import publicConfig from '../supabase.public.json';
import { SupabaseBackend } from '../src/lib/backend';
import type { Chat, Message, Call, RoomParticipant } from '../src/types';

const fixture = process.env.MDRG_TEST_FIXTURE;
describe.skipIf(!fixture)('hosted Supabase authorization and persistence', () => {
 const users = fixture ? JSON.parse(readFileSync(fixture,'utf8')) as {id:string; email:string; password:string}[] : [];
 let clients: SupabaseClient[]; let api: SupabaseBackend[]; let chat: Chat; let message: Message; let call: Call; let parts: RoomParticipant[];
 const files: string[]=[];
 beforeAll(async()=>{
  clients=users.map(()=>createClient(publicConfig.url,publicConfig.publishableKey,{auth:{persistSession:false,autoRefreshToken:false}}));
  api=clients.map(c=>new SupabaseBackend(c));
  await Promise.all(clients.map(async(c,i)=>{const {error}=await c.auth.signInWithPassword(users[i]);if(error)throw error;await c.realtime.setAuth((await c.auth.getSession()).data.session!.access_token);}));
 },30000);
 afterAll(async()=>{ if(clients){for(const path of files)await clients[0].storage.from('chat-files').remove([path]);await Promise.all(clients.map(c=>c.auth.signOut()));} });
 it('signs in real users and creates exactly one chat under concurrent requests',async()=>{
  expect((await api[0].getProfile(users[0].id))?.id).toBe(users[0].id);
  const chats=await Promise.all([api[0].createDirectChat(users[0].id,users[1].id),api[1].createDirectChat(users[1].id,users[0].id)]);
  expect(chats[0].id).toBeTruthy();expect(chats[0].id).toBe(chats[1].id);chat=chats[0];
  expect((await api[1].getChats(users[1].id))[0].participants).toHaveLength(2);
 });
 it('persists messages, retries idempotently, and rejects outsider access and forged read receipts',async()=>{
  const id=crypto.randomUUID();
  message=await api[0].sendMessage(chat.id,users[0].id,'Серверная проверка',null,null,id);
  expect(message.id).toBe(id);
  expect((await api[0].sendMessage(chat.id,users[0].id,'Серверная проверка',null,null,id)).id).toBe(id);
  expect((await api[1].getMessages(chat.id)).filter(m=>m.id===id)).toHaveLength(1);
  expect(await api[2].getMessages(chat.id)).toEqual([]);
  await expect(api[2].sendMessage(chat.id,users[0].id,'Подмена',null,null)).rejects.toThrow();
  await expect(api[0].markRead(chat.id,users[1].id)).rejects.toThrow();
  await api[1].markRead(chat.id,users[1].id);
  expect((await api[0].getMessages(chat.id)).find(m=>m.id===id)!.read_by).toContain(users[1].id);
 });
 it('blocks unauthenticated reads and caller-id spoofing through direct table writes',async()=>{
  const anon=createClient(publicConfig.url,publicConfig.publishableKey,{auth:{persistSession:false}});
  expect((await anon.from('messages').select('*')).error).toBeTruthy();
  expect((await clients[2].from('messages').insert({chat_id:chat.id,sender_id:users[0].id,content:'Подмена'})).error).toBeTruthy();
  expect((await clients[0].from('profiles').update({username:'stolen_name'}).eq('id',users[1].id)).error).toBeTruthy();
 });
 it('stores attachments privately and authorizes signing by chat membership',async()=>{
  const attachment=await api[0].uploadChatFile(chat.id,users[0].id,new File(['test file'],'check.txt',{type:'text/plain'}));
  if('error'in attachment)throw new Error(attachment.error); files.push(attachment.storage_path);
  const sent=await api[0].sendMessage(chat.id,users[0].id,'',null,attachment);
  expect(sent.attachment?.url).toContain('token=');
  expect((await clients[2].storage.from('chat-files').createSignedUrl(attachment.storage_path,60)).error).toBeTruthy();
  const received=(await api[1].getMessages(chat.id)).find(m=>m.id===sent.id)!;
  expect(await(await fetch(received.attachment!.url)).text()).toBe('test file');
 });
 it('delivers Postgres changes to an independent authenticated websocket',async()=>{
  let done:(value:unknown)=>void=()=>{};const received=new Promise(resolve=>{done=resolve});
  const ch=clients[1].channel('qa-'+crypto.randomUUID()).on('system',{},p=>console.log('Realtime system:',p)).on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:'chat_id=eq.'+chat.id},p=>done(p.new));
  await new Promise<void>((resolve,reject)=>{ch.subscribe(status=>{if(status==='SUBSCRIBED')resolve();if(status==='CHANNEL_ERROR')reject(new Error(status))});setTimeout(()=>reject(new Error('Realtime subscription timed out')),15000).unref()});
  try{const sent=await api[0].sendMessage(chat.id,users[0].id,'Realtime проверка',null,null);expect(await Promise.race([received,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Realtime event timed out')),15000).unref())])).toMatchObject({id:sent.id});}
  finally{await clients[1].removeChannel(ch);}
 },40000);
 it('creates a private direct-call room and refuses outsider joins, forged signals and unauthorized acceptance',async()=>{
  call=await api[0].startCall(users[0].id,users[1].id,chat.id,'audio');expect(call.room_id).toBeTruthy();
  expect((await api[2].joinRoom(call.room_id!,{displayName:'Посторонний'})).error).toBeTruthy();
  expect((await api[0].acceptCall(call.id)).error).toBeTruthy();
  expect((await api[1].acceptCall(call.id)).error).toBeUndefined();
  parts=[];
  for(let i=0;i<2;i++){const joined=await api[i].joinRoom(call.room_id!,{displayName:'Проверка '+i});if(joined.error)throw new Error(joined.error);parts.push(joined.participant!);}
  await expect(api[2].sendSignal(call.room_id!,parts[0].id,parts[1].id,{type:'ready'})).rejects.toThrow();
  await api[0].sendSignal(call.room_id!,parts[0].id,parts[1].id,{type:'ready'});
  expect((await api[1].getSignalsSince(call.room_id!,0))).toHaveLength(1);
  expect((await api[2].getSignalsSince(call.room_id!,0))).toHaveLength(0);
  await api[0].heartbeat(call.room_id!,parts[0].id);
  await api[0].endCall(call.id);
  for(let i=0;i<2;i++)await api[i].leaveRoom(call.room_id!,parts[i].id);
 });
 it('soft-deletes only the sender’s messages and persists the deletion',async()=>{
  expect((await api[1].deleteMessage(message.id,users[1].id)).error).toBeTruthy();
  expect((await api[0].deleteMessage(message.id,users[0].id)).error).toBeUndefined();
  expect((await api[1].getMessages(chat.id)).find(m=>m.id===message.id)?.deleted_at).toBeTruthy();
  writeFileSync('/tmp/mdrg-live-test-resources.json',JSON.stringify({chat:chat.id,call:call.id,users:users.map(u=>u.id)}));
 });
});
