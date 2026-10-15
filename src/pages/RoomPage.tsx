import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Mic, MicOff, Video as VideoIcon, VideoOff, PhoneOff, Maximize, Minimize, Users, SwitchCamera, Copy, Share2, Wifi, WifiOff, ShieldAlert, Loader2, LogIn, ArrowLeft } from 'lucide-react';
import { backend } from '../lib/backend';
import { CallManager, type SignalTransport, type PeerState } from '../lib/webrtc';
import { APP_CONFIG, buildInviteLink } from '../config';
import { formatDuration } from '../utils/format';
import { copyToClipboard, nativeShare } from '../utils/format';
import { Avatar, Spinner } from '../components/ui';
import { guestNameSchema, validate } from '../lib/validation';
import { isSupabaseConfigured } from '../lib/supabase';
import type { CallRoom, RoomParticipant } from '../types';

/* ---------- транспорты сигнализации ---------- */

function makeBcTransport(): SignalTransport {
  const ch = new BroadcastChannel('nexus-signaling');
  return {
    async send(from, to, payload) {
      ch.postMessage({ from, to, payload });
    },
    subscribe(selfPeer, cb) {
      const h = (ev: MessageEvent) => {
        const d = ev.data;
        if (d?.from !== selfPeer && (d?.to === null || d?.to === selfPeer)) cb(d.from, d.payload);
      };
      ch.addEventListener('message', h);
      return () => ch.removeEventListener('message', h);
    },
  };
}

function makeSbTransport(roomId: string): SignalTransport {
  let lastId = 0;
  void backend.getSignalsSince(roomId, 0).then((s) => s.length && (lastId = s[s.length - 1].id));
  return {
    async send(from, to, payload) {
      await backend.sendSignal(roomId, from, to, payload);
    },
    subscribe(selfPeer, cb) {
      const unsubRealtime = backend.subscribeSignals(roomId, selfPeer, (s) => {
        if (s.id > lastId) {
          lastId = s.id;
          cb(s.sender_peer, s.payload as never);
        }
      });
      // страховка на случай пропуска realtime-событий: периодический опрос
      const poll = setInterval(async () => {
        const list = await backend.getSignalsSince(roomId, lastId);
        for (const s of list) {
          if (s.id <= lastId) continue;
          if (s.sender_peer !== selfPeer && (s.target_peer === null || s.target_peer === selfPeer)) {
            lastId = s.id;
            cb(s.sender_peer, s.payload as never);
          } else lastId = s.id;
        }
      }, 4000);
      return () => {
        unsubRealtime();
        clearInterval(poll);
      };
    },
  };
}

/** id пира для 1:1 звонка через "комнату" call-<callId> */
function transportFor(roomId: string): SignalTransport {
  return isSupabaseConfigured ? makeSbTransport(roomId) : makeBcTransport();
}

/* ---------- основной экран звонка ---------- */

interface ActiveCallMeta {
  callId: string;
  role: 'caller' | 'callee';
  mode: 'audio' | 'video';
  peer: { id: string; display_name: string; avatar_url: string | null } | null;
}

