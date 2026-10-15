/**
 * WebRTC-менеджер для комнат звонков (P2P mesh).
 * Каждый участник держит RTCPeerConnection с каждым другим участником.
 * Сигнализация — через инъекционный Transport (Supabase Realtime или BroadcastChannel).
 */
import { APP_CONFIG } from '../config';

export type SignalPayload =
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'ice'; candidate: RTCIceCandidateInit }
  | { type: 'leave' };

export interface SignalTransport {
  send(from: string, to: string | null, payload: SignalPayload): Promise<void>;
  subscribe(selfPeer: string, cb: (from: string, payload: SignalPayload) => void): () => void;
}

export type PeerState = 'connecting' | 'connected' | 'disconnected' | 'failed';

export class CallManager {
  readonly selfPeer: string;
  private localStream: MediaStream | null = null;
  private pcMap = new Map<string, RTCPeerConnection>();
  private remoteStreams = new Map<string, MediaStream>();
  private makeOffer: Record<string, boolean> = {}; // детерминированный выбор "кто звонит" в паре
  private onLocalStream?: (s: MediaStream | null) => void;
  private onRemoteStream?: (peerId: string, s: MediaStream | null) => void;
  private onPeerState?: (peerId: string, state: PeerState) => void;
  private closed = false;
  private transportUnsub: (() => void) | null = null;

  constructor(
    private transport: SignalTransport,
    _roomId: string,
    selfPeer: string,
    handlers: {
      onLocalStream?: (s: MediaStream | null) => void;
      onRemoteStream?: (peerId: string, s: MediaStream | null) => void;
      onPeerState?: (peerId: string, state: PeerState) => void;
    },
  ) {
    this.selfPeer = selfPeer;
    this.onLocalStream = handlers.onLocalStream;
    this.onRemoteStream = handlers.onRemoteStream;
    this.onPeerState = handlers.onPeerState;
  }

