/**
 * Глобальная конфигурация Nexus Messenger.
 * Все значения легко изменить в одном месте или через переменные окружения.
 */

export const APP_CONFIG = {
  /** Название приложения (легко переименовать) */
  name: import.meta.env.VITE_APP_NAME || 'Nexus Messenger',
  /** Краткое описание */
  tagline: 'Быстрые сообщения и звонки прямо в браузере',

  supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,

  /** Максимум участников комнаты звонка по ссылке (P2P mesh без SFU) */
  maxRoomParticipants: Number(import.meta.env.VITE_MAX_ROOM_PARTICIPANTS || 4),
  /** Комната считается просроченной, если неактивна дольше этого времени */
  roomStaleAfterMs: 10 * 60 * 1000,
  /** Звонок "пропущен", если не принят за это время */
  callTimeoutMs: 45 * 1000,

  /**
   * ICE-серверы. STUN — публичные, бесплатные.
   * TURN настраивается через VITE_TURN_URL / VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL
   * (учётные данные выдаются вашим TURN-провайдером, например OpenRelay, Twilio, coturn).
   */
  iceServers: (() => {
    const servers: RTCIceServer[] = [
      { urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] },
    ];
    if (import.meta.env.VITE_TURN_URL) {
      servers.push({
        urls: import.meta.env.VITE_TURN_URL,
        username: import.meta.env.VITE_TURN_USERNAME || '',
        credential: import.meta.env.VITE_TURN_CREDENTIAL || '',
      });
    }
    return servers;
  })(),

  limits: {
    maxMessageLength: 4000,
    maxFileSizeMb: 15,
    pageSize: 50,
  },
} as const;

/** Путь к приложению на GitHub Pages (например "/nexus-messenger/") */
export const BASE_PATH = import.meta.env.BASE_URL;

/** Построить абсолютную ссылку-приглашение для комнаты */
export function buildInviteLink(roomId: string): string {
  const base = window.location.origin + BASE_PATH.replace(/\/$/, '');
  return `${base}/call/${roomId}`;
}
