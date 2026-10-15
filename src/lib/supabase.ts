import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { APP_CONFIG } from '../config';

/**
 * Клиент Supabase. Если ключи не настроены — приложение работает в
 * demo-режиме (см. lib/mockBackend.ts), чтобы интерфейс можно было
 * оценить без внешней инфраструктуры.
 */
export const isSupabaseConfigured = Boolean(APP_CONFIG.supabaseUrl && APP_CONFIG.supabaseAnonKey);

let client: SupabaseClient | null = null;

if (isSupabaseConfigured) {
  client = createClient(APP_CONFIG.supabaseUrl!, APP_CONFIG.supabaseAnonKey!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

export const supabase = client;
