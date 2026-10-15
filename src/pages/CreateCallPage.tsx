import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, AudioLines, Video, Copy, Share2, Check, Link2, Users } from 'lucide-react';
import { backend } from '../lib/backend';
import { useAuth } from '../hooks/useAuth';
import { APP_CONFIG, buildInviteLink } from '../config';
import { copyToClipboard, nativeShare } from '../utils/format';

export default function CreateCallPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'video' | 'audio'>('video');
  const [title, setTitle] = useState(`${profile?.display_name ?? 'Я'} — звонок`);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ roomId: string; link: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  async function create() {
    setBusy(true);
    setError('');
    try {
      const me = await backend.getSessionUserId();
      if (!me) {
        setError('Сначала войдите в аккаунт — ссылка создаётся от вашего имени.');
        setBusy(false);
        return;
      }
      const room = await backend.createRoom(me, title.trim() || 'Звонок', mode);
      setCreated({ roomId: room.id, link: buildInviteLink(room.id) });
    } catch (e) {
      setError((e as Error).message || 'Не удалось создать комнату');
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-100 p-4 dark:bg-slate-950">
        <div className="card w-full max-w-md animate-slide-up p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="rounded-2xl bg-primary-50 p-3 text-primary-600 dark:bg-primary-950/60 dark:text-primary-400">
              {mode === 'video' ? <Video className="h-6 w-6" /> : <AudioLines className="h-6 w-6" />}
            </div>
            <div>
              <h1 className="text-lg font-bold">Комната создана</h1>
              <p className="text-xs text-slate-500">Максимум {APP_CONFIG.maxRoomParticipants} участников · P2P mesh</p>
            </div>
          </div>

          <label htmlFor="inv" className="mb-1 block text-sm font-medium">Ссылка-приглашение</label>
          <input id="inv" readOnly value={created.link} className="input mb-3 font-mono text-xs" onFocus={(e) => e.target.select()} />

          <div className="mb-4 grid grid-cols-2 gap-2">
            <button className="btn-secondary" onClick={() => void copyToClipboard(created.link).then(setCopied)}>
              {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />} {copied ? 'Скопировано' : 'Скопировать ссылку'}
            </button>
            <button className="btn-secondary" onClick={() => void nativeShare(APP_CONFIG.name, `Приглашаю в звонок «${title}»`, created.link)}>
              <Share2 className="h-4 w-4" /> Поделиться
            </button>
          </div>

          <button className="btn-primary w-full" disabled={busy} onClick={() => navigate(`/room/${created.roomId}`)}>
            <Users className="h-4 w-4" /> Войти в комнату
          </button>
          <button className="btn-ghost mt-2 w-full" onClick={() => navigate('/')}>Отмена</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-slate-100 dark:bg-slate-950">
      <header className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-3 pt-safe dark:border-slate-800 dark:bg-slate-900">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label="Назад"><ArrowLeft className="h-5 w-5" /></button>
        <h1 className="text-base font-semibold">Создать звонок по ссылке</h1>
      </header>

      <div className="mx-auto w-full max-w-md flex-1 p-4">
        <div className="card space-y-5 p-5 animate-slide-up">
          <div>
            <label htmlFor="ctitle" className="mb-1 block text-sm font-medium">Название звонка</label>
            <input id="ctitle" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} />
          </div>

          <div role="radiogroup" aria-label="Тип звонка" className="grid grid-cols-2 gap-3">
            {([['video', 'Видеозвонок', Video], ['audio', 'Аудиозвонок', AudioLines]] as const).map(([m, label, Icon]) => (
              <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={`flex flex-col items-center gap-2 rounded-2xl border-2 p-5 transition-colors ${mode === m ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-950/50 dark:text-primary-300' : 'border-slate-200 text-slate-500 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'}`}>
                <Icon className="h-7 w-7" aria-hidden />
                <span className="text-sm font-medium">{label}</span>
              </button>
            ))}
          </div>

          <p className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-800/60">
            <Link2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Участники откроют ссылку на любом устройстве и подключятся без регистрации. Ссылка не содержит секретов — только случайный идентификатор комнаты.
          </p>

          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-300" role="alert">{error}</p>}

          <button className="btn-primary w-full !py-3" onClick={() => void create()} disabled={busy}>
            {busy ? 'Создание…' : 'Создать и получить ссылку'}
          </button>
        </div>
      </div>
    </div>
  );
}
