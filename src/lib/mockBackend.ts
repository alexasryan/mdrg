/**
 * MockBackend — демо-режим без сервера (localStorage + BroadcastChannel).
 * Позволяет полностью оценить интерфейс и даже провести WebRTC-звонки между
 * двумя вкладками одного браузера (сигнализация идёт через BroadcastChannel).
 * НЕ использовать в продакшене с реальными пользователями.
 */
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
import type { BackendApi } from './backend';

const LS = {
  users: 'nexus-demo-users', // {email, passwordHash, id}[]
  profiles: 'nexus-demo-profiles', // Record<id, Profile>
  chats: 'nexus-demo-chats',
  participants: 'nexus-demo-chat-participants',
  messages: 'nexus-demo-messages',
  calls: 'nexus-demo-calls',
  rooms: 'nexus-demo-rooms',
  roomParts: 'nexus-demo-room-parts',
  session: 'nexus-demo-session',
};

function load<T>(key: string, def: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '') as T;
  } catch {
    return def;
  }
}
function save(key: string, v: unknown) {
  localStorage.setItem(key, JSON.stringify(v));
}
const uid = () => crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);

/** простой необратимый хеш для демо (НЕ для продакшена — там Supabase Auth) */
async function hashPassword(pw: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('nexus-demo:' + pw));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

type BcSender = () => BroadcastChannel | null;

export class MockBackend implements BackendApi {
  private bc: BcSender;
  private listeners = new Map<string, Set<(data: unknown) => void>>();

  constructor(bc: BcSender) {
    this.bc = bc;
    const chan = this.bc();
    if (chan) {
      chan.onmessage = (ev) => {
        const { t, key } = ev.data ?? {};
        if (t === 'store-update') {
          this.listeners.get(key)?.forEach((cb) => cb(ev.data));
        }
      };
    }
    this.seed();
  }

  private seed() {
    if (load(LS.profiles, {} as Record<string, Profile>) && Object.keys(load(LS.profiles, {})).length) return;
    const now = new Date().toISOString();
    const p1: Profile = { id: uid(), display_name: 'Анна Смирнова', username: 'anna', avatar_url: null, status_text: 'Привет! Я использую Nexus', is_online: true, last_seen: now, created_at: now };
    const p2: Profile = { id: uid(), display_name: 'Иван Петров', username: 'ivan', avatar_url: null, status_text: '', is_online: false, last_seen: now, created_at: now };
    save(LS.profiles, { [p1.id]: p1, [p2.id]: p2 });
    const users = [
      { email: 'anna@demo.local', passwordHash: '', id: p1.id },
      { email: 'ivan@demo.local', passwordHash: '', id: p2.id },
    ];
    save(LS.users, users);
    // пароли демо-пользователей: demo1234 (хеш ставится асинхронно ниже)
    void hashPassword('demo1234').then((h) => {
      const us = load<typeof users>(LS.users, []);
      us.forEach((u) => (u.passwordHash = h));
      save(LS.users, us);
    });
  }

  private notify(key: string, extra?: Record<string, unknown>) {
    save(LS.session, this.currentUserId());
    this.bc()?.postMessage({ t: 'store-update', key, ...extra });
  }

  private currentUserId(): string | null {
    return load<string | null>(LS.session, null);
  }

  // ---------- auth ----------
  async getSessionUserId() {
    return this.currentUserId();
  }
  async getProfile(userId: string) {
    return load<Record<string, Profile>>(LS.profiles, {})[userId] ?? null;
  }
  async signUp(email: string, password: string, displayName: string, username: string) {
    const users = load<{ email: string; passwordHash: string; id: string }[]>(LS.users, []);
    if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      return { error: 'Пользователь с таким e-mail уже зарегистрирован', needsConfirmation: false };
    }
    const profiles = load<Record<string, Profile>>(LS.profiles, {});
    if (Object.values(profiles).some((p) => p.username === username)) {
      return { error: 'Логин уже занят', needsConfirmation: false };
    }
    const id = uid();
    profiles[id] = {
      id,
      display_name: displayName,
      username,
      avatar_url: null,
      status_text: '',
      is_online: true,
      last_seen: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    users.push({ email: email.toLowerCase(), passwordHash: await hashPassword(password), id });
    save(LS.profiles, profiles);
    save(LS.users, users);
    save(LS.session, id);
    this.notify('auth');
    return { needsConfirmation: false };
  }
  async signIn(email: string, password: string) {
    const users = load<{ email: string; passwordHash: string; id: string }[]>(LS.users, []);
    const u = users.find((x) => x.email === email.toLowerCase());
    const h = await hashPassword(password);
    if (!u || u.passwordHash !== h) return { error: 'Неверный e-mail или пароль' };
    save(LS.session, u.id);
    const profiles = load<Record<string, Profile>>(LS.profiles, {});
    if (profiles[u.id]) {
      profiles[u.id].is_online = true;
      save(LS.profiles, profiles);
    }
    this.notify('auth');
    return {};
  }
  async signOut() {
    const id = this.currentUserId();
    if (id) await this.setPresence(id, false);
    save(LS.session, null);
    this.notify('auth');
  }
  async resetPassword(_email: string) {
    return { error: 'В демо-режиме восстановление пароля недоступно. Настройте Supabase Auth.' };
  }
  onAuthChange(cb: (userId: string | null) => void) {
    const set = this.listeners.get('auth') ?? new Set();
    const fn = () => cb(this.currentUserId());
    set.add(fn);
    this.listeners.set('auth', set);
    return () => set.delete(fn);
  }

