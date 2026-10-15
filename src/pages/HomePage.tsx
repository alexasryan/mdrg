import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Phone, Search, Settings, LogOut, Plus, Users, Video, WifiOff, Loader2, CheckCheck, Check, Copy, Trash2, Reply, Smile, Paperclip, Send, X, FileText, Image as ImageIcon, PhoneCall, PhoneMissed, PhoneIncoming, PhoneOutgoing } from 'lucide-react';
import { backend } from '../lib/backend';
import { useAuth } from '../hooks/useAuth';
import { useSettings, showNotification } from '../hooks/useSettings';
import { Avatar, EmptyState, Modal, Skeleton, Spinner } from '../components/ui';
import { EmojiPicker } from '../components/EmojiPicker';
import type { Chat, Message, Profile, Call } from '../types';
import { formatDateLabel, formatTime, timeAgo, formatBytes, copyToClipboard } from '../utils/format';
import { APP_CONFIG } from '../config';

type Tab = 'chats' | 'people' | 'calls';

export default function HomePage() {
  const { user, profile, signOut, demoMode } = useAuth();
  const navigate = useNavigate();
  const userId = user!.id;

  const [tab, setTab] = useState<Tab>('chats');
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [onlineTick, setOnlineTick] = useState(0);
  const [searchQ, setSearchQ] = useState('');
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [people, setPeople] = useState<Profile[] | null>(null);
  const [calls, setCalls] = useState<Call[] | null>(null);
  const [toast, setToast] = useState('');
  const [offline, setOffline] = useState(!navigator.onLine);

  // выбранный чат (desktop) / мобильный экран чата
  const params = useParams();
  const openChatId = params.chatId;

  const loadChats = useCallback(async () => {
    const c = await backend.getChats(userId);
    setChats(c);
  }, [userId]);

  useEffect(() => {
    void loadChats();
    const unsub = backend.subscribeChats(userId, () => void loadChats());
    const t = setInterval(() => setOnlineTick((x) => x + 1), 30_000);
    return () => {
      unsub();
      clearInterval(t);
    };
  }, [loadChats, userId]);

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    if (tab === 'people') {
      const id = setTimeout(async () => {
        setPeople(null);
        setPeople(await backend.searchUsers(searchQ, userId));
      }, searchQ ? 300 : 0);
      return () => clearTimeout(id);
    }
    if (tab === 'calls') void backend.listCalls(userId).then(setCalls);
  }, [tab, searchQ, userId]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  };

  async function startChat(peer: Profile) {
    setNewChatOpen(false);
    try {
      const chat = await backend.createDirectChat(userId, peer.id);
      await loadChats();
      navigate(`/chat/${chat.id}`);
    } catch (e) {
      showToast('Не удалось создать чат: ' + (e as Error).message);
    }
  }

  const filteredChats = (chats ?? []).filter((c) => {
    if (!searchQ.trim()) return true;
    const name = chatTitle(c, userId);
    const last = c.last_message?.content ?? '';
    return name.toLowerCase().includes(searchQ.toLowerCase()) || last.toLowerCase().includes(searchQ.toLowerCase());
  });

  void onlineTick;

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* ===== Сайдбар ===== */}
      <aside className={`w-full shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 md:flex md:w-[340px] ${openChatId ? 'hidden' : 'flex'} pb-safe`}>
        <header className="flex items-center gap-2 px-4 py-3 pt-safe">
          <Avatar name={profile?.display_name ?? '?'} src={profile?.avatar_url} size={38} online />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{profile?.display_name ?? 'Профиль'}</p>
            <p className="truncate text-xs text-emerald-600">в сети{demoMode && ' · демо'}</p>
          </div>
          <button className="icon-btn" aria-label="Создать звонок по ссылке" onClick={() => navigate('/create-call')}>
            <Video className="h-5 w-5" />
          </button>
          <button className="icon-btn" aria-label="Новый чат" onClick={() => { setNewChatOpen(true); setTab('people'); }}>
            <Plus className="h-5 w-5" />
          </button>
          <button className="icon-btn" aria-label="Настройки" onClick={() => navigate('/settings')}>
            <Settings className="h-5 w-5" />
          </button>
        </header>

        <div className="px-4 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input className="input pl-9" placeholder="Поиск чатов и людей…" value={searchQ} onChange={(e) => setSearchQ(e.target.value)} aria-label="Поиск" />
          </div>
        </div>

        <nav className="grid grid-cols-3 gap-1 px-4 pb-2" role="tablist" aria-label="Разделы">
          {([['chats', 'Чаты'], ['people', 'Люди'], ['calls', 'Звонки']] as [Tab, string][]).map(([t, label]) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-lg py-2 text-sm font-medium transition-colors ${tab === t ? 'bg-primary-50 text-primary-700 dark:bg-primary-950/60 dark:text-primary-300' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
              {label}
            </button>
          ))}
        </nav>

        <div className="scroll-thin flex-1 overflow-y-auto px-2 pb-4">
          {offline && (
            <div className="mx-2 mb-2 flex items-center gap-2 rounded-xl bg-amber-100 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
              <WifiOff className="h-4 w-4 shrink-0" aria-hidden /> Нет соединения — сообщения будут отправлены после восстановления связи
            </div>
          )}
          {tab === 'chats' && <ChatsList chats={filteredChats} userId={userId} loading={chats === null} onOpen={(id) => navigate(`/chat/${id}`)} />}
          {tab === 'people' && <PeopleList people={people} onStart={startChat} />}
          {tab === 'calls' && <CallsList calls={calls} userId={userId} />}
        </div>

        <footer className="border-t border-slate-200 p-3 dark:border-slate-800">
          <button className="btn-ghost w-full justify-start !min-h-[40px]" onClick={() => { signOut(); navigate('/auth'); }}>
            <LogOut className="h-4 w-4" aria-hidden /> Выйти
          </button>
        </footer>
      </aside>

      {/* ===== Основная область ===== */}
      <main className={`min-w-0 flex-1 ${openChatId ? 'block' : 'hidden'} md:block`}>
        {openChatId ? (
          <ChatView key={openChatId} chatId={openChatId} me={userId} onBack={() => navigate('/')} onToast={showToast} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-slate-400">
            <div className="rounded-3xl bg-primary-50 p-6 text-primary-600 dark:bg-primary-950/50 dark:text-primary-400">
              <Users className="h-10 w-10" aria-hidden />
            </div>
            <p className="text-sm">Выберите чат или начните новую переписку</p>
            <button className="btn-primary" onClick={() => setNewChatOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden /> Новый чат
            </button>
          </div>
        )}
      </main>

      {/* модалка нового чата */}
      <Modal open={newChatOpen} onClose={() => setNewChatOpen(false)} title="Новый чат">
        <PeopleInlineSearch meId={userId} onStart={startChat} />
      </Modal>

      {toast && <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 animate-slide-up rounded-xl bg-slate-900 px-4 py-2.5 text-sm text-white shadow-lg dark:bg-white dark:text-slate-900" role="status">{toast}</div>}
    </div>
  );
}