  /** Запрашивает камеру/микрофон. Бросает ошибку при отказе доступа. */
  async initMedia(video: boolean): Promise<MediaStream> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: video ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
    });
    this.localStream = stream;
    this.onLocalStream?.(stream);
    return stream;
  }

  get hasMedia() {
    return !!this.localStream;
  }

  start(): void {
    if (this.closed) return;
    this.transportUnsub = this.transport.subscribe(this.selfPeer, (from, payload) => this.handleSignal(from, payload));
  }

  /** Вызывается при появлении нового участника комнаты */
  async handlePeerJoined(peerId: string): Promise<void> {
    if (peerId === this.selfPeer || this.closed || !this.localStream) return;
    // детерминированно: offer отправляет тот, чей id меньше в паре
    const weOffer = this.selfPeer < peerId;
    this.makeOffer[peerId] = weOffer;
    const pc = this.createPC(peerId);
    if (weOffer) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await this.transport.send(this.selfPeer, peerId, { type: 'offer', sdp: offer.sdp! });
      } catch (e) {
        console.error('offer error', e);
      }
    } else {
      // подождать offer от собеседника (подписка уже активна)
      void pc;
    }
  }

  handlePeerLeft(peerId: string): void {
    this.closePC(peerId);
    this.remoteStreams.delete(peerId);
    this.onRemoteStream?.(peerId, null);
  }

  private createPC(peerId: string): RTCPeerConnection {
    const existing = this.pcMap.get(peerId);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: [...APP_CONFIG.iceServers] });
    this.pcMap.set(peerId, pc);

    this.localStream?.getTracks().forEach((t) => pc.addTrack(t, this.localStream!));

    pc.onicecandidate = (e) => {
      if (e.candidate) void this.transport.send(this.selfPeer, peerId, { type: 'ice', candidate: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState as PeerState;
      this.onPeerState?.(peerId, st);
      if (pc.connectionState === 'failed') this.tryIceRestart(pc, peerId);
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (!stream) return;
      this.remoteStreams.set(peerId, stream);
      this.onRemoteStream?.(peerId, stream);
    };
    return pc;
  }

  private async tryIceRestart(pc: RTCPeerConnection, peerId: string) {
    if (this.closed) return;
    try {
      if (this.makeOffer[peerId]) {
        await pc.restartIce();
        const offer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(offer);
        await this.transport.send(this.selfPeer, peerId, { type: 'offer', sdp: offer.sdp! });
      }
    } catch (e) {
      console.error('ICE restart failed', e);
    }
  }

  private async handleSignal(from: string, payload: SignalPayload) {
    if (this.closed) return;
    const pc = this.pcMap.get(from) ?? (payload.type !== 'leave' ? this.createPCWithTracks(from) : undefined);
    if (!pc && payload.type !== 'leave') return;
    try {
      switch (payload.type) {
        case 'offer': {
          this.makeOffer[from] = false;
          await pc!.setRemoteDescription({ type: 'offer', sdp: payload.sdp });
          const answer = await pc!.createAnswer();
          await pc!.setLocalDescription(answer);
          await this.transport.send(this.selfPeer, from, { type: 'answer', sdp: answer.sdp! });
          break;
        }
        case 'answer':
          await pc!.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
          break;
        case 'ice':
          try {
            await pc!.addIceCandidate(payload.candidate);
          } catch {
            // кандидат мог прийти раньше remote description — игнорируем безопасно
          }
          break;
        case 'leave':
          this.handlePeerLeft(from);
          break;
      }
    } catch (e) {
      console.error('signal handling error', e);
    }
  }

  /** PC созданная "в ответ" на сигнал — тоже нужно добавить треки */
  private createPCWithTracks(peerId: string): RTCPeerConnection | null {
    if (!this.localStream) return null;
    return this.createPC(peerId);
  }

  setMicrophoneEnabled(enabled: boolean): void {
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = enabled));
  }
  setCameraEnabled(enabled: boolean): void {
    this.localStream?.getVideoTracks().forEach((t) => (t.enabled = enabled));
  }
  get videoTrack(): MediaStreamTrack | undefined {
    return this.localStream?.getVideoTracks()[0];
  }

  /** Переключение камеры (deviceChange во время звонка) */
  async switchCamera(deviceId: string): Promise<void> {
    const pcList = [...this.pcMap.values()];
    const sender = pcList[0]?.getSenders().find((s) => s.track?.kind === 'video');
    if (!sender) return;
    const newTrack = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } } });
    const track = newTrack.getVideoTracks()[0];
    const old = this.localStream?.getVideoTracks()[0];
    if (old && this.localStream) {
      this.localStream.removeTrack(old);
      old.stop();
      this.localStream.addTrack(track);
    }
    await sender.replaceTrack(track);
    // синхронизируем трек во всех соединениях mesh
    for (const pc of pcList.slice(1)) {
      const snd = pc.getSenders().find((s) => s.track?.kind === 'video');
      await snd?.replaceTrack(track);
    }
  }

  private closePC(peerId: string) {
    const pc = this.pcMap.get(peerId);
    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.close();
      this.pcMap.delete(peerId);
    }
  }

  /** Полная очистка ресурсов */
  async destroy(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.transport.send(this.selfPeer, null, { type: 'leave' });
    } catch {
      /* сеть могла отвалиться — всё равно очищаем локально */
    }
    this.transportUnsub?.();
    for (const id of [...this.pcMap.keys()]) this.closePC(id);
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.remoteStreams.clear();
    this.onLocalStream?.(null);
  }

  overallState(): PeerState {
    const states = [...this.pcMap.values()].map((p) => p.connectionState as PeerState);
    if (!states.length) return 'connecting';
    if (states.some((s) => s === 'failed')) return 'failed';
    if (states.every((s) => s === 'connected')) return 'connected';
    if (states.some((s) => s === 'disconnected')) return 'disconnected';
    return 'connecting';
  }
}