  // ---------- profiles ----------
  async searchUsers(q: string, excludeId?: string) {
    const all = Object.values(load<Record<string, Profile>>(LS.profiles, {}));
    const s = q.trim().toLowerCase();
    return all.filter((p) => p.id !== excludeId && (!s || p.display_name.toLowerCase().includes(s) || p.username.toLowerCase().includes(s))).slice(0, 20);
  }
  async updateProfile(userId: string, patch: Partial<Pick<Profile, 'display_name' | 'status_text'>>) {
    const profiles = load<Record<string, Profile>>(LS.profiles, {});
    if (!profiles[userId]) return { error: 'Профиль не найден' };
    profiles[userId] = { ...profiles[userId], ...patch };
    save(LS.profiles, profiles);
    this.notify('profiles');
    return {};
  }
  async uploadAvatar(userId: string, file: File) {
    const url = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = () => rej(new Error('read fail'));
      r.readAsDataURL(file);
    });
    const profiles = load<Record<string, Profile>>(LS.profiles, {});
    if (profiles[userId]) {
      profiles[userId].avatar_url = url;
      save(LS.profiles, profiles);
      this.notify('profiles');
      return { url };
    }
    return { error: 'Профиль не найден' };
  }
  async setPresence(userId: string, online: boolean) {
    const profiles = load<Record<string, Profile>>(LS.profiles, {});
    if (profiles[userId]) {
      profiles[userId].is_online = online;
      profiles[userId].last_seen = new Date().toISOString();
      save(LS.profiles, profiles);
      this.notify('profiles');
    }
  }

  // ---------- chats & messages ----------
  async getChats(userId: string) {
    const chats = load<Chat[]>(LS.chats, []);
    const parts = load<{ chat_id: string; user_id: string }[]>(LS.participants, []);
    const profiles = load<Record<string, Profile>>(LS.profiles, {});
    const messages = load<Message[]>(LS.messages, []);
    const myChatIds = parts.filter((p) => p.user_id === userId).map((p) => p.chat_id);
    return chats
      .filter((c) => myChatIds.includes(c.id))
      .map((c) => ({
        ...c,
        participants: parts
          .filter((p) => p.chat_id === c.id)
          .map((p) => ({ user_id: p.user_id, profile: profiles[p.user_id] ? { id: p.user_id, display_name: profiles[p.user_id].display_name, username: profiles[p.user_id].username, avatar_url: profiles[p.user_id].avatar_url, is_online: profiles[p.user_id].is_online } : null })),
        last_message: messages.filter((m) => m.chat_id === c.id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null,
      }))
      .sort((a, b) => (b.last_message?.created_at ?? b.created_at).localeCompare(a.last_message?.created_at ?? a.created_at));
  }
  async createDirectChat(me: string, peerId: string) {
    const chats = load<Chat[]>(LS.chats, []);
    const parts = load<{ chat_id: string; user_id: string }[]>(LS.participants, []);
    const existing = chats.find((c) => {
      const ids = parts.filter((p) => p.chat_id === c.id).map((p) => p.user_id).sort();
      return ids.join() === [me, peerId].sort().join();
    });
    if (existing) return existing;
    const chat: Chat = { id: uid(), type: 'direct', created_by: me, title: null, created_at: new Date().toISOString() };
    chats.push(chat);
    parts.push({ chat_id: chat.id, user_id: me }, { chat_id: chat.id, user_id: peerId });
    save(LS.chats, chats);
    save(LS.participants, parts);
    this.notify('chats');
    return chat;
  }
  async getMessages(chatId: string, before?: string) {
    const all = load<Message[]>(LS.messages, []).filter((m) => m.chat_id === chatId);
    let list = all.sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (before) list = list.filter((m) => m.created_at < before);
    return list.slice(-50);
  }
  async sendMessage(chatId: string, senderId: string, content: string, replyTo: string | null, attachment: Attachment | null) {
    const messages = load<Message[]>(LS.messages, []);
    const profiles = load<Record<string, Profile>>(LS.profiles, {});
    const m: Message = {
      id: uid(),
      chat_id: chatId,
      sender_id: senderId,
      content,
      reply_to: replyTo,
      attachment,
      type: 'text',
      read_by: [senderId],
      created_at: new Date().toISOString(),
      sender: { id: senderId, display_name: profiles[senderId]?.display_name ?? '?', avatar_url: profiles[senderId]?.avatar_url ?? null },
      reply_to_message: replyTo ? messages.find((x) => x.id === replyTo) ?? null : null,
    };
    messages.push(m);
    save(LS.messages, messages);
    this.notify('chat:' + chatId, { message: m });
    this.notify('chats');
    return m;
  }
  async deleteMessage(messageId: string, userId: string) {
    let messages = load<Message[]>(LS.messages, []);
    const m = messages.find((x) => x.id === messageId);
    if (!m) return { error: 'Сообщение не найдено' };
    if (m.sender_id !== userId) return { error: 'Можно удалять только свои сообщения' };
    messages = messages.filter((x) => x.id !== messageId);
    save(LS.messages, messages);
    this.notify('chat:' + m.chat_id, { deleted: messageId });
    return {};
  }
  async markRead(chatId: string, userId: string) {
    const messages = load<Message[]>(LS.messages, []);
    let changed = false;
    for (const m of messages) {
      if (m.chat_id === chatId && m.sender_id !== userId && !m.read_by.includes(userId)) {
        m.read_by.push(userId);
        changed = true;
      }
    }
    if (changed) {
      save(LS.messages, messages);
      this.notify('chat:' + chatId, { read: true });
    }
  }
  subscribeChat(chatId: string, cb: (m: Message) => void) {
    const set = this.listeners.get('chat:' + chatId) ?? new Set();
    const fn = (data: unknown) => {
      const d = data as { message?: Message };
      if (d.message) cb(d.message);
    };
    set.add(fn);
    this.listeners.set('chat:' + chatId, set);
    return () => set.delete(fn);
  }
  subscribeChats(_userId: string, cb: () => void) {
    const set = this.listeners.get('chats') ?? new Set();
    const fn = () => cb();
    set.add(fn);
    this.listeners.set('chats', set);
    return () => set.delete(fn);
  }

  async uploadChatFile(_chatId: string, _senderId: string, file: File, onProgress?: (p: number) => void) {
    if (file.size > 15 * 1024 * 1024) return { error: 'Файл больше 15 МБ (демо-лимит)' };
    const url = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      let last = 0;
      r.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          if (pct !== last) {
            last = pct;
            onProgress?.(pct);
          }
        }
      };
      r.onload = () => res(r.result as string);
      r.onerror = () => rej(new Error('Ошибка чтения файла'));
      r.readAsDataURL(file);
    });
    onProgress?.(100);
    return {
      name: file.name,
      url,
      storage_path: 'demo/' + file.name,
      size: file.size,
      mime: file.type,
      kind: file.type.startsWith('image/') ? ('image' as const) : ('file' as const),
    };
  }

  // ---------- calls ----------
  async startCall(callerId: string, calleeId: string, chatId: string, mode: CallMode) {
    const calls = load<Call[]>(LS.calls, []);
    const busy = calls.find((c) => c.callee_id === calleeId && (c.status === 'ringing' || c.status === 'accepted'));
    const call: Call = {
      id: uid(),
      chat_id: chatId,
      room_id: null,
      caller_id: callerId,
      callee_id: calleeId,
      mode,
      status: busy ? 'failed' : 'ringing',
      created_at: new Date().toISOString(),
      ended_at: busy ? new Date().toISOString() : null,
    };
    calls.push(call);
    save(LS.calls, calls);
    if (!busy) {
      this.notify('call-events:' + calleeId, {
        event: { id: Date.now(), callee_id: calleeId, caller_user_id: callerId, call_id: call.id, mode, created_at: call.created_at },
      } as unknown as Record<string, unknown>);
    }
    setTimeout(() => {
      const cs = load<Call[]>(LS.calls, []);
      const c = cs.find((x) => x.id === call.id);
      if (c && c.status === 'ringing') {
        c.status = 'missed';
        c.ended_at = new Date().toISOString();
        save(LS.calls, cs);
        this.notify('calls:' + calleeId, { call: c });
      }
    }, 45_000);
    return call;
  }
  async getCall(callId: string) {
    return load<Call[]>(LS.calls, []).find((c) => c.id === callId) ?? null;
  }
  async acceptCall(callId: string) {
    const calls = load<Call[]>(LS.calls, []);
    const c = calls.find((x) => x.id === callId);
    if (!c) return { error: 'Звонок не найден' };
    if (c.status !== 'ringing') return { error: 'Звонок уже завершён' };
    c.status = 'accepted';
    save(LS.calls, calls);
    this.notify('calls:' + c.caller_id, { call: c });
    return {};
  }
  async declineCall(callId: string) {
    const calls = load<Call[]>(LS.calls, []);
    const c = calls.find((x) => x.id === callId);
    if (c) {
      c.status = 'declined';
      c.ended_at = new Date().toISOString();
      save(LS.calls, calls);
      this.notify('calls:' + c.caller_id, { call: c });
    }
  }
  async endCall(callId: string) {
    const calls = load<Call[]>(LS.calls, []);
    const c = calls.find((x) => x.id === callId);
    if (c) {
      c.status = 'ended';
      c.ended_at = new Date().toISOString();
      save(LS.calls, calls);
      this.notify('calls:' + c.caller_id, { call: c });
      this.notify('calls:' + c.callee_id, { call: c });
    }
  }
  async listCalls(userId: string) {
    const profiles = load<Record<string, Profile>>(LS.profiles, {});
    return load<Call[]>(LS.calls, [])
      .filter((c) => c.caller_id === userId || c.callee_id === userId)
      .map((c) => ({
        ...c,
        caller: profiles[c.caller_id] ? { id: c.caller_id, display_name: profiles[c.caller_id].display_name, avatar_url: profiles[c.caller_id].avatar_url } : null,
        callee: profiles[c.callee_id ?? ''] ? { id: c.callee_id!, display_name: profiles[c.callee_id!].display_name, avatar_url: profiles[c.callee_id!].avatar_url } : null,
      }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 50);
  }
  subscribeIncomingCall(userId: string, cb: (e: IncomingCallEvent) => void) {
    const set = this.listeners.get('call-events:' + userId) ?? new Set();
    const fn = (data: unknown) => {
      const d = data as { event?: IncomingCallEvent };
      if (d.event) {
        const profiles = load<Record<string, Profile>>(LS.profiles, {});
        const p = profiles[d.event.caller_user_id];
        cb({ ...d.event, caller: p ? { id: p.id, display_name: p.display_name, avatar_url: p.avatar_url } : null });
      }
    };
    set.add(fn);
    this.listeners.set('call-events:' + userId, set);
    return () => set.delete(fn);
  }
  subscribeCallUpdates(userId: string, cb: (c: Call) => void) {
    const set = this.listeners.get('calls:' + userId) ?? new Set();
    const fn = (data: unknown) => {
      const d = data as { call?: Call };
      if (d.call) cb(d.call);
    };
    set.add(fn);
    this.listeners.set('calls:' + userId, set);
    return () => set.delete(fn);
  }

  // ---------- rooms ----------
  async createRoom(ownerId: string, title: string, mode: CallMode) {
    const rooms = load<CallRoom[]>(LS.rooms, []);
    const room: CallRoom = {
      id: uid(),
      owner_id: ownerId,
      title,
      mode,
      status: 'waiting',
      max_participants: 4,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ended_at: null,
    };
    rooms.push(room);
    save(LS.rooms, rooms);
    return room;
  }
  async getRoom(roomId: string) {
    const rooms = load<CallRoom[]>(LS.rooms, []);
    const profiles = load<Record<string, Profile>>(LS.profiles, {});
    const r = rooms.find((x) => x.id === roomId) ?? null;
    if (r) {
      const o = profiles[r.owner_id];
      return { ...r, owner: o ? { id: o.id, display_name: o.display_name, avatar_url: o.avatar_url } : null };
    }
    return null;
  }
  async joinRoom(roomId: string, opts: { userId?: string | null; displayName: string }) {
    const room = await this.getRoom(roomId);
    if (!room) return { error: 'Комната не найдена' };
    if (room.status === 'ended') return { error: 'Звонок уже завершён' };
    const parts = load<RoomParticipant[]>(LS.roomParts, []);
    const alive = parts.filter((p) => p.room_id === roomId && Date.now() - new Date(p.last_active).getTime() < 90_000);
    if (alive.length >= room.max_participants) return { error: 'В комнате достигнут максимум участников' };
    const participant: RoomParticipant = {
      id: uid(),
      room_id: roomId,
      user_id: opts.userId ?? null,
      display_name: opts.displayName,
      joined_at: new Date().toISOString(),
      last_active: new Date().toISOString(),
      is_host: opts.userId === room.owner_id,
    };
    parts.push(participant);
    save(LS.roomParts, parts);
    this.updateRoomStatus(roomId, 'active');
    this.notify('room:' + roomId);
    return { participant };
  }
  private updateRoomStatus(roomId: string, status: CallRoom['status']) {
    const rooms = load<CallRoom[]>(LS.rooms, []);
    const r = rooms.find((x) => x.id === roomId);
    if (r) {
      r.status = status;
      r.updated_at = new Date().toISOString();
      save(LS.rooms, rooms);
    }
  }
  async leaveRoom(roomId: string, participantId: string) {
    let parts = load<RoomParticipant[]>(LS.roomParts, []);
    parts = parts.filter((p) => p.id !== participantId);
    save(LS.roomParts, parts);
    const remaining = parts.filter((p) => p.room_id === roomId && Date.now() - new Date(p.last_active).getTime() < 90_000);
    if (!remaining.length) this.updateRoomStatus(roomId, 'ended');
    this.notify('room:' + roomId);
  }
  async heartbeat(roomId: string, participantId: string) {
    const parts = load<RoomParticipant[]>(LS.roomParts, []);
    const p = parts.find((x) => x.id === participantId);
    if (p) {
      p.last_active = new Date().toISOString();
      save(LS.roomParts, parts);
      this.notify('room:' + roomId);
    }
    void roomId;
  }
  async listParticipants(roomId: string) {
    const profiles = load<Record<string, Profile>>(LS.profiles, {});
    return load<RoomParticipant[]>(LS.roomParts, [])
      .filter((p) => p.room_id === roomId && Date.now() - new Date(p.last_active).getTime() < 90_000)
      .map((p) => ({
        ...p,
        user: p.user_id && profiles[p.user_id] ? { id: p.user_id, display_name: profiles[p.user_id].display_name, avatar_url: profiles[p.user_id].avatar_url } : null,
      }));
  }
  async endRoom(roomId: string) {
    this.updateRoomStatus(roomId, 'ended');
    let parts = load<RoomParticipant[]>(LS.roomParts, []);
    parts = parts.filter((p) => p.room_id !== roomId);
    save(LS.roomParts, parts);
    this.notify('room:' + roomId);
  }
  subscribeRoom(roomId: string, cb: () => void) {
    const set = this.listeners.get('room:' + roomId) ?? new Set();
    set.add(cb);
    this.listeners.set('room:' + roomId, set);
    return () => set.delete(cb);
  }

  // ---------- signaling ----------
  private signalSeq: Record<string, number> = load('nexus-demo-signal-seq', {});
  async sendSignal(roomId: string, from: string, to: string | null, payload: SignalMessage['payload']) {
    const key = 'nexus-demo-signals-' + roomId;
    const list = load<SignalMessage[]>(key, []);
    const id = (this.signalSeq[roomId] ?? Date.now()) + 1;
    this.signalSeq[roomId] = id;
    save('nexus-demo-signal-seq', this.signalSeq);
    const msg: SignalMessage = { id, room_id: roomId, sender_peer: from, target_peer: to, payload, created_at: new Date().toISOString() };
    list.push(msg);
    save(key, list.slice(-500));
    this.notify('signals:' + roomId, { signal: msg });
  }
  async getSignalsSince(roomId: string, sinceId: number) {
    return load<SignalMessage[]>('nexus-demo-signals-' + roomId, []).filter((s) => s.id > sinceId).slice(0, 200);
  }
  subscribeSignals(roomId: string, selfPeer: string, cb: (s: SignalMessage) => void) {
    const set = this.listeners.get('signals:' + roomId) ?? new Set();
    const fn = (data: unknown) => {
      const d = data as { signal?: SignalMessage };
      if (d.signal && d.signal.sender_peer !== selfPeer && (d.signal.target_peer === null || d.signal.target_peer === selfPeer)) {
        cb(d.signal);
      }
    };
    set.add(fn);
    this.listeners.set('signals:' + roomId, set);
    return () => set.delete(fn);
  }
}
