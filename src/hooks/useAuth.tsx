import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { backend } from '../lib/backend';
import { APP_CONFIG } from '../config';
import type { Profile, AuthUser } from '../types';

interface AuthContextValue {
  user: AuthUser | null; // в demo-режиме — {id}
  profile: Profile | null;
  loading: boolean;
  demoMode: boolean;
  recovery: boolean;
  finishRecovery(): void;
  signIn(email: string, password: string): Promise<{ error?: string }>;
  signUp(email: string, password: string, displayName: string, username: string): Promise<{ error?: string; needsConfirmation: boolean }>;
  signOut(): void;
  refreshProfile(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  loading: true,
  demoMode: false,
  recovery: false,
  finishRecovery: () => {},
  signIn: async () => ({}),
  signUp: async () => ({ needsConfirmation: false }),
  signOut: () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(new URLSearchParams(window.location.search).get('recovery') === '1');

  const loadProfile = useCallback(async (id: string) => {
    const p = await backend.getProfile(id).catch(() => null);
    setProfile(p);
  }, []);

  useEffect(() => {
    let active = true;
    let version = 0;
    async function apply(id: string | null) {
      const epoch = ++version;
      if (!active) return;
      setUserId(id);
      if (!id) { setProfile(null); setLoading(false); return; }
      const p = await backend.getProfile(id).catch(() => null);
      if (active && version === epoch) { setProfile(p); setLoading(false); }
    }
    const unsub = backend.onAuthChange((id, event) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      void apply(id);
    });
    const initial = version;
    void backend.getSessionUserId().then(id => { if (version === initial) void apply(id); }).catch(() => { if (active) setLoading(false); });
    return () => { active = false; version++; unsub(); };
  }, []);

  // присутствие онлайн + heartbeat
  useEffect(() => {
    if (!userId) return;
    void backend.setPresence(userId, true).catch(() => {});
    const hb = setInterval(() => void backend.setPresence(userId, true).catch(() => {}), 60_000);
    const onUnload = () => void backend.setPresence(userId, false).catch(() => {});
    window.addEventListener('beforeunload', onUnload);
    return () => {
      clearInterval(hb);
      window.removeEventListener('beforeunload', onUnload);
      onUnload();
    };
  }, [userId]);

  const value: AuthContextValue = {
    user: userId ? ({ id: userId } as AuthUser) : null,
    profile,
    loading,
    demoMode: APP_CONFIG.demoMode,
    recovery,
    finishRecovery() { setRecovery(false); const u = new URL(window.location.href); u.searchParams.delete('recovery'); history.replaceState(null, '', u); },
    async signIn(email, password) {
      const res = await backend.signIn(email, password);
      return res;
    },
    async signUp(email, password, displayName, username) {
      return backend.signUp(email, password, displayName, username);
    },
    signOut() {
      void backend.signOut().catch(() => { window.alert('Не удалось выйти. Проверьте соединение и повторите попытку.'); });
    },
    async refreshProfile() {
      if (userId) await loadProfile(userId);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
