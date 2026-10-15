import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { backend } from '../lib/backend';
import { isSupabaseConfigured } from '../lib/supabase';
import type { Profile, AuthUser } from '../types';

interface AuthContextValue {
  user: AuthUser | null; // в demo-режиме — {id}
  profile: Profile | null;
  loading: boolean;
  demoMode: boolean;
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
  signIn: async () => ({}),
  signUp: async () => ({ needsConfirmation: false }),
  signOut: () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (id: string) => {
    const p = await backend.getProfile(id);
    setProfile(p);
  }, []);

  useEffect(() => {
    let mounted = true;
    backend.getSessionUserId().then((id) => {
      if (!mounted) return;
      setUserId(id);
      setLoading(false);
      if (id) void loadProfile(id);
    });
    const unsub = backend.onAuthChange((id) => {
      setUserId(id);
      if (!id) setProfile(null);
      else void loadProfile(id);
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, [loadProfile]);

  // присутствие онлайн + heartbeat
  useEffect(() => {
    if (!userId) return;
    void backend.setPresence(userId, true);
    const hb = setInterval(() => void backend.setPresence(userId, true), 60_000);
    const onUnload = () => void backend.setPresence(userId, false);
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
    demoMode: !isSupabaseConfigured,
    async signIn(email, password) {
      const res = await backend.signIn(email, password);
      return res;
    },
    async signUp(email, password, displayName, username) {
      return backend.signUp(email, password, displayName, username);
    },
    signOut() {
      void backend.signOut();
    },
    async refreshProfile() {
      if (userId) await loadProfile(userId);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
