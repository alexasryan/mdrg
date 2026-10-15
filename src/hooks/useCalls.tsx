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
  acceptIncoming(): void;
  declineIncoming(): void;
}

const Ctx = createContext<CallsCtxValue>({ incoming: null, acceptIncoming: () => {}, declineIncoming: () => {} });

export function CallProvider({ userId, children }: { userId: string | null; children: ReactNode }) {
  const [incoming, setIncoming] = useState<ActiveIncoming | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!userId) return;
    const unsub = backend.subscribeIncomingCall(userId, (e) => {
      setIncoming((cur) => cur ?? { callId: e.call_id, mode: e.mode, caller: e.caller ?? null });
    });
    // если звонок уже принят/отклонён собеседником — снять "входящий"
    const unsub2 = backend.subscribeCallUpdates(userId, (c) => {
      setIncoming((cur) => (cur && cur.callId === c.id && (c.status === 'declined' || c.status === 'missed') ? null : cur));
    });
    return () => {
      unsub();
      unsub2();
    };
  }, [userId]);

  const acceptIncoming = useCallback(() => {
    if (!incoming) return;
    void backend.acceptCall(incoming.callId);
    sessionStorage.setItem('nexus-active-call', JSON.stringify({ callId: incoming.callId, role: 'callee', mode: incoming.mode, peer: incoming.caller }));
    setIncoming(null);
    navigate('/room/call-' + incoming.callId);
  }, [incoming, navigate]);

  const declineIncoming = useCallback(() => {
    if (!incoming) return;
    void backend.declineCall(incoming.callId);
    setIncoming(null);
  }, [incoming]);

  return <Ctx.Provider value={{ incoming, acceptIncoming, declineIncoming }}>{children}</Ctx.Provider>;
}

export const useCalls = () => useContext(Ctx);
