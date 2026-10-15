import type { ReactNode } from 'react';
import { initials, colorFromString } from '../utils/format';

interface Props {
  name: string;
  src?: string | null;
  size?: number;
  online?: boolean;
  className?: string;
}

export function Avatar({ name, src, size = 40, online, className = '' }: Props) {
  const style: React.CSSProperties = { width: size, height: size };
  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }} aria-hidden={!src && !online ? undefined : true}>
      {src ? (
        <img src={src} alt={name} style={style} className="rounded-full object-cover" loading="lazy" />
      ) : (
        <div
          style={{ ...style, backgroundColor: colorFromString(name), fontSize: size * 0.38 }}
          className="flex items-center justify-center rounded-full font-semibold text-white select-none"
        >
          {initials(name)}
        </div>
      )}
      {online !== undefined && (
        <span
          className={`absolute bottom-0 right-0 block rounded-full ring-2 ring-white dark:ring-slate-900 ${online ? 'bg-emerald-500' : 'bg-slate-400'}`}
          style={{ width: Math.max(10, size * 0.26), height: Math.max(10, size * 0.26) }}
          title={online ? 'В сети' : 'Не в сети'}
        />
      )}
    </div>
  );
}

export function Skeleton({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton ${className}`} style={style} aria-hidden="true" />;
}

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" role="status" aria-label="Загрузка">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function EmptyState({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 p-8 text-center text-slate-400 dark:text-slate-500">
      <div className="rounded-2xl bg-slate-100 p-4 dark:bg-slate-800/60">{icon}</div>
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="max-w-xs text-xs opacity-70">{hint}</p>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose(): void; title: string; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4 animate-fade-in" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div
        className={`card w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'} max-h-[92dvh] overflow-y-auto rounded-b-none p-5 pb-safe animate-slide-up sm:rounded-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
