import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './supabase';
import { MockBackend } from './mockBackend';
import { APP_CONFIG } from '../config';
import type { Profile, Chat, Message, Call, CallRoom, RoomParticipant, SignalMessage, IncomingCallEvent, CallMode, Attachment } from '../types';
export interface BackendApi {
  // auth
  getSessionUserId(): Promise<string | null>;
  getProfile(userId: string): Promise<Profile | null>;
  signUp(email: string, password: string, displayName: string, username: string): Promise<{ error?: string; needsConfirmation: boolean }>;
  signIn(email: string, password: string): Promise<{ error?: string }>;
  signOut(): Promise<void>;
  updatePassword(password: string): Promise<{ error?: string }>;
  resetPassword(email: string): Promise<{ error?: string }>;
  onAuthChange(cb: (userId: string | null, event?: string) => void): () => void;

  // profiles
  searchUsers(q: string, excludeId?: string): Promise<Profile[]>;
  updateProfile(userId: string, patch: Partial<Pick<Profile, 'display_name' | 'status_text'>>): Promise<{ error?: string }>;
  uploadAvatar(userId: string, file: File): Promise<{ url?: string; error?: string }>;
  setPresence(userId: string, online: boolean): Promise<void>;

  // chats & messages
  getChats(userId: string): Promise<Chat[]>;
  createDirectChat(me: string, peerId: string): Promise<Chat>;
  getMessages(chatId: string, before?: string): Promise<Message[]>;
  sendMessage(chatId: string, senderId: string, content: string, replyTo: string | null, attachment: Attachment | null, messageId?: string): Promise<Message>;
  deleteMessage(messageId: string, userId: string): Promise<{ error?: string }>;
  markRead(chatId: string, userId: string): Promise<void>;
  subscribeChat(chatId: string, cb: (m: Message) => void): () => void;
  subscribeChats(userId: string, cb: () => void): () => void;

  // files
  uploadChatFile(chatId: string, senderId: string, file: File, onProgress?: (p: number) => void): Promise<Attachment | { error: string }>;

  // calls (1:1)
  startCall(callerId: string, calleeId: string, chatId: string, mode: CallMode): Promise<Call>;
  getCall(callId: string): Promise<Call | null>;
  acceptCall(callId: string): Promise<{ error?: string }>;
  declineCall(callId: string): Promise<void>;
  endCall(callId: string): Promise<void>;
  listCalls(userId: string): Promise<Call[]>;
  subscribeIncomingCall(userId: string, cb: (e: IncomingCallEvent) => void): () => void;
  subscribeCallUpdates(userId: string, cb: (c: Call) => void): () => void;

  // rooms (link invites)
  createRoom(ownerId: string, title: string, mode: CallMode): Promise<CallRoom>;
  getRoom(roomId: string): Promise<CallRoom | null>;
  joinRoom(roomId: string, opts: { userId?: string | null; displayName: string }): Promise<{ participant?: RoomParticipant; error?: string }>;
  leaveRoom(roomId: string, participantId: string): Promise<void>;
  heartbeat(roomId: string, participantId: string): Promise<void>;
  listParticipants(roomId: string): Promise<RoomParticipant[]>;
  endRoom(roomId: string): Promise<void>;
  subscribeRoom(roomId: string, cb: () => void): () => void;

  // signaling
  sendSignal(roomId: string, from: string, to: string | null, payload: SignalMessage['payload']): Promise<void>;
  getSignalsSince(roomId: string, sinceId: number): Promise<SignalMessage[]>;
  subscribeSignals(roomId: string, selfPeer: string, cb: (s: SignalMessage) => void): () => void;
}


const msgSelect = '*,sender:profiles!messages_sender_id_fkey(id,display_name,avatar_url)';
const callbackUrl = () => new URL(import.meta.env.BASE_URL, window.location.origin).href;
function fail(error: { message: string } | null) { if (error) throw new Error(error.message); }

