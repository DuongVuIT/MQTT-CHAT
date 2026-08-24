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
    // Surface the SERVER's reason (canonical error body is
    // { error: { code, message } }) — a raw "403: /path" tells the user
    // nothing. Falls back to the status+path when the body is not parseable.
    const body = (await res.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(body?.error?.message ?? `API ${res.status}: ${path}`);
  }
  return (await res.json()) as T;
}

export const api = {
  listUsers: () => request<{ users: ApiUser[] }>('/users').then(r => r.users),
  /** MUST pass the identity userId: without it the API returns EVERY user's
   * conversations (the server only filters when userId is present) — every
   * other user's DM with a peer rendered as a "duplicate" contact. */
  listConversations: (userId?: string) =>
    request<{ conversations: ApiConversation[] }>(
      `/conversations${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`,
    ).then(r => r.conversations),
  getMessages: (
    conversationId: string,
    opts?: { limit?: number; before?: number; after?: number },
  ) => {
    const params = new URLSearchParams();
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.before) params.set('before', String(opts.before));
    if (opts?.after) params.set('after', String(opts.after));
    const qs = params.toString();
    return request<{ messages: ApiMessage[]; hasMore: boolean }>(
      `/conversations/${encodeURIComponent(conversationId)}/messages${qs ? `?${qs}` : ''}`,
    );
  },
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
  /** Add members to a group (admin-only) — canonical member-joined. */
  addMembers: (
    conversationId: string,
    userIds: string[],
    actorUserId: string,
  ) =>
    request<{ added: number }>(
      `/conversations/${encodeURIComponent(conversationId)}/members?actor=${encodeURIComponent(actorUserId)}`,
      { method: 'POST', body: JSON.stringify({ userIds }) },
    ),
  /** Remove a member (admin) or self-leave — canonical member-left. */
  removeMember: (conversationId: string, userId: string, actorUserId: string) =>
    request<{ removed: boolean }>(
      `/conversations/${encodeURIComponent(conversationId)}/members/${encodeURIComponent(userId)}?actor=${encodeURIComponent(actorUserId)}`,
      { method: 'DELETE' },
    ),
  /**
   * Delete a GROUP (tombstone — canonical conversation.deleted reconciles
   * every member's client in realtime). Admin-only server-side (#38).
   */
  deleteConversation: (conversationId: string, actorUserId: string) =>
    request<{ deleted: boolean; absent?: boolean }>(
      `/conversations/${encodeURIComponent(conversationId)}?actor=${encodeURIComponent(actorUserId)}`,
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
