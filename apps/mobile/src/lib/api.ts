/**
 * REST client for the chat API. Base URL is platform-aware
 * (iOS Simulator → localhost, Android emulator → 10.0.2.2) —
 * see lib/config.ts.
 */

import { API_BASE } from './config';

export { API_BASE };

export interface ApiUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface ApiConversationMember {
  userId: string;
  role: string;
  lastReadSequence: number;
}

export interface ApiConversation {
  id: string;
  type: 'DIRECT' | 'GROUP';
  title: string | null;
  memberCount?: number;
  lastSequence?: number;
  lastMessagePreview?: string | null;
  lastMessageAt?: string | null;
  members: ApiConversationMember[];
}

export interface ApiMessage {
  id: string;
  clientMessageId: string;
  conversationId: string;
  senderId: string;
  senderType: 'USER' | 'BOT' | 'SYSTEM';
  senderName: string;
  sequence: number;
  type: 'TEXT' | 'IMAGE' | 'FILE';
  content: string;
  replyToId: string | null;
  metadata: unknown;
  reactions: { emoji: string; userId: string }[];
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${path}`);
  }
  return (await res.json()) as T;
}

export const api = {
  listUsers: () => request<{ users: ApiUser[] }>('/users').then(r => r.users),
  listConversations: () =>
    request<{ conversations: ApiConversation[] }>('/conversations').then(
      r => r.conversations,
    ),
  getMessages: (conversationId: string, limit = 50) =>
    request<{ messages: ApiMessage[]; hasMore: boolean }>(
      `/conversations/${encodeURIComponent(conversationId)}/messages?limit=${limit}`,
    ),
  getPresence: (userIds: string[]) =>
    request<{
      presence: Record<string, { online: boolean; connectionCount: number }>;
    }>(`/presence?userIds=${encodeURIComponent(userIds.join(','))}`).then(
      r => r.presence,
    ),
};
