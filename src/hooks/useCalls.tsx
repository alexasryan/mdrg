import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { backend } from '../lib/backend';
import type { CallMode } from '../types';

export interface ActiveIncoming {
  callId: string;
  mode: CallMode;
  caller: { id: string; display_name: string; avatar_url: string | null } | null;
}

interface CallsCtxValue {
  incoming: ActiveIncoming | null;
  error: string;
  busy: boolean;
  acceptIncoming(): void;
  declineIncoming(): void;
}

const Ctx = createContext<CallsCtxValue>({ incoming: null, error: '', busy: false, acceptIncoming: () => {}, declineIncoming: () => {} });

export function CallProvider({ userId, children }: { userId: string | null; children: ReactNode }) {
  const [incoming, setIncoming] = useState<ActiveIncoming | null>(null);
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setIncoming(null);
    setError('');
    if (!userId) return;
    const unsub = backend.subscribeIncomingCall(userId, (e) => {
      setIncoming((cur) => cur ?? { callId: e.call_id, mode: e.mode, caller: e.caller ?? null });
    });
    // если звонок уже принят/отклонён собеседником — снять "входящий"
    const unsub2 = backend.subscribeCallUpdates(userId, (c) => {
      setIncoming((cur) => (cur && cur.callId === c.id && (c.status !== 'ringing') ? null : cur));
    });
    return () => {
      unsub();
      unsub2();
    };
  }, [userId]);

  const acceptIncoming = useCallback(async () => {
    if (!incoming) return;
    setBusy(true); setError('');
    try {
    const result = await backend.acceptCall(incoming.callId);
    if (result.error) { setError(result.error); return; }
    sessionStorage.setItem('nexus-active-call', JSON.stringify({ callId: incoming.callId, role: 'callee', mode: incoming.mode, peer: incoming.caller }));
    setIncoming(null);
    navigate('/room/call-' + incoming.callId);
    } catch { setError('Не удалось принять звонок. Проверьте соединение'); } finally { setBusy(false); }
  }, [incoming, navigate]);

  const declineIncoming = useCallback(async () => {
    if (!incoming) return;
    try { await backend.declineCall(incoming.callId); setIncoming(null); } catch { setError('Не удалось отклонить звонок. Проверьте соединение'); }
  }, [incoming]);

  return <Ctx.Provider value={{ incoming, error, busy, acceptIncoming, declineIncoming }}>{children}</Ctx.Provider>;
}

export const useCalls = () => useContext(Ctx);