export default function RoomPage() {
  const params = useParams<{ id?: string; roomId?: string }>();
  const roomId = params.id ?? params.roomId ?? '';
  const navigate = useNavigate();

  const [room, setRoom] = useState<CallRoom | null | 'loading'>('loading');
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<'prejoin' | 'connecting' | 'in-call' | 'ended'>('prejoin');
  const [mediaError, setMediaError] = useState('');
  const [guestName, setGuestName] = useState('');
  const [videoOn, setVideoOn] = useState(roomId.startsWith('call-') ? true : true);

  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  const [myPeer, setMyPeer] = useState('');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const remoteStreams = useRef<Map<string, MediaStream>>(new Map());
  const [, forceRender] = useState(0);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [netState, setNetState] = useState<PeerState>('connecting');
  const [seconds, setSeconds] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);

  const managerRef = useRef<CallManager | null>(null);
  const roomViewRef = useRef<HTMLDivElement>(null);
  const hbRef = useRef<number | null>(null);

  const isDirect = roomId.startsWith('call-');
  const callId = isDirect ? roomId.slice('call-'.length) : '';

  // загрузка комнаты / звонка
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        if (isDirect) {
          const call = await backend.getCall(callId);
          if (!mounted) return;
          if (!call) return setError('Ссылка на звонок недействительна или звонок завершён');
          const metaRaw = sessionStorage.getItem('nexus-active-call');
          const meta: ActiveCallMeta | null = metaRaw ? JSON.parse(metaRaw) : null;
          if (!meta || meta.callId !== callId) {
            // гость открыл ссылку на прямой звонок — предложим войти/оценить статус
            if (call.status === 'ringing' || call.status === 'accepted') {
              setRoom({ id: roomId, owner_id: call.caller_id, title: 'Личный звонок', mode: call.mode, status: 'active', max_participants: 2, created_at: call.created_at, updated_at: call.created_at, ended_at: null });
              setPhase('prejoin');
            } else setError('Звонок завершён');
            return;
          }
          setRoom({ id: roomId, owner_id: call.caller_id, title: meta.peer?.display_name ?? 'Личный звонок', mode: meta.mode, status: 'active', max_participants: 2, created_at: call.created_at, updated_at: call.created_at, ended_at: null });
          setVideoOn(meta.mode === 'video');
          setPhase('prejoin');
        } else {
          const r = await backend.getRoom(roomId);
          if (!mounted) return;
          if (!r) return setError('Комната не найдена. Возможно, ссылка устарела.');
          if (r.status === 'ended') return setError('Этот звонок уже завершён.');
          if (Date.now() - new Date(r.updated_at).getTime() > APP_CONFIG.roomStaleAfterMs) return setError('Ссылка просрочена — комната была неактивна более 10 минут.');
          setRoom(r);
          setVideoOn(r.mode === 'video');
          setPhase('prejoin');
        }
      } catch (e) {
        if (mounted) setError((e as Error).message || 'Не удалось загрузить комнату');
      }
    })();
    return () => {
      mounted = false;
    };
  }, [roomId, isDirect, callId]);

  const refreshParticipants = useCallback(async () => {
    const list = await backend.listParticipants(roomId);
    setParticipants(list);
  }, [roomId]);

  // подписка на изменения состава + heartbeat
  useEffect(() => {
    if (phase !== 'in-call') return;
    void refreshParticipants();
    const unsub = backend.subscribeRoom(roomId, () => void refreshParticipants());
    hbRef.current = window.setInterval(async () => {
      const p = myPeer;
      if (p) await backend.heartbeat(roomId, p).catch(() => {});
    }, 30_000);
    return () => {
      unsub();
      if (hbRef.current) clearInterval(hbRef.current);
    };
  }, [phase, roomId, myPeer, refreshParticipants]);

  // таймер разговора
  useEffect(() => {
    if (phase !== 'in-call') return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // отслеживание состояния сети браузера
  useEffect(() => {
    if (!navigator.onLine) setNetState('disconnected');
    const on = () => void 0;
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, []);

  // enumerateDevices после получения доступа
  useEffect(() => {
    if (!localStream) return;
    navigator.mediaDevices.enumerateDevices().then((ds) => setCameras(ds.filter((d) => d.kind === 'videoinput'))).catch(() => {});
  }, [localStream]);

  async function join() {
    setError('');
    setMediaError('');
    const name = guestName.trim() || 'Гость';
    const v = validate(guestNameSchema, name);
    if (!v.ok) return setError(v.errors.form ?? 'Проверьте имя');

    setPhase('connecting');
    try {
      // проверка прав и вступление
      const me = await backend.getSessionUserId();
      const res = await backend.joinRoom(roomId, { userId: me, displayName: me ? undefined! : name || 'Гость' }).catch(() => null);
      // joinRoom требует displayName — корректируем вызов ниже
      void res;
      const joinRes = await backend.joinRoom(roomId, { userId: me, displayName: name });
      if (!joinRes.participant) {
        setPhase('prejoin');
        return setError(joinRes.error ?? 'Не удалось подключиться к комнате');
      }
      const participantId = joinRes.participant.id;
      setMyPeer(participantId);

      // медиа
      const mgr = new CallManager(transportFor(roomId), roomId, participantId, {
        onLocalStream: (s) => setLocalStream(s),
        onRemoteStream: (peerId, s) => {
          if (s) remoteStreams.current.set(peerId, s);
          else remoteStreams.current.delete(peerId);
          forceRender((x) => x + 1);
        },
        onPeerState: (_p, st) => setNetState(st),
      });
      managerRef.current = mgr;
      mgr.start();
      await mgr.initMedia(videoOn);

      // существующие участники
      const others = await backend.listParticipants(roomId);
      for (const p of others) if (p.id !== participantId) void mgr.handlePeerJoined(p.id);
      setParticipants(others);

      // при появлении новых участников — создаём соединения
      const unsub = backend.subscribeRoom(roomId, () => {
        void backend.listParticipants(roomId).then((list) => {
          setParticipants(list);
          for (const p of list) if (p.id !== participantId) void mgr.handlePeerJoined(p.id);
          for (const id of [...remoteStreams.current.keys()]) if (!list.some((p) => p.id === id)) mgr.handlePeerLeft(id);
        });
      });

      setPhase('in-call');
      cleanupFns.push(unsub);

      if (isDirect) {
        const metaRaw = sessionStorage.getItem('nexus-active-call');
        if (metaRaw) {
          const meta: ActiveCallMeta = JSON.parse(metaRaw);
          if (meta.role === 'callee') void backend.acceptCall(meta.callId);
        }
      }
    } catch (e) {
      setPhase('prejoin');
      const err = e as Error;
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') setMediaError('Доступ к камере или микрофону запрещён. Разрешите его в настройках браузера и повторите попытку.');
      else if (err.name === 'NotFoundError') setMediaError('Устройство записи не найдено. Подключите микрофон/камеру.');
      else setError(err.message || 'Не удалось подключиться');
      await hardCleanup();
    }
  }

  const cleanupFns: Array<() => void> = [];

  async function leaveCall(reason?: string) {
    setPhase('ended');
    if (reason) setError(reason);
    await hardCleanup();
    if (isDirect) {
      const metaRaw = sessionStorage.getItem('nexus-active-call');
      if (metaRaw) {
        const meta: ActiveCallMeta = JSON.parse(metaRaw);
        const call = await backend.getCall(meta.callId);
        if (call && (call.status === 'ringing' || call.status === 'accepted')) await backend.endCall(meta.callId);
      }
      sessionStorage.removeItem('nexus-active-call');
    }
    // если мы последний живой участник — закрываем комнату
    const remaining = await backend.listParticipants(roomId);
    if (!remaining.length) await backend.endRoom(roomId).catch(() => {});
  }

  async function hardCleanup() {
    for (const f of cleanupFns.splice(0)) f();
    const mgr = managerRef.current;
    if (mgr) {
      const pid = myPeer;
      await mgr.destroy();
      if (pid) await backend.leaveRoom(roomId, pid).catch(() => {});
      managerRef.current = null;
    }
    remoteStreams.current.clear();
    setLocalStream(null);
  }

  // уход с страницы = завершение звонка
  useEffect(() => {
    return () => {
      for (const f of cleanupFns.splice(0)) f();
      void managerRef.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inviteLink = useMemo(() => buildInviteLink(roomId), [roomId]);
  const inCall = phase === 'in-call';
  const roomData = room !== 'loading' ? room : null;

  /* ===== экраны ошибок ===== */
  if (error && !inCall && phase !== 'connecting' && !roomData) {
    return <InvalidScreen message={error} onBack={() => navigate('/')} />;
  }

  /* ===== prejoin / joining ===== */
  if (!inCall) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-slate-900 to-slate-950 p-4 text-white pt-safe pb-safe">
        {room === 'loading' ? (
          <Spinner className="h-8 w-8 text-primary-400" />
        ) : (
          <div className="w-full max-w-sm animate-slide-up text-center">
            <button onClick={() => navigate('/')} className="btn-ghost absolute left-3 top-3 !text-slate-300 hover:!bg-slate-800 md:hidden" aria-label="Назад"><ArrowLeft className="h-5 w-5" /></button>
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-primary-600 shadow-xl shadow-primary-600/40">
              {roomData?.mode === 'audio' ? <Mic className="h-7 w-7" /> : <VideoIcon className="h-7 w-7" />}
            </div>
            <h1 className="text-xl font-bold">{roomData?.title ?? 'Звонок'}</h1>
            <p className="mt-1 text-sm text-slate-400">
              {roomData?.owner?.display_name ? `Приглашение от ${roomData.owner.display_name} · ` : ''}
              {participants.length}/{roomData?.max_participants ?? APP_CONFIG.maxRoomParticipants} участников
            </p>

            {!isDirect || !!sessionStorage.getItem('nexus-active-call') ? null : (
              <p className="mt-3 rounded-xl bg-slate-800/80 px-3 py-2 text-xs text-slate-300">Вы можете подключиться как гость — регистрация не требуется.</p>
            )}

            <div className="mt-6 space-y-3 text-left">
              {!isDirect && (
                <div>
                  <label htmlFor="gname" className="mb-1 block text-sm font-medium text-slate-200">Ваше отображаемое имя</label>
                  <input id="gname" className="input !border-slate-700 !bg-slate-800 !text-white placeholder:!text-slate-500" placeholder="Например, Алексей" value={guestName} onChange={(e) => setGuestName(e.target.value)} maxLength={40} />
                </div>
              )}
              {mediaError && <p className="rounded-xl bg-red-900/50 px-3 py-2 text-sm text-red-200" role="alert">{mediaError}</p>}
              {error && <p className="rounded-xl bg-red-900/50 px-3 py-2 text-sm text-red-200" role="alert">{error}</p>}
              {!isSupabaseConfigured && (
                <p className="flex items-start gap-2 rounded-xl bg-amber-900/40 px-3 py-2 text-xs text-amber-200">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> Демо-режим: звонки работают между вкладками одного браузера. Для звонков между устройствами настройте Supabase.
                </p>
              )}
              <button className="btn-primary w-full !py-3 text-base" onClick={() => void join()} disabled={phase === 'connecting'}>
                {phase === 'connecting' ? (<><Loader2 className="h-5 w-5 animate-spin" /> Подключение…</>) : (<><PhoneIconSmall /> {roomData?.mode === 'audio' ? 'Подключиться с микрофоном' : 'Подключиться с камерой'}</>)}
              </button>
              <div className="flex gap-2">
                <button className={`btn flex-1 !border ${videoOn ? 'border-slate-600 bg-slate-800 text-white' : 'border-slate-700 bg-slate-900 text-slate-400'}`} onClick={() => setVideoOn((v) => !v)} aria-pressed={videoOn}>
                  {videoOn ? <VideoIcon className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />} {videoOn ? 'Камера включена' : 'Камера выключена'}
                </button>
              </div>
              {!isSupabaseConfigured && !localStorage.getItem('nexus-demo-session') && (
                <button className="btn-secondary w-full !border-slate-700 !bg-slate-800 !text-slate-200" onClick={() => navigate('/auth')}>
                  <LogIn className="h-4 w-4" /> Войти в аккаунт (не обязательно)
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ===== in-call ===== */
  const remoteList = [...remoteStreams.current.entries()];
  const stateLabel = netState === 'connected' ? 'Соединение установлено' : netState === 'failed' ? 'Не удалось установить соединение' : netState === 'disconnected' ? 'Связь потеряна, идёт переподключение…' : 'Соединение…';

  async function toggleMic() {
    managerRef.current?.setMicrophoneEnabled(!micOn);
    setMicOn((v) => !v);
  }
  async function toggleCam() {
    managerRef.current?.setCameraEnabled(!camOn);
    setCamOn((v) => !v);
  }
  async function cycleCamera() {
    if (cameras.length < 2) return setErrorOnly('Доступна только одна камера');
    const cur = managerRef.current?.videoTrack?.getSettings().deviceId;
    const idx = cameras.findIndex((c) => c.deviceId === cur);
    const next = cameras[(idx + 1) % cameras.length];
    try {
      await managerRef.current?.switchCamera(next.deviceId);
    } catch {
      setErrorOnly('Не удалось переключить камеру');
    }
  }
  const [tinyNotice, setTinyNotice] = useState('');
  function setErrorOnly(m: string) {
    setTinyNotice(m);
    setTimeout(() => setTinyNotice(''), 2500);
  }
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      roomViewRef.current?.requestFullscreen?.().catch(() => {});
      setFullscreen(true);
    } else {
      void document.exitFullscreen?.();
      setFullscreen(false);
    }
  }

  return (
    <div ref={roomViewRef} className="relative flex h-dvh flex-col bg-slate-950 text-white">
      {/* видео-область */}
      <div className="relative flex-1 overflow-hidden">
        {roomData?.mode === 'video' || localStream?.getVideoTracks().length ? (
          <div className="grid h-full grid-cols-1 gap-2 p-2 pt-safe">
            {/* удалённые */}
            {remoteList.length === 0 && (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl bg-slate-900">
                <Spinner className="h-7 w-7 text-primary-400" />
                <p className="text-sm text-slate-400">Ожидание собеседника…</p>
                <p className="max-w-xs text-center text-xs text-slate-500">Отправьте ссылку приглашённым: они откроют её и нажмут «Подключиться»</p>
              </div>
            )}
            {remoteList.map(([pid, stream], i) => (
              <RemoteTile key={pid} stream={stream} participants={participants} pid={pid} big={remoteList.length === 1 || i === 0} />
            ))}
            {/* локальное PiP */}
            <div className="absolute bottom-24 right-3 z-10 h-28 w-20 overflow-hidden rounded-xl border border-white/20 bg-slate-900 shadow-lg sm:h-36 sm:w-28">
              {localStream && localStream.getVideoTracks().some((t) => t.enabled) ? (
                <video autoPlay playsInline muted srcObject={localStream} className="h-full w-full -scale-x-100 object-cover" />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-1 text-[10px] text-slate-400"><VideoOff className="h-5 w-5" /> камера выкл</div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
            <div className="flex -space-x-3">
              {participants.slice(0, 5).map((p) => <Avatar key={p.id} name={p.display_name} src={p.user?.avatar_url} size={56} className="ring-2 ring-slate-950" />)}
            </div>
            <p className="text-lg font-semibold">{participants.length} в разговоре</p>
            <p className="font-mono text-3xl tabular-nums text-primary-400">{formatDuration(seconds)}</p>
            <p className="text-sm text-slate-400">{stateLabel}</p>
          </div>
        )}

        {/* верхняя панель */}
        <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-3 bg-gradient-to-b from-black/60 to-transparent px-4 py-3 pt-safe">
          <div className="flex items-center gap-2 text-sm">
            {netState === 'connected' ? <Wifi className="h-4 w-4 text-emerald-400" aria-label="Соединение установлено" /> : <WifiOff className={`h-4 w-4 ${netState === 'failed' ? 'text-red-400' : 'text-amber-400 animate-pulse'}`} aria-hidden />}
            <span className="text-slate-200">{stateLabel}</span>
          </div>
          <span className="ml-auto flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs"><Users className="h-3.5 w-3.5" aria-hidden /> {participants.length}/{roomData?.max_participants ?? APP_CONFIG.maxRoomParticipants}</span>
          <span className="rounded-full bg-white/10 px-3 py-1 font-mono text-xs tabular-nums" aria-label="Длительность разговора">{formatDuration(seconds)}</span>
          <button className="icon-btn !text-white hover:!bg-white/10" onClick={toggleFullscreen} aria-label="Полноэкранный режим">
            {fullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
          </button>
        </div>

        {(netState === 'failed') && (
          <div className="absolute inset-x-4 top-16 z-20 rounded-xl bg-red-900/80 px-4 py-2.5 text-sm text-red-100 backdrop-blur" role="alert">
            Соединение не установлено. Проверьте интернет — выполняется автоматическая переподключение через ICE restart.
          </div>
        )}
        {tinyNotice && <div className="absolute inset-x-4 top-16 z-20 rounded-xl bg-slate-800/90 px-4 py-2.5 text-sm" role="status">{tinyNotice}</div>}
      </div>

      {/* панель управления — крупные кнопки, доступны одной рукой снизу */}
      <div className="z-10 mx-auto flex w-full max-w-xl items-center justify-evenly gap-2 bg-slate-900/95 px-4 py-4 pb-safe backdrop-blur">
        <CallControl label={micOn ? 'Микрофон' : 'Выключен'} active={micOn} danger onClick={toggleMic}>
          {micOn ? <Mic className="h-6 w-6" /> : <MicOff className="h-6 w-6" />}
        </CallControl>
        {roomData?.mode !== 'audio' && (
          <>
            <CallControl label={camOn ? 'Камера' : 'Выключена'} active={camOn} danger={!camOn} onClick={toggleCam}>
              {camOn ? <VideoIcon className="h-6 w-6" /> : <VideoOff className="h-6 w-6" />}
            </CallControl>
            {cameras.length > 1 && (
              <CallControl label="Сменить камеру" active onClick={cycleCamera}>
                <SwitchCamera className="h-6 w-6" />
              </CallControl>
            )}
          </>
        )}
        <button
          className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white shadow-lg shadow-red-600/40 transition-transform hover:bg-red-500 active:scale-95"
          onClick={() => void leaveCall()}
          aria-label="Завершить звонок"
        >
          <PhoneOff className="h-7 w-7" />
        </button>
        <CallControl label="Ссылка" active onClick={() => { void copyToClipboard(inviteLink).then((ok) => { setCopied(ok); setTimeout(() => setCopied(false), 2000); }); }}>
          {copied ? <span className="text-xs font-bold">✓</span> : <Copy className="h-5 w-5" />}
        </CallControl>
      </div>

      {copied && <div className="pointer-events-none fixed bottom-28 left-1/2 -translate-x-1/2 rounded-lg bg-white/10 px-3 py-1 text-xs">Ссылка скопирована</div>}
    </div>
  );
}

function PhoneIconSmall() {
  return <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" /></svg>;
}

function CallControl({ children, label, active, danger, onClick }: { children: React.ReactNode; label: string; active: boolean; danger?: boolean; onClick(): void }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`flex h-14 w-14 items-center justify-center rounded-full transition-all active:scale-95 ${danger ? 'bg-red-600/90 text-white' : active ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-white/10 text-slate-400 hover:bg-white/15'}`}
    >
      {children}
    </button>
  );
}

function RemoteTile({ stream, participants, pid, big }: { stream: MediaStream; participants: RoomParticipant[]; pid: string; big?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const p = participants.find((x) => x.id === pid);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <div className={`relative overflow-hidden rounded-2xl bg-slate-900 ${big ? 'min-h-0 flex-1' : 'aspect-video'}`}>
      <video ref={ref} autoPlay playsInline className="h-full w-full object-cover" />
      {!stream.getVideoTracks().some((t) => t.enabled && !t.muted) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900/90">
          <Avatar name={p?.display_name ?? 'Собеседник'} src={p?.user?.avatar_url} size={72} />
          <p className="text-sm text-slate-300">{p?.display_name ?? 'Собеседник'}</p>
        </div>
      )}
      <span className="absolute bottom-2 left-2 rounded-md bg-black/50 px-2 py-0.5 text-xs">{p?.display_name ?? ''}{p?.is_host ? ' · ведущий' : ''}</span>
    </div>
  );
}

function InvalidScreen({ message, onBack }: { message: string; onBack(): void }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-950 p-6 text-center text-white">
      <div className="rounded-3xl bg-red-900/40 p-5"><ShieldAlert className="h-10 w-10 text-red-400" aria-hidden /></div>
      <h1 className="text-xl font-bold">Не удалось подключиться</h1>
      <p className="max-w-sm text-sm text-slate-400">{message}</p>
      <button className="btn-primary" onClick={onBack}>Вернуться в приложение</button>
    </div>
  );
}

// srcObject для video — нет встроенного атрибута React, используем ref-обёртку
declare module 'react' {
  interface ImgHTMLAttributes<T> {
    srcObject?: MediaStream | null;
  }
  interface VideoHTMLAttributes<T> {
    srcObject?: MediaStream | null;
  }
}

void Share2;
