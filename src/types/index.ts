import type { User } from '@supabase/supabase-js';

export interface Profile {
  id: string;
  display_name: string;
  username: string;
  avatar_url: string | null;
  status_text: string;
  is_online: boolean;
  last_seen: string | null;
  created_at: string;
}

export type ChatType = 'direct' | 'room';

export interface Chat {
  id: string;
  type: ChatType;
  created_by: string;
  title: string | null;
  created_at: string;
  /** заполняется запросом с participants->profiles */
  participants?: { user_id: string; profile: Pick<Profile, 'id' | 'display_name' | 'username' | 'avatar_url' | 'is_online'> | null }[];
  last_message?: Message | null;
}

export type AttachmentKind = 'image' | 'file';

export interface Attachment {
  name: string;
  url: string;
  storage_path: string;
  size: number;
  mime: string;
  kind: AttachmentKind;
}

export type MessageType = 'text' | 'system';

export interface Message {
  id: string;
  chat_id: string;
  sender_id: string;
  content: string;
  reply_to: string | null;
  attachment: Attachment | null;
  type: MessageType;
  read_by: string[];
  created_at: string;
  sender?: Pick<Profile, 'id' | 'display_name' | 'avatar_url'> | null;
  reply_to_message?: Pick<Message, 'id' | 'content' | 'sender_id'> | null;
}

export type CallMode = 'audio' | 'video';
export type CallStatus = 'ringing' | 'accepted' | 'declined' | 'missed' | 'ended' | 'failed';

export interface Call {
  id: string;
  chat_id: string | null;
  room_id: string | null;
  caller_id: string;
  callee_id: string | null;
  mode: CallMode;
  status: CallStatus;
  created_at: string;
  ended_at: string | null;
  caller?: Pick<Profile, 'id' | 'display_name' | 'avatar_url'> | null;
  callee?: Pick<Profile, 'id' | 'display_name' | 'avatar_url'> | null;
}

export type RoomStatus = 'waiting' | 'active' | 'ended';

export interface CallRoom {
  id: string;
  owner_id: string;
  title: string;
  mode: CallMode;
  status: RoomStatus;
  max_participants: number;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
  owner?: Pick<Profile, 'id' | 'display_name' | 'avatar_url'> | null;
}

export interface RoomParticipant {
  id: string;
  room_id: string;
  user_id: string | null;
  display_name: string;
  joined_at: string;
  last_active: string;
  is_host: boolean;
  user?: Pick<Profile, 'id' | 'display_name' | 'avatar_url'> | null;
}

export interface SignalMessage {
  id: number;
  room_id: string;
  sender_peer: string;
  target_peer: string | null;
  payload: { type: 'offer' | 'answer' | 'ice' | 'leave' | 'ping'; sdp?: string; candidate?: unknown };
  created_at: string;
}

export interface IncomingCallEvent {
  id: number;
  callee_id: string;
  caller_user_id: string;
  call_id: string;
  mode: CallMode;
  created_at: string;
  caller?: Pick<Profile, 'id' | 'display_name' | 'avatar_url'> | null;
}

export type Theme = 'light' | 'dark' | 'system';

export interface AppSettings {
  theme: Theme;
  notificationsEnabled: boolean;
  soundEnabled: boolean;
}

export type AuthUser = User;