export function chatTitle(chat: Chat, meId: string): string {
  const peer = chat.participants?.find((p) => p.user_id !== meId)?.profile;
  return peer?.display_name ?? chat.title ?? 'Чат';
}

function ChatsList({ chats, userId, loading, onOpen }: { chats: Chat[] | null; userId: string; loading: boolean; onOpen(id: string): void }) {
  if (loading) return <div className="space-y-2 p-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>;
  if (!chats?.length) return <EmptyState icon={<Users className="h-8 w-8" />} title="Пока нет чатов" hint="Найдите пользователя во вкладке «Люди» и начните переписку" />;
  return (
    <ul className="space-y-1">
      {chats.map((c) => {
        const title = chatTitle(c, userId);
        const unread = (c.last_message && c.last_message.sender_id !== userId && !(c.last_message.read_by ?? []).includes(userId)) || false;
        const peer = c.participants?.find((p) => p.user_id !== userId)?.profile;
        return (
          <li key={c.id}>
            <button onClick={() => onOpen(c.id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 ${unread ? 'bg-primary-50/60 dark:bg-primary-950/30' : ''}`} aria-label={`Открыть чат с ${title}`}>
              <Avatar name={title} src={peer?.avatar_url} size={44} online={peer?.is_online} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-sm font-semibold">{title}</p>
                  {c.last_message && <span className="shrink-0 text-[11px] text-slate-400">{formatTime(c.last_message.created_at)}</span>}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className={`truncate text-xs ${unread ? 'font-medium text-slate-700 dark:text-slate-200' : 'text-slate-500'}`}>{c.last_message?.attachment ? `${c.last_message.attachment.kind === 'image' ? '📷 Фото' : '📎 Файл'}` : c.last_message?.content ?? 'Нет сообщений'}</p>
                  {unread && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary-500" aria-label="Непрочитанные" />}
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function PeopleList({ people, onStart }: { people: Profile[] | null; onStart(p: Profile): void }) {
  if (people === null) return <div className="space-y-2 p-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14" />)}</div>;
  if (!people.length) return <EmptyState icon={<Search className="h-8 w-8" />} title="Никого не найдено" hint="Попробуйте другое имя или логин" />;
  return (
    <ul className="space-y-1">
      {people.map((p) => (
        <li key={p.id}>
          <button onClick={() => onStart(p)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800">
            <Avatar name={p.display_name} src={p.avatar_url} size={40} online={p.is_online} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{p.display_name}</p>
              <p className="truncate text-xs text-slate-500">@{p.username}{p.status_text ? ` · ${p.status_text}` : ''}</p>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function PeopleInlineSearch({ meId, onStart }: { meId: string; onStart(p: Profile): void }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Profile[] | null>(null);
  useEffect(() => {
    const id = setTimeout(async () => setRes(await backend.searchUsers(q, meId)), q ? 300 : 0);
    return () => clearTimeout(id);
  }, [q, meId]);
  return (
    <div>
      <input autoFocus className="input mb-3" placeholder="Имя или @логин…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск пользователей" />
      {res === null ? <Spinner className="mx-auto h-6 w-6 text-slate-400" /> : res.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">Никого не найдено</p> : <PeopleList people={res} onStart={onStart} />}
    </div>
  );
}

const callIcon = (c: Call, meId: string) => {
  if (c.caller_id !== meId) return c.status === 'missed' ? <PhoneMissed className="h-4 w-4 text-red-500" /> : <PhoneIncoming className="h-4 w-4 text-emerald-600" />;
  return <PhoneOutgoing className={`h-4 w-4 ${c.status === 'missed' || c.status === 'declined' || c.status === 'failed' ? 'text-red-500' : 'text-emerald-600'}`} />;
};
const callStatusText: Record<string, string> = { ringing: 'звоним…', accepted: 'в разговоре', declined: 'отклонён', missed: 'пропущен', ended: 'завершён', failed: 'не доступен (занят)' };

function CallsList({ calls, userId }: { calls: Call[] | null; userId: string }) {
  if (calls === null) return <div className="space-y-2 p-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14" />)}</div>;
  if (!calls.length) return <EmptyState icon={<PhoneCall className="h-8 w-8" />} title="Звонков пока не было" hint="Аудио- и видеозвонки доступны прямо из чата или по ссылке-приглашению" />;
  return (
    <ul className="space-y-1">
      {calls.map((c) => {
        const out = c.caller_id === userId;
        const peerName = out ? c.callee?.display_name ?? 'Пользователь' : c.caller?.display_name ?? 'Пользователь';
        return (
          <li key={c.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5">
            <Avatar name={peerName} src={(out ? c.callee?.avatar_url : c.caller?.avatar_url)} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{peerName}</p>
              <p className="text-xs text-slate-500">{timeAgo(c.created_at)} · {callStatusText[c.status] ?? c.status} · {c.mode === 'video' ? 'видео' : 'аудио'}</p>
            </div>
            {callIcon(c, userId)}
          </li>
        );
      })}
    </ul>
  );
}

/* ================= Чат ================= */

function ChatView({ chatId, me, onBack, onToast }: { chatId: string; me: string; onBack(): void; onToast(m: string): void }) {
  const navigate = useNavigate();
  const settings = useSettings();
  const [chat, setChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const reloadChat = async () => {
    const chats = await backend.getChats(me);
    setChat(chats.find((c) => c.id === chatId) ?? null);
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    void (async () => {
      await reloadChat();
      const msgs = await backend.getMessages(chatId);
      if (!mounted) return;
      setMessages(msgs);
      setHasMore(msgs.length >= APP_CONFIG.limits.pageSize);
      setLoading(false);
      void backend.markRead(chatId, me);
    })();
    const unsubMsg = backend.subscribeChat(chatId, (m) => {
      if (!mounted) return;
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      if (m.sender_id !== me) {
        void backend.markRead(chatId, me);
        if (document.visibilityState !== 'visible' && settings.notificationsEnabled) {
          showNotification(m.sender?.display_name ?? 'Новое сообщение', m.content || 'Вложение');
        }
      }
    });
    const unsubDel = subscribeDeletes(chatId, (id) => mounted && setMessages((p) => p.filter((m) => m.id !== id)));
    return () => {
      mounted = false;
      unsubMsg();
      unsubDel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, me]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: messages.length > 3 ? 'smooth' : 'auto' });
  }, [messages, loading]);

  async function loadOlder() {
    if (!messages.length) return;
    const older = await backend.getMessages(chatId, messages[0].created_at);
    if (older.length < APP_CONFIG.limits.pageSize) setHasMore(false);
    setMessages((p) => [...older.filter((o) => !p.some((x) => x.id === o.id)), ...p]);
  }

  async function send() {
    const content = text.trim();
    if ((!content && !replyTo) || sending) return;
    setSending(true);
    setText('');
    const replying = replyTo;
    setReplyTo(null);
    try {
      const m = await backend.sendMessage(chatId, me, content, replying?.id ?? null, null);
      setMessages((p) => [...p, m]);
    } catch (e) {
      onToast('Ошибка отправки: ' + (e as Error).message);
      setText(content);
    } finally {
      setSending(false);
      void reloadChat();
    }
  }

  async function attach(file: File) {
    if (file.size > APP_CONFIG.limits.maxFileSizeMb * 1024 * 1024) {
      onToast(`Файл больше ${APP_CONFIG.limits.maxFileSizeMb} МБ`);
      return;
    }
    setUploadProgress(0);
    const res = await backend.uploadChatFile(chatId, me, file, (p) => setUploadProgress(p));
    setUploadProgress(null);
    if ('error' in res) return onToast(res.error);
    try {
      const m = await backend.sendMessage(chatId, me, '', null, res);
      setMessages((p) => [...p, m]);
      void reloadChat();
    } catch (e) {
      onToast('Ошибка отправки файла: ' + (e as Error).message);
    }
  }

  async function removeMessage(id: string) {
    const res = await backend.deleteMessage(id, me);
    if (res.error) onToast(res.error);
    else setMessages((p) => p.filter((m) => m.id !== id));
  }

  async function startCall(mode: 'audio' | 'video') {
    const peer = chat?.participants?.find((p) => p.user_id !== me);
    if (!peer) return;
    try {
      const call = await backend.startCall(me, peer.user_id, chatId, mode);
      if (call.status === 'failed') return onToast('Пользователь занят, дождитесь завершения его звонка');
      sessionStorage.setItem('nexus-active-call', JSON.stringify({ callId: call.id, role: 'caller', mode, peer: { id: peer.user_id, display_name: peer.profile?.display_name ?? 'Собеседник', avatar_url: peer.profile?.avatar_url ?? null } }));
      navigate(`/room/call-${call.id}`);
    } catch (e) {
      onToast('Не удалось начать звонок: ' + (e as Error).message);
    }
  }

  const visible = historyQuery.trim()
    ? messages.filter((m) => m.content.toLowerCase().includes(historyQuery.toLowerCase()))
    : messages;

  const peerProfile = chat?.participants?.find((p) => p.user_id !== me)?.profile;

  return (
    <div className="flex h-full flex-col bg-slate-50 dark:bg-slate-950">
      {/* header */}
      <header className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 pt-safe dark:border-slate-800 dark:bg-slate-900">
        <button className="icon-btn md:hidden" onClick={onBack} aria-label="Назад к чатам"><ArrowLeft className="h-5 w-5" /></button>
        {chat ? (
          <>
            <Avatar name={chatTitle(chat, me)} src={peerProfile?.avatar_url} size={40} online={peerProfile?.is_online} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{chatTitle(chat, me)}</p>
              <p className="truncate text-xs text-slate-500">{peerProfile?.is_online ? <span className="text-emerald-600">в сети</span> : 'не в сети'}</p>
            </div>
            <button className="icon-btn" aria-label="Аудиозвонок" onClick={() => void startCall('audio')}><Phone className="h-5 w-5" /></button>
            <button className="icon-btn" aria-label="Видеозвонок" onClick={() => void startCall('video')}><Video className="h-5 w-5" /></button>
            <button className="icon-btn" aria-label="Поиск по переписке" onClick={() => setSearchOpen((s) => !s)}><Search className="h-5 w-5" /></button>
          </>
        ) : (
          <p className="flex-1 text-sm text-slate-500">Загрузка…</p>
        )}
      </header>

      {searchOpen && (
        <div className="border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900 animate-fade-in">
          <div className="flex items-center gap-2">
            <input autoFocus className="input !py-2" placeholder="Поиск по истории…" value={historyQuery} onChange={(e) => setHistoryQuery(e.target.value)} aria-label="Поиск по переписке" />
            <button className="icon-btn" onClick={() => { setSearchOpen(false); setHistoryQuery(''); }} aria-label="Закрыть поиск"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}

      {/* сообщения */}
      <div className="scroll-thin flex-1 overflow-y-auto px-3 py-4 sm:px-6">
        {loading ? (
          <div className="mx-auto max-w-2xl space-y-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className={`h-12 ${i % 2 ? 'ml-auto' : ''} w-2/3`} />)}</div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-1.5">
            {hasMore && messages.length > 0 && (
              <button className="mx-auto block rounded-lg px-3 py-1.5 text-xs text-primary-600 hover:bg-primary-50 dark:hover:bg-slate-800" onClick={() => void loadOlder()}>Загрузить историю ранее</button>
            )}
            {!visible.length && <EmptyState icon={<Users className="h-8 w-8" />} title={historyQuery ? 'Ничего не найдено' : 'Сообщений пока нет'} hint={historyQuery ? undefined : 'Напишите первое сообщение 👋'} />}
            {visible.map((m, idx) => {
              const prev = visible[idx - 1];
              const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
              return (
                <div key={m.id}>
                  {newDay && <div className="my-3 text-center"><span className="rounded-full bg-slate-200/80 px-3 py-1 text-[11px] text-slate-500 dark:bg-slate-800">{formatDateLabel(m.created_at)}</span></div>}
                  <MessageBubble m={m} me={me} onReply={() => setReplyTo(m)} onDelete={() => void removeMessage(m.id)} onCopy={() => { void copyToClipboard(m.content).then((ok) => ok && onToast('Скопировано')); }} />
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* индикатор загрузки файла */}
      {uploadProgress !== null && (
        <div className="mx-auto w-full max-w-2xl px-4 pb-1">
          <div className="flex items-center gap-3 rounded-xl bg-white p-2 text-xs shadow dark:bg-slate-800">
            <Loader2 className="h-4 w-4 animate-spin text-primary-500" aria-hidden /> Загрузка файла… {uploadProgress}%
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><div className="h-full bg-primary-500 transition-all" style={{ width: `${uploadProgress}%` }} /></div>
          </div>
        </div>
      )}

      {/* ответ */}
      {replyTo && (
        <div className="mx-auto w-full max-w-2xl px-4 pb-1">
          <div className="flex items-center gap-2 rounded-xl border-l-4 border-primary-500 bg-white p-2 text-xs shadow dark:bg-slate-800">
            <Reply className="h-4 w-4 text-primary-500" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-slate-500">Ответ: {replyTo.content || 'вложение'}</span>
            <button className="icon-btn !h-7 !w-7" onClick={() => setReplyTo(null)} aria-label="Отменить ответ"><X className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      )}

      {/* ввод */}
      <div className="relative border-t border-slate-200 bg-white px-3 py-2 pb-safe dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-2xl items-end gap-1.5">
          <EmojiPicker open={emojiOpen} onPick={(e) => { setText((t) => t + e); inputRef.current?.focus(); }} />
          <button className="icon-btn" aria-label="Эмодзи" onClick={() => setEmojiOpen((v) => !v)}><Smile className="h-5 w-5" /></button>
          <button className="icon-btn" aria-label="Прикрепить файл" onClick={() => fileRef.current?.click()}><Paperclip className="h-5 w-5" /></button>
          <input ref={fileRef} type="file" accept="image/*,*/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void attach(f); e.target.value = ''; }} />
          <textarea
            ref={inputRef}
            rows={1}
            className="input max-h-32 min-h-[44px] flex-1 resize-none !py-2.5"
            placeholder="Сообщение…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
            aria-label="Текст сообщения"
          />
          <button className="btn-primary !min-h-[44px] !w-11 !px-0" onClick={() => void send()} disabled={sending || !text.trim()} aria-label="Отправить">
            {sending ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

function subscribeDeletes(chatId: string, cb: (messageId: string) => void): () => void {
  // BroadcastChannel-события удаления (демо-режим). Для Supabase DELETE realtime-события
  // обрабатываются через общий канал ниже.
  let ch: BroadcastChannel | null = null;
  try {
    ch = new BroadcastChannel('nexus-realtime');
  } catch {
    return () => {};
  }
  const h = (ev: MessageEvent) => {
    const d = ev.data;
    if (d?.t === 'store-update' && d.key === 'chat:' + chatId && d.deleted) cb(d.deleted);
  };
  ch.addEventListener('message', h);
  return () => {
    ch?.removeEventListener('message', h);
    ch?.close();
  };
}

function MessageBubble({ m, me, onReply, onDelete, onCopy }: { m: Message; me: string; onReply(): void; onDelete(): void; onCopy(): void }) {
  const mine = m.sender_id === me;
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className={`group flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'}`}>
      {!mine && <Avatar name={m.sender?.display_name ?? '?'} src={m.sender?.avatar_url} size={28} className="mb-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />}
      <div className={`relative max-w-[85%] sm:max-w-[70%] ${mine ? 'msg-out' : 'msg-in'} px-3 py-2`}>
        {m.reply_to_message && (
          <div className={`mb-1 rounded-lg border-l-2 px-2 py-1 text-xs ${mine ? 'border-white/60 bg-white/15' : 'border-primary-500 bg-slate-100 dark:bg-slate-700/60'}`}>
            {m.reply_to_message.content || 'вложение'}
          </div>
        )}
        {m.attachment && (
          m.attachment.kind === 'image' ? (
            <a href={m.attachment.url} target="_blank" rel="noreferrer" className="mb-1 block">
              <img src={m.attachment.url} alt={m.attachment.name} className="max-h-64 rounded-xl object-cover" loading="lazy" />
            </a>
          ) : (
            <a href={m.attachment.url} download={m.attachment.name} className={`mb-1 flex items-center gap-2 rounded-xl px-2 py-1.5 text-xs underline-offset-2 hover:underline ${mine ? 'bg-white/15' : 'bg-slate-100 dark:bg-slate-700/60'}`}>
              {m.attachment.mime.startsWith('image/') ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
              <span className="max-w-[180px] truncate">{m.attachment.name}</span>
              <span className="opacity-60">{formatBytes(m.attachment.size)}</span>
            </a>
          )
        )}
        {m.content && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{m.content}</p>}
        <div className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] ${mine ? 'text-white/70' : 'text-slate-400'}`}>
          <span>{formatTime(m.created_at)}</span>
          {mine && (m.read_by?.length > 1 ? <CheckCheck className="h-3.5 w-3.5" aria-label="Прочитано" /> : <Check className="h-3.5 w-3.5" aria-label="Отправлено" />)}
        </div>
        <div className={`absolute top-1 ${mine ? '-left-9' : '-right-9'} hidden gap-0.5 group-hover:flex`}>
          <button className="icon-btn !h-7 !w-7" onClick={onReply} aria-label="Ответить"><Reply className="h-3.5 w-3.5" /></button>
          {m.content && <button className="icon-btn !h-7 !w-7" onClick={onCopy} aria-label="Копировать"><Copy className="h-3.5 w-3.5" /></button>}
          {mine && <button className="icon-btn !h-7 !w-7 hover:!text-red-500" onClick={() => setMenuOpen(true)} aria-label="Удалить"><Trash2 className="h-3.5 w-3.5" /></button>}
        </div>
        <Modal open={menuOpen} onClose={() => setMenuOpen(false)} title="Удалить сообщение?">
          <p className="mb-4 text-sm text-slate-500">Сообщение исчезнет у всех участников чата. Это действие необратимо.</p>
          <div className="flex gap-2">
            <button className="btn-secondary flex-1" onClick={() => setMenuOpen(false)}>Отмена</button>
            <button className="btn-danger flex-1" onClick={() => { setMenuOpen(false); onDelete(); }}>Удалить</button>
          </div>
        </Modal>
      </div>
    </div>
  );
}
