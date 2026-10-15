import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { APP_CONFIG } from '../config';
import type { AppSettings, Theme } from '../types';

const SETTINGS_KEY = 'nexus-settings';

const defaults: AppSettings = {
  theme: 'system',
  notificationsEnabled: true,
  soundEnabled: true,
};

interface SettingsCtx extends AppSettings {
  update(patch: Partial<AppSettings>): void;
}

const Ctx = createContext<SettingsCtx>({ ...defaults, update: () => {} });

function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  try {
    localStorage.setItem('nexus-theme', theme === 'system' ? (dark ? 'dark' : 'light') : theme);
  } catch {
    /* noop */
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      return { ...defaults, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<AppSettings>) };
    } catch {
      return defaults;
    }
  });

  useEffect(() => {
    applyTheme(settings.theme);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const h = () => settings.theme === 'system' && applyTheme('system');
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [settings.theme]);

  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return <Ctx.Provider value={{ ...settings, update }}>{children}</Ctx.Provider>;
}

export const useSettings = () => useContext(Ctx);

/** Всплывающие системные уведомления (по согласию пользователя) */
export async function ensureNotifyPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

export function showNotification(title: string, body: string) {
  if (!APP_CONFIG) return;
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, icon: `${import.meta.env.BASE_URL}favicon.svg` });
    } catch {
      /* на мобильных может быть недоступно */
    }
  }
}
