import { Phone, PhoneOff, Video } from 'lucide-react';
import { useCalls } from '../hooks/useCalls';
import { Avatar } from './ui';

export function IncomingCallBanner() {
  const { incoming, acceptIncoming, declineIncoming } = useCalls();
  if (!incoming) return null;
  return (
    <div className="fixed inset-x-3 top-3 z-[70] mx-auto max-w-md animate-slide-up sm:left-auto sm:right-4" role="alertdialog" aria-label="Входящий звонок">
      <div className="card flex items-center gap-3 border-none p-3 shadow-xl ring-1 ring-black/5 dark:ring-white/10">
        <div className="relative">
          <Avatar name={incoming.caller?.display_name ?? 'Звонок'} src={incoming.caller?.avatar_url} size={44} />
          <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900">
            {incoming.mode === 'video' ? <Video className="h-3 w-3 text-white" /> : <Phone className="h-3 w-3 text-white" />}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{incoming.caller?.display_name ?? 'Неизвестный'}</p>
          <p className="text-xs text-slate-500 animate-pulse">Входящий {incoming.mode === 'video' ? 'видеозвонок' : 'аудиозвонок'}…</p>
        </div>
        <button className="flex h-11 w-11 items-center justify-center rounded-full bg-red-500 text-white shadow hover:bg-red-600 active:scale-95" onClick={declineIncoming} aria-label="Отклонить звонок">
          <PhoneOff className="h-5 w-5" />
        </button>
        <button className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500 text-white shadow hover:bg-emerald-600 active:scale-95 animate-[pulseSoft_1.4s_ease-in-out_infinite]" onClick={acceptIncoming} aria-label="Принять звонок">
          <Phone className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