export class SupabaseBackend implements BackendApi {
  private signed = new Map<string, { url: string; until: number }>();
  constructor(private client: SupabaseClient) {}
  private async rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const { data, error } = await this.client.rpc(name, args); fail(error); return data as T;
  }
  private subscribe(channel: RealtimeChannel, refresh: () => void, interval = 15000) {
    let active = true;
    const run = () => { if (active && navigator.onLine) refresh(); };
    channel.subscribe(status => { if (status === 'SUBSCRIBED') run(); });
    const timer = window.setInterval(run, interval);
    window.addEventListener('online', run);
    window.addEventListener('focus', run);
    return () => { active = false; clearInterval(timer); window.removeEventListener('online', run); window.removeEventListener('focus', run); void this.client.removeChannel(channel); };
  }
  async getSessionUserId() { const { data, error } = await this.client.auth.getSession(); fail(error); if (data.session) await this.client.realtime.setAuth(data.session.access_token); return data.session?.user.id ?? null; }
  async getProfile(id: string) { const { data, error } = await this.client.from('profiles').select('*').eq('id', id).maybeSingle(); fail(error); return data as Profile | null; }
  async signIn(email: string, password: string) { const { error } = await this.client.auth.signInWithPassword({ email, password }); return { error: error ? authError(error.message) : undefined }; }
  async signUp(email: string, password: string, displayName: string, username: string) {
    const { data, error } = await this.client.auth.signUp({ email, password, options: { data: { display_name: displayName, username }, emailRedirectTo: callbackUrl() } });
    return { error: error ? authError(error.message) : undefined, needsConfirmation: !error && !data.session };
  }
  async signOut() { const { error } = await this.client.auth.signOut({ scope: 'local' }); fail(error); this.signed.clear(); }
  async updatePassword(password: string) { const { error } = await this.client.auth.updateUser({ password }); return { error: error ? authError(error.message) : undefined }; }
  async resetPassword(email: string) { const { error } = await this.client.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl() + '?recovery=1' }); return { error: error ? authError(error.message) : undefined }; }
  onAuthChange(cb: (id: string | null, event?: string) => void) {
    let active = true;
    const { data } = this.client.auth.onAuthStateChange((event, session) => { setTimeout(() => { if (active) { if (session) void this.client.realtime.setAuth(session.access_token); cb(session?.user.id ?? null, event); } }, 0); });
    return () => { active = false; data.subscription.unsubscribe(); };
  }
  async searchUsers(query: string, excludeId?: string) {
    const like = query.trim().replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 60);
    let q = this.client.from('profiles').select('*').limit(20).order('display_name');
    if (like) q = q.or(`display_name.ilike.%${like}%,username.ilike.%${like}%`);
    if (excludeId) q = q.neq('id', excludeId);
    const { data, error } = await q; fail(error); return (data ?? []) as Profile[];
  }
  async updateProfile(userId: string, patch: Partial<Pick<Profile, 'display_name' | 'status_text'>>) {
    const { error } = await this.client.from('profiles').update(patch).eq('id', userId).select('id').single(); return { error: error?.message };
  }
  async uploadAvatar(userId: string, file: File) {
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 2*1024*1024) return { error: 'Используйте JPG, PNG или WebP до 2 МБ' };
    const path = `${userId}/${crypto.randomUUID()}.${file.type.split('/')[1]}`;
    const { error } = await this.client.storage.from('avatars').upload(path, file, { contentType: file.type });
    if (error) return { error: error.message };
    const { data } = this.client.storage.from('avatars').getPublicUrl(path);
    const { error: updateError } = await this.client.from('profiles').update({ avatar_url: data.publicUrl }).eq('id', userId).select('id').single();
    return updateError ? { error: updateError.message } : { url: data.publicUrl };
  }
  async setPresence(userId: string, online: boolean) { const { error } = await this.client.from('profiles').update({ is_online: online, last_seen: new Date().toISOString() }).eq('id', userId); fail(error); }
  async getChats(_userId: string) { return this.rpc<Chat[]>('list_my_chats'); }
  async createDirectChat(_me: string, peerId: string) { return this.rpc<Chat>('create_direct_chat', { p_peer: peerId }); }
  private async hydrate(message: Message): Promise<Message> {
    if (!message.attachment || message.deleted_at) return message;
    const path = message.attachment.storage_path;
    let signed = this.signed.get(path);
    if (!signed || signed.until < Date.now()) {
      const { data, error } = await this.client.storage.from('chat-files').createSignedUrl(path, 3600);
      if (!error && data) { signed = { url: data.signedUrl, until: Date.now() + 50*60000 }; this.signed.set(path, signed); }
    }
    return { ...message, attachment: { ...message.attachment, url: signed?.url ?? '' } };
  }
  async getMessages(chatId: string, before?: string) {
    let q = this.client.from('messages').select(msgSelect).eq('chat_id', chatId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(50);
    if (before) q = q.lt('created_at', before);
    const { data, error } = await q; fail(error);
    const messages = ((data ?? []) as unknown as Message[]).reverse();
    const ids = [...new Set(messages.flatMap(m => m.reply_to ? [m.reply_to] : []))];
    if (ids.length) {
      const { data: replies, error: replyError } = await this.client.from('messages').select('id,content,sender_id,deleted_at').in('id', ids);
      fail(replyError);
      for (const m of messages) m.reply_to_message = replies?.find(r => r.id === m.reply_to && !r.deleted_at) ?? null;
    }
    return Promise.all(messages.map(m => this.hydrate(m)));
  }
  async sendMessage(chatId: string, _senderId: string, content: string, replyTo: string | null, attachment: Attachment | null, messageId = crypto.randomUUID()) {
    const m = await this.rpc<Message>('send_message', { p_id: messageId, p_chat: chatId, p_content: content, p_reply: replyTo, p_attachment: attachment });
    return this.hydrate(m);
  }
  async deleteMessage(id: string, _userId: string) { const { error } = await this.client.rpc('delete_message', { p_message: id }); return { error: error?.message }; }
  async markRead(chatId: string, userId: string) { await this.rpc('mark_chat_read', { p_chat: chatId, p_user: userId }); }
  subscribeChat(chatId: string, cb: (m: Message) => void) {
    let active = true;
    let refreshing = false;
    const seen = new Map<string, string>();
    const deliver = async (m: Message) => { const hydrated = await this.hydrate(m); const key = JSON.stringify(hydrated); if (active && seen.get(m.id) !== key) { seen.set(m.id, key); cb(hydrated); } };
    const refresh = () => { if (refreshing) return; refreshing = true; void this.getMessages(chatId).then(list => Promise.all(list.map(deliver))).catch(() => {}).finally(() => { refreshing = false; }); };
    const ch = this.client.channel('chat:' + chatId + ':' + crypto.randomUUID()).on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: 'chat_id=eq.' + chatId }, refresh);
    const stop = this.subscribe(ch, refresh);
    return () => { active = false; stop(); };
  }
  subscribeChats(userId: string, cb: () => void) {
    const ch = this.client.channel('chats:' + crypto.randomUUID())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chats' }, cb)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_participants', filter: 'user_id=eq.' + userId }, cb)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, cb);
    return this.subscribe(ch, cb);
  }
  async uploadChatFile(chatId: string, senderId: string, file: File, progress?: (p: number) => void): Promise<Attachment | { error: string }> {
    if (file.size > APP_CONFIG.limits.maxFileSizeMb*1024*1024) return { error: 'Файл больше 15 МБ' };
    const path = `${chatId}/${senderId}/${crypto.randomUUID()}`;
    const { error } = await this.client.storage.from('chat-files').upload(path, file, { contentType: file.type || 'application/octet-stream' });
    if (error) return { error: error.message };
    progress?.(100);
    return { name: file.name, url: '', storage_path: path, size: file.size, mime: file.type, kind: file.type.startsWith('image/') ? 'image' : 'file' };
  }
  async startCall(_caller: string, peer: string, chat: string, mode: CallMode) { return this.rpc<Call>('start_direct_call', { p_peer: peer, p_chat: chat, p_mode: mode }); }
  async getCall(id: string) { const { data, error } = await this.client.from('calls').select('*').eq('id', id).maybeSingle(); fail(error); return data as Call | null; }
  async acceptCall(id: string) { const { error } = await this.client.rpc('transition_call', { p_call: id, p_status: 'accepted' }); return { error: error?.message }; }
  async declineCall(id: string) { await this.rpc('transition_call', { p_call: id, p_status: 'declined' }); }
  async endCall(id: string) { await this.rpc('transition_call', { p_call: id, p_status: 'ended' }); }
  async listCalls(user: string) {
    const { data, error } = await this.client.from('calls').select('*,caller:profiles!calls_caller_id_fkey(id,display_name,avatar_url),callee:profiles!calls_callee_id_fkey(id,display_name,avatar_url)').or(`caller_id.eq.${user},callee_id.eq.${user}`).order('created_at', { ascending: false }).limit(50); fail(error); return (data ?? []) as Call[];
  }
  subscribeIncomingCall(user: string, cb: (e: IncomingCallEvent) => void) {
    const seen = new Set<string>();
    const refresh = () => { void this.listCalls(user).then(async list => { for (const c of list) if (c.callee_id === user && c.status === 'ringing' && Date.now()-Date.parse(c.created_at)<45000 && !seen.has(c.id)) { seen.add(c.id); cb({ id: 0, callee_id: user, caller_user_id: c.caller_id, call_id: c.id, mode: c.mode, created_at: c.created_at, caller: c.caller }); } }).catch(() => {}); };
    const ch = this.client.channel('incoming:' + crypto.randomUUID()).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_events', filter: 'callee_id=eq.' + user }, refresh);
    return this.subscribe(ch, refresh, 5000);
  }
  subscribeCallUpdates(user: string, cb: (c: Call) => void) {
    const seen = new Map<string,string>();
    const refresh = () => { void this.listCalls(user).then(list => { for (const c of list) { if (seen.get(c.id)!==c.status) { seen.set(c.id,c.status); cb(c); } } }).catch(() => {}); };
    const ch = this.client.channel('calls:' + crypto.randomUUID()).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls' }, refresh);
    return this.subscribe(ch, refresh, 5000);
  }
  async createRoom(_owner: string, title: string, mode: CallMode) { return this.rpc<CallRoom>('create_call_room', { p_title: title, p_mode: mode }); }
  async getRoom(id: string) { return this.rpc<CallRoom | null>('get_invited_room', { p_room: id }); }
  async joinRoom(id: string, opts: { userId?: string | null; displayName: string }) { const { data, error } = await this.client.rpc('join_call_room', { p_room: id, p_name: opts.displayName }); return { participant: error ? undefined : data as RoomParticipant, error: error?.message }; }
  async leaveRoom(room: string, id: string) { await this.rpc('leave_call_room', { p_room: room, p_participant: id }); }
  async heartbeat(room: string, id: string) { await this.rpc('heartbeat_call_room', { p_room: room, p_participant: id }); }
  async listParticipants(id: string) { const { data, error } = await this.client.from('room_participants').select('*,user:profiles!room_participants_user_id_fkey(id,display_name,avatar_url)').eq('room_id', id).gt('last_active', new Date(Date.now()-90000).toISOString()); fail(error); return (data ?? []) as RoomParticipant[]; }
  async endRoom(id: string) { await this.rpc('end_call_room', { p_room: id }); }
  subscribeRoom(id: string, cb: () => void) {
    const ch = this.client.channel('room:' + id + ':' + crypto.randomUUID())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_participants', filter: 'room_id=eq.' + id }, cb)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'call_rooms', filter: 'id=eq.' + id }, cb);
    return this.subscribe(ch, cb, 5000);
  }
  async sendSignal(room: string, from: string, to: string | null, payload: SignalMessage['payload']) { const { error } = await this.client.from('call_signals').insert({ room_id: room, sender_peer: from, target_peer: to, payload }); fail(error); }
  async getSignalsSince(room: string, since: number) { const { data, error } = await this.client.from('call_signals').select('*').eq('room_id', room).gt('id', since).order('id').limit(200); fail(error); return (data ?? []) as SignalMessage[]; }
  subscribeSignals(room: string, self: string, cb: (s: SignalMessage) => void) {
    const ch = this.client.channel('signals:' + crypto.randomUUID()).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_signals', filter: 'room_id=eq.' + room }, p => { const s = p.new as SignalMessage; if (s.sender_peer!==self && (!s.target_peer || s.target_peer===self)) cb(s); }).subscribe();
    return () => { void this.client.removeChannel(ch); };
  }
}
function authError(message: string) {
  if (/invalid login credentials/i.test(message)) return 'Неверный e-mail или пароль';
  if (/email not confirmed/i.test(message)) return 'Подтвердите e-mail по ссылке из письма';
  if (/already registered|already exists|duplicate key|database error saving/i.test(message)) return 'E-mail или логин уже занят. Попробуйте другой';
  if (/rate limit/i.test(message)) return 'Слишком много попыток. Попробуйте позже';
  return message;
}
export const backend: BackendApi = APP_CONFIG.demoMode ? new MockBackend(() => { try { return new BroadcastChannel('nexus-realtime'); } catch { return null; } }) : new SupabaseBackend(supabase!);
export { isSupabaseConfigured };
