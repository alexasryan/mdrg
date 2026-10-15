/**
 * Единый API данных для Nexus Messenger.
 * Реализация выбирается автоматически:
 *  - Supabase (реальный бэкенд, realtime, storage) если настроен;
 *  - MockBackend (localStorage + BroadcastChannel) — демо-режим без сервера,
 *    чтобы приложение можно было открыть и протестировать в двух вкладках.
 */
import { supabase, isSupabaseConfigured } from './supabase';
import { MockBackend } from './mockBackend';
import type {
  Profile,
  Chat,
  Message,
  Call,
  CallRoom,
  RoomParticipant,
  SignalMessage,
  IncomingCallEvent,
  CallMode,
  Attachment,
} from '../types';

export interface BackendApi {
  // auth
  getSessionUserId(): Promise<string | null>;
  getProfile(userId: string): Promise<Profile | null>;
  signUp(email: string, password: string, displayName: string, username: string): Promise<{ error?: string; needsConfirmation: boolean }>;
  signIn(email: string, password: string): Promise<{ error?: string }>;
  signOut(): Promise<void>;
  resetPassword(email: string): Promise<{ error?: string }>;
  onAuthChange(cb: (userId: string | null) => void): () => void;

  // profiles
  searchUsers(q: string, excludeId?: string): Promise<Profile[]>;
  updateProfile(userId: string, patch: Partial<Pick<Profile, 'display_name' | 'status_text'>>): Promise<{ error?: string }>;
  uploadAvatar(userId: string, file: File): Promise<{ url?: string; error?: string }>;
  setPresence(userId: string, online: boolean): Promise<void>;

