import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { MockBackend } from './mockBackend';

function storage() {
  const entries = new Map<string, string>();
  return { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value), clear: () => entries.clear() };
}
beforeEach(() => {
  vi.stubGlobal('localStorage', storage());
  vi.stubGlobal('sessionStorage', storage());
});
afterEach(() => vi.unstubAllGlobals());

describe('demo backend', () => {
  it('initializes demo credentials before first sign-in and notifies the current tab', async () => {
    const backend = new MockBackend(() => null);
    const changed = vi.fn();
    backend.onAuthChange(changed);
    expect(await backend.signIn('anna@demo.local', 'demo1234')).toEqual({});
    expect(await backend.getSessionUserId()).toBeTruthy();
    expect(changed).toHaveBeenCalledOnce();
    await backend.signOut();
    expect(await backend.getSessionUserId()).toBeNull();
    expect(changed).toHaveBeenCalledTimes(2);
  });
  it('rejects an invalid password without creating a session', async () => {
    const backend = new MockBackend(() => null);
    expect((await backend.signIn('anna@demo.local', 'wrong')).error).toBeTruthy();
    expect(await backend.getSessionUserId()).toBeNull();
  });
  it('keeps account sessions out of the shared local store', async () => {
    const backend = new MockBackend(() => null);
    await backend.signIn('anna@demo.local', 'demo1234');
    expect(localStorage.getItem('nexus-demo-session')).toBeNull();
    expect(sessionStorage.getItem('nexus-demo-session')).toBeTruthy();
  });
  it('notifies message and chat subscribers in the same tab and refuses deleting another sender’s message', async () => {
    const backend = new MockBackend(() => null);
    await backend.signIn('anna@demo.local', 'demo1234');
    const me = (await backend.getSessionUserId())!;
    const peer = (await backend.searchUsers('ivan'))[0];
    const chat = await backend.createDirectChat(me, peer.id);
    const received = vi.fn();
    const changed = vi.fn();
    backend.subscribeChat(chat.id, received);
    backend.subscribeChats(me, changed);
    const message = await backend.sendMessage(chat.id, me, 'Привет', null, null);
    expect(received).toHaveBeenCalledWith(message);
    expect(changed).toHaveBeenCalledOnce();
    expect((await backend.deleteMessage(message.id, peer.id)).error).toBeTruthy();
    expect(await backend.getMessages(chat.id)).toHaveLength(1);
  });
  it('creates a joinable room for a direct call and enforces its capacity', async () => {
    const backend = new MockBackend(() => null);
    await backend.signIn('anna@demo.local', 'demo1234');
    const me = (await backend.getSessionUserId())!;
    const peer = (await backend.searchUsers('ivan'))[0];
    const chat = await backend.createDirectChat(me, peer.id);
    vi.useFakeTimers();
    try {
      const call = await backend.startCall(me, peer.id, chat.id, 'audio');
      expect(call.room_id).toBeTruthy();
      expect((await backend.joinRoom(call.room_id!, { userId: me, displayName: 'Анна' })).participant).toBeTruthy();
      expect((await backend.joinRoom(call.room_id!, { userId: peer.id, displayName: 'Иван' })).participant).toBeTruthy();
      expect((await backend.joinRoom(call.room_id!, { displayName: 'Третий' })).error).toBeTruthy();
    } finally { vi.useRealTimers(); }
  });
  it('allows retrying a room join after media permission failure removes membership', async () => {
    const backend = new MockBackend(() => null);
    await backend.signIn('anna@demo.local', 'demo1234');
    const room = await backend.createRoom((await backend.getSessionUserId())!, 'Проверка', 'video');
    const joined = await backend.joinRoom(room.id, { displayName: 'Гость' });
    await backend.leaveRoom(room.id, joined.participant!.id);
    expect((await backend.joinRoom(room.id, { displayName: 'Гость' })).participant).toBeTruthy();
    expect(await backend.listParticipants(room.id)).toHaveLength(1);
  });
});
