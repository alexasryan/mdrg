import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Monitor, Moon, Sun, Bell, Volume2, Camera, LogOut, Check } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useSettings, ensureNotifyPermission } from '../hooks/useSettings';
import { backend } from '../lib/backend';
import { Avatar } from '../components/ui';
import { profileSchema, validate } from '../lib/validation';

export default function SettingsPage() {
  const navigate = useNavigate();
  const { profile, refreshProfile, signOut, demoMode } = useAuth();
  const settings = useSettings();
  const [tab, setTab] = useState<'profile' | 'appearance' | 'notifications'>('profile');
  const [name, setName] = useState(profile?.display_name ?? '');
  const [status, setStatus] = useState(profile?.status_text ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function saveProfile() {
    if (!profile) return;
    const v = validate(profileSchema, { displayName: name, statusText: status });
    if (!v.ok) return setErrors(v.errors);
    setErrors({});
    setBusy(true);
    const res = await backend.updateProfile(profile.id, { display_name: v.value.displayName, status_text: v.value.statusText });
    setBusy(false);
    if (res.error) return setErrors({ form: res.error });
    await refreshProfile();
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  async function pickAvatar(f: File) {
    if (!profile) return;
    if (f.size > 2 * 1024 * 1024) return setErrors({ avatar: 'Файл больше 2 МБ' });
    setBusy(true);
    const res = await backend.uploadAvatar(profile.id, f);
    setBusy(false);
    if (res.error) return setErrors({ avatar: res.error });
    await refreshProfile();
  }

  return (
    <div className="min-h-dvh bg-slate-100 dark:bg-slate-950">
      <header className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-3 pt-safe dark:border-slate-800 dark:bg-slate-900">
        <button className="icon-btn" onClick={() => navigate(-1)} aria-label="Назад"><ArrowLeft className="h-5 w-5" /></button>
        <h1 className="text-base font-semibold">Профиль и настройки</h1>
      </header>

      <div className="mx-auto max-w-lg space-y-4 p-4 pb-safe">
        {/* карточка профиля */}
        <div className="card flex items-center gap-4 p-5">
          <div className="relative">
            <Avatar name={profile?.display_name ?? '?'} src={profile?.avatar_url} size={64} />
            <button className="absolute -bottom-1 -right-1 rounded-full bg-primary-600 p-1.5 text-white shadow hover:bg-primary-700" onClick={() => fileRef.current?.click()} aria-label="Загрузить аватар">
              <Camera className="h-3.5 w-3.5" />
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickAvatar(f); e.target.value = ''; }} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-base font-bold">{profile?.display_name}</p>
            <p className="truncate text-sm text-slate-500">@{profile?.username}{demoMode ? ' · демо-режим' : ''}</p>
          </div>
        </div>

        <nav className="grid grid-cols-3 gap-1 rounded-xl bg-slate-200/70 p-1 dark:bg-slate-800/70" role="tablist">
          {([['profile', 'Профиль'], ['appearance', 'Оформление'], ['notifications', 'Уведомления']] as const).map(([t, l]) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-lg py-2 text-sm font-medium ${tab === t ? 'bg-white shadow-sm dark:bg-slate-900' : 'text-slate-500'}`}>{l}</button>
          ))}
        </nav>

        {tab === 'profile' && (
          <div className="card space-y-4 p-5 animate-fade-in">
            <div>
              <label htmlFor="pname" className="mb-1 block text-sm font-medium">Имя</label>
              <input id="pname" className={`input ${errors.displayName ? '!border-red-500' : ''}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
              {errors.displayName && <p className="mt-1 text-xs text-red-500">{errors.displayName}</p>}
            </div>
            <div>
              <label htmlFor="pstatus" className="mb-1 block text-sm font-medium">Статус</label>
              <input id="pstatus" className={`input ${errors.statusText ? '!border-red-500' : ''}`} placeholder="Коротко о себе" value={status} onChange={(e) => setStatus(e.target.value)} maxLength={120} />
              {errors.statusText && <p className="mt-1 text-xs text-red-500">{errors.statusText}</p>}
            </div>
            {errors.avatar && <p className="text-xs text-red-500">{errors.avatar}</p>}
            {errors.form && <p className="text-xs text-red-500">{errors.form}</p>}
            <button className="btn-primary w-full" onClick={() => void saveProfile()} disabled={busy}>
              {saved ? (<><Check className="h-4 w-4" /> Сохранено</>) : 'Сохранить изменения'}
            </button>
          </div>
        )}

        {tab === 'appearance' && (
          <div className="card space-y-2 p-5 animate-fade-in" role="radiogroup" aria-label="Тема оформления">
            {([['light', 'Светлая', Sun], ['dark', 'Тёмная', Moon], ['system', 'Как в системе', Monitor]] as const).map(([t, l, Icon]) => (
              <button key={t} role="radio" aria-checked={settings.theme === t} onClick={() => settings.update({ theme: t })} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm transition-colors ${settings.theme === t ? 'bg-primary-50 font-medium text-primary-700 dark:bg-primary-950/50 dark:text-primary-300' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                <Icon className="h-5 w-5" aria-hidden /> {l}
                {settings.theme === t && <Check className="ml-auto h-4 w-4" aria-hidden />}
              </button>
            ))}
          </div>
        )}

        {tab === 'notifications' && (
          <div className="card space-y-2 p-5 animate-fade-in">
            <SettingToggle icon={<Bell className="h-5 w-5" />} label="Всплывающие уведомления" hint="Показывать о новых сообщениях, когда вкладка свёрнута" checked={settings.notificationsEnabled} onChange={async (v) => { if (v && !(await ensureNotifyPermission())) v = false; settings.update({ notificationsEnabled: v }); }} />
            <SettingToggle icon={<Volume2 className="h-5 w-5" />} label="Звук уведомлений" checked={settings.soundEnabled} onChange={(v) => settings.update({ soundEnabled: v })} />
            <p className="pt-2 text-xs text-slate-400">Настройки хранятся в этом браузере и не покидают устройство.</p>
          </div>
        )}

        <button className="btn-secondary w-full !text-red-600" onClick={() => { signOut(); navigate('/auth'); }}>
          <LogOut className="h-4 w-4" aria-hidden /> Выйти из аккаунта
        </button>
      </div>
    </div>
  );
}

function SettingToggle({ icon, label, hint, checked, onChange }: { icon: React.ReactNode; label: string; hint?: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/60">
      <span className="text-slate-500">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-slate-400">{hint}</span>}
      </span>
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="relative h-6 w-11 shrink-0 rounded-full bg-slate-300 transition-colors peer-checked:bg-primary-600 dark:bg-slate-700">
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
    </label>
  );
}
