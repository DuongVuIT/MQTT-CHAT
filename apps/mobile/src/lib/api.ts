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
  type: 'TEXT' | 'IMAGE' | 'VIDEO' | 'FILE' | 'VOICE' | 'SYSTEM';
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
  /** Create a DIRECT (exactly 2 distinct ids) or GROUP conversation. */
  createConversation: (body: {
    type: 'DIRECT' | 'GROUP';
    title?: string;
    createdBy: string;
    memberIds: string[];
  }) =>
    request<{ conversation: ApiConversation }>('/conversations', {
      method: 'POST',
      body: JSON.stringify(body),
    }).then(r => r.conversation),
  /** Add members to a group — canonical member-joined reconciles clients. */
  addMembers: (conversationId: string, userIds: string[]) =>
    request<{ added: number }>(
      `/conversations/${encodeURIComponent(conversationId)}/members`,
      { method: 'POST', body: JSON.stringify({ userIds }) },
    ),
  /** Remove a member (canonical member-left reconciles clients). */
  removeMember: (conversationId: string, userId: string) =>
    request<{ removed: boolean }>(
      `/conversations/${encodeURIComponent(conversationId)}/members/${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    ),
  /**
   * Same-origin multipart upload → durable storageKey. Binary NEVER goes
   * through MQTT; the message carries only storage identity metadata.
   */
  uploadFile: async (
    file: { uri: string; name: string; type: string },
    conversationId: string,
  ): Promise<{
    key: string;
    filename: string;
    mimeType: string;
    size: number;
  }> => {
    const form = new FormData();
    form.append('conversationId', conversationId);
    // RN's FormData type accepts the {uri,name,type} asset part directly.
    form.append('file', {
      uri: file.uri,
      name: file.name,
      type: file.type,
    });
    // Two type systems describe FormData (RN vs fetch's BodyInit) — bridge
    // at this single boundary; the runtime accepts the RN asset part.
    const init = { method: 'POST', body: form } as unknown as RequestInit;
    const res = await fetch(`${API_BASE}/uploads`, init);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      throw new Error(body?.error?.message ?? `Upload failed (${res.status})`);
    }
    return (await res.json()) as {
      key: string;
      filename: string;
      mimeType: string;
      size: number;
    };
  },
};