  // chats & messages
  getChats(userId: string): Promise<Chat[]>;
  createDirectChat(me: string, peerId: string): Promise<Chat>;
  getMessages(chatId: string, before?: string): Promise<Message[]>;
  sendMessage(chatId: string, senderId: string, content: string, replyTo: string | null, attachment: Attachment | null): Promise<Message>;
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

const CHANNEL = 'nexus-realtime';

function bc(): BroadcastChannel | null {
  try {
    return new BroadcastChannel(CHANNEL);
  } catch {
    return null;
  }
}

/* ============================ SUPABASE ============================ */

const sb = () => {
  if (!supabase) throw new Error('Supabase не настроен');
  return supabase;
};

const msgSelect = `*, sender:profiles!messages_sender_id_fkey(id, display_name, avatar_url), reply_to_message:messages!messages_reply_to_fkey(id, content, sender_id)`;

class SupabaseBackend implements BackendApi {
  async getSessionUserId() {
    const { data } = await sb().auth.getSession();
    return data.session?.user.id ?? null;
  }
  async getProfile(userId: string) {
    const { data } = await sb().from('profiles').select('*').eq('id', userId).maybeSingle();
    return data as Profile | null;
  }
  async signUp(email: string, password: string, displayName: string, username: string) {
    const { data, error } = await sb().auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName, username }, emailRedirectTo: window.location.origin },
    });
    if (error) return { error: translateAuthError(error.message), needsConfirmation: false };
    const needsConfirmation = !!data.user && !data.session;
    return { needsConfirmation, error: undefined };
  }
  async signIn(email: string, password: string) {
    const { error } = await sb().auth.signInWithPassword({ email, password });
    if (error) return { error: translateAuthError(error.message) };
    return {};
  }
  async signOut() {
    await sb().auth.signOut();
  }
  async resetPassword(email: string) {
    const { error } = await sb().auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    if (error) return { error: translateAuthError(error.message) };
    return {};
  }
  onAuthChange(cb: (u: string | null) => void) {
    const { data } = sb().auth.onAuthStateChange((_e, session) => cb(session?.user.id ?? null));
    return () => data.subscription.unsubscribe();
  }

  async searchUsers(q: string, excludeId?: string) {
    const like = q.trim().replace(/[%_,()]/g, '');
    let query = sb()
      .from('profiles')
      .select('*')
      .or(`display_name.ilike.%${like}%,username.ilike.%${like}%`)
      .limit(20);
    if (excludeId) query = query.neq('id', excludeId);
    const { data } = await query;
    return (data ?? []) as Profile[];
  }
  async updateProfile(userId: string, patch: Partial<Pick<Profile, 'display_name' | 'status_text'>>) {
    const { error } = await sb().from('profiles').update(patch).eq('id', userId);
    return { error: error?.message };
  }
  async uploadAvatar(userId: string, file: File) {
    const ext = file.name.split('.').pop() || 'png';
    const path = `${userId}/avatar.${ext}`;
    const { error } = await sb().storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
    if (error) return { error: error.message };
    const { data } = sb().storage.from('avatars').getPublicUrl(path);
    await sb().from('profiles').update({ avatar_url: data.publicUrl }).eq('id', userId);
    return { url: data.publicUrl };
  }
  async setPresence(userId: string, online: boolean) {
    await sb()
      .from('profiles')
      .update({ is_online: online, last_seen: new Date().toISOString() })
      .eq('id', userId);
    bc()?.postMessage({ t: 'presence', userId, online });
  }

  async getChats(userId: string) {
    const { data } = await sb()
      .from('chats')
      .select('*, participants:chat_participants(user_id, profile:profiles!chat_participants_user_id_fkey(id, display_name, username, avatar_url, is_online))')
      .eq('participants.user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(100);
    const chats = (data ?? []) as unknown as Chat[];
    // последние сообщения
    const ids = chats.map((c) => c.id);
    if (ids.length) {
      const { data: lastMsgs } = await sb()
        .from('messages')
        .select(msgSelect)
        .in('chat_id', ids)
        .order('created_at', { ascending: false })
        .limit(ids.length * 3);
      for (const c of chats) {
        c.last_message = (lastMsgs ?? []).find((m) => m.chat_id === c.id) ?? null;
      }
    }
    return chats;
  }
  async createDirectChat(me: string, peerId: string) {
    const { data: existing } = await sb()
      .from('chat_participants')
      .select('chat_id')
      .eq('user_id', me);
    for (const row of existing ?? []) {
      const { data: other } = await sb().from('chat_participants').select('user_id').eq('chat_id', row.chat_id).neq('user_id', me).single();
      if (other?.user_id === peerId) {
        const { data: chat } = await sb().from('chats').select('*').eq('id', row.chat_id).single();
        return chat as Chat;
      }
    }
    const { data: chat, error } = await sb()
      .from('chats')
      .insert({ type: 'direct', created_by: me })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    await sb().from('chat_participants').insert([
      { chat_id: chat.id, user_id: me },
      { chat_id: chat.id, user_id: peerId },
    ]);
    bc()?.postMessage({ t: 'chats', userId: peerId });
    return chat as Chat;
  }
  async getMessages(chatId: string, before?: string) {
    let query = sb()
      .from('messages')
      .select(msgSelect)
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (before) query = query.lt('created_at', before);
    const { data } = await query;
    return ((data ?? []) as Message[]).reverse();
  }
  async sendMessage(chatId: string, senderId: string, content: string, replyTo: string | null, attachment: Attachment | null) {
    const { data, error } = await sb()
      .from('messages')
      .insert({ chat_id: chatId, sender_id: senderId, content, reply_to: replyTo, attachment })
      .select(msgSelect)
      .single();
    if (error) throw new Error(error.message);
    await sb().from('chats').update({ updated_at: new Date().toISOString() }).eq('id', chatId);
    return data as Message;
  }
  async deleteMessage(messageId: string, userId: string) {
    const { error } = await sb().from('messages').delete().eq('id', messageId).eq('sender_id', userId);
    return { error: error?.message };
  }
  async markRead(chatId: string, userId: string) {
    await sb().rpc('mark_chat_read', { p_chat: chatId, p_user: userId });
  }
  subscribeChat(chatId: string, cb: (m: Message) => void) {
    const ch = sb()
      .channel(`chat:${chatId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` }, async (p) => {
        const m = p.new as Message;
        // догружаем профиль отправителя
        const { data } = await sb().from('profiles').select('id, display_name, avatar_url').eq('id', m.sender_id).single();
        cb({ ...m, sender: data });
      })
      .subscribe();
    return () => {
      sb().removeChannel(ch);
    };
  }
  subscribeChats(_userId: string, cb: () => void) {
    const chan = bc();
    const h = (ev: MessageEvent) => {
      if (ev.data?.t === 'chats') cb();
    };
    chan?.addEventListener('message', h);
    return () => chan?.removeEventListener('message', h);
  }

  async uploadChatFile(_chatId: string, senderId: string, file: File, onProgress?: (p: number) => void) {
    const path = `${senderId}/${Date.now()}_${file.name.replace(/[^\w.\-А-Яа-яёЁ ]+/g, '')}`;
    try {
      const { error } = await sb().storage.from('chat-files').upload(path, file, {
        upsert: false,
        contentType: file.type || 'application/octet-stream',
      });
      if (error) return { error: translateStorageError(error.message) };
      onProgress?.(100);
      const { data } = await sb().storage.from('chat-files').createSignedUrl(path, 60 * 60 * 24 * 7);
      if (!data) return { error: 'Не удалось получить ссылку на файл' };
      return {
        name: file.name,
        url: data.signedUrl,
        storage_path: path,
        size: file.size,
        mime: file.type,
        kind: file.type.startsWith('image/') ? ('image' as const) : ('file' as const),
      };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  async startCall(callerId: string, calleeId: string, chatId: string, mode: CallMode) {
    // заняты?
    const { data: active } = await sb()
      .from('calls')
      .select('*')
      .eq('callee_id', calleeId)
      .in('status', ['ringing', 'accepted'])
      .maybeSingle();
    if (active) {
      const { data: c } = await sb()
        .from('calls')
        .insert({ caller_id: callerId, callee_id: calleeId, chat_id: chatId, mode, status: 'failed' })
        .select('*')
        .single();
      return c as Call;
    }
    const { data, error } = await sb()
      .from('calls')
      .insert({ caller_id: callerId, callee_id: calleeId, chat_id: chatId, mode })
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    const call = data as Call;
    await sb().from('call_events').insert({ callee_id: calleeId, caller_user_id: callerId, call_id: call.id, mode });
    return call;
  }
  async getCall(callId: string) {
    const { data } = await sb().from('calls').select('*').eq('id', callId).maybeSingle();
    return data as Call | null;
  }
  async acceptCall(callId: string) {
    const { error } = await sb().from('calls').update({ status: 'accepted' }).eq('id', callId).eq('status', 'ringing');
    return { error: error?.message };
  }
  async declineCall(callId: string) {
    await sb().from('calls').update({ status: 'declined', ended_at: new Date().toISOString() }).eq('id', callId);
  }
  async endCall(callId: string) {
    await sb().from('calls').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', callId);
  }
  async listCalls(userId: string) {
    const { data } = await sb()
      .from('calls')
      .select('*, caller:profiles!calls_caller_id_fkey(id, display_name, avatar_url), callee:profiles!calls_callee_id_fkey(id, display_name, avatar_url)')
      .or(`caller_id.eq.${userId},callee_id.eq.${userId}`)
      .order('created_at', { ascending: false })
      .limit(50);
    return (data ?? []) as Call[];
  }
  subscribeIncomingCall(userId: string, cb: (e: IncomingCallEvent) => void) {
    const ch = sb()
      .channel(`call-events:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_events', filter: `callee_id=eq.${userId}` }, async (p) => {
        const e = p.new as IncomingCallEvent;
        const { data } = await sb().from('profiles').select('id, display_name, avatar_url').eq('id', e.caller_user_id).single();
        cb({ ...e, caller: data });
      })
      .subscribe();
    return () => {
      sb().removeChannel(ch);
    };
  }
  subscribeCallUpdates(userId: string, cb: (c: Call) => void) {
    const ch = sb()
      .channel(`calls:${userId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls', filter: `callee_id=eq.${userId}` }, (p) => cb(p.new as Call))
      .subscribe();
    return () => {
      sb().removeChannel(ch);
    };
  }

  async createRoom(ownerId: string, title: string, mode: CallMode) {
    const { data, error } = await sb().from('call_rooms').insert({ owner_id: ownerId, title, mode }).select('*').single();
    if (error) throw new Error(error.message);
    return data as CallRoom;
  }
  async getRoom(roomId: string) {
    const { data } = await sb().from('call_rooms').select('*, owner:profiles!call_rooms_owner_id_fkey(id, display_name, avatar_url)').eq('id', roomId).maybeSingle();
    return data as CallRoom | null;
  }
  async joinRoom(roomId: string, opts: { userId?: string | null; displayName: string }) {
    const room = await this.getRoom(roomId);
    if (!room) return { error: 'Комната не найдена' };
    if (room.status === 'ended') return { error: 'Звонок уже завершён' };
    const parts = await this.listParticipants(roomId);
    const alive = parts.filter((p) => Date.now() - new Date(p.last_active).getTime() < 90_000);
    if (alive.length >= room.max_participants) return { error: 'В комнате достигнут максимум участников' };
    const { data, error } = await sb()
      .from('room_participants')
      .insert({ room_id: roomId, user_id: opts.userId ?? null, display_name: opts.displayName, is_host: opts.userId === room.owner_id })
      .select('*')
      .single();
    if (error) return { error: error.message };
    await sb().from('call_rooms').update({ status: 'active', updated_at: new Date().toISOString() }).eq('id', roomId);
    return { participant: data as RoomParticipant };
  }
  async leaveRoom(roomId: string, participantId: string) {
    await sb().from('room_participants').delete().eq('id', participantId).eq('room_id', roomId);
  }
  async heartbeat(roomId: string, participantId: string) {
    await sb().from('room_participants').update({ last_active: new Date().toISOString() }).eq('id', participantId).eq('room_id', roomId);
  }
  async listParticipants(roomId: string) {
    const { data } = await sb()
      .from('room_participants')
      .select('*, user:profiles!room_participants_user_id_fkey(id, display_name, avatar_url)')
      .eq('room_id', roomId);
    return (data ?? []) as RoomParticipant[];
  }
  async endRoom(roomId: string) {
    await sb().from('call_rooms').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', roomId);
    await sb().from('room_participants').delete().eq('room_id', roomId);
  }
  subscribeRoom(roomId: string, cb: () => void) {
    const ch = sb()
      .channel(`room:${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_participants', filter: `room_id=eq.${roomId}` }, cb)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'call_rooms', filter: `id=eq.${roomId}` }, cb)
      .subscribe();
    return () => {
      sb().removeChannel(ch);
    };
  }

  async sendSignal(roomId: string, from: string, to: string | null, payload: SignalMessage['payload']) {
    await sb().from('call_signals').insert({ room_id: roomId, sender_peer: from, target_peer: to, payload });
  }
  async getSignalsSince(roomId: string, sinceId: number) {
    const { data } = await sb().from('call_signals').select('*').eq('room_id', roomId).gt('id', sinceId).order('id').limit(200);
    return (data ?? []) as SignalMessage[];
  }
  subscribeSignals(roomId: string, selfPeer: string, cb: (s: SignalMessage) => void) {
    const ch = sb()
      .channel(`signals:${roomId}:${selfPeer}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_signals', filter: `room_id=eq.${roomId}` }, (p) => {
        const s = p.new as SignalMessage;
        if (s.sender_peer !== selfPeer && (s.target_peer === null || s.target_peer === selfPeer)) cb(s);
      })
      .subscribe();
    return () => {
      sb().removeChannel(ch);
    };
  }
}

function translateAuthError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Неверный e-mail или пароль';
  if (m.includes('already registered') || m.includes('already exists')) return 'Пользователь с таким e-mail уже зарегистрирован';
  if (m.includes('confirm')) return 'Подтвердите e-mail: мы отправили ссылку на вашу почту';
  if (m.includes('rate limit')) return 'Слишком много попыток, попробуйте позже';
  return msg;
}
function translateStorageError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('exceeds maximum allowed size')) return 'Файл больше допустимого размера (15 МБ)';
  return msg;
}

/* ============================ MOCK ============================ */

const mock = new MockBackend(bc);

/* ============================ EXPORT ============================ */

export const backend: BackendApi = isSupabaseConfigured ? new SupabaseBackend() : mock;
