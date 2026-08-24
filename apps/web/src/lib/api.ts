/**
 * REST client for apps/api. History + setup only — realtime is MQTT.
 *
 * SINGLE PUBLIC ORIGIN: all requests go to same-origin relative paths
 * (`/api/...`, `/media?...`) which the public gateway on :3000 proxies to
 * internal services. The browser never talks to internal ports directly.
 * `NEXT_PUBLIC_API_URL` may override for exotic deployments.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api";

/**
 * Resolve a durable media storage key to a browser-fetchable URL.
 * Canonical public path: GET /media?key=<storage-key> — the gateway routes
 * it to the API's streaming media handler, so no object-storage host or
 * signed URL ever reaches browser code or message metadata. Legacy metadata
 * that stored an absolute http(s) URL is passed through unchanged.
 */
export function mediaViewUrl(storageKey: string): string {
  if (/^https?:\/\//i.test(storageKey)) return storageKey;
  return `/media?key=${encodeURIComponent(storageKey)}`;
}

export interface ApiUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface ApiConversation {
  id: string;
  type: "DIRECT" | "GROUP";
  title: string | null;
  memberCount: number;
  lastSequence: number;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  members: Array<{ userId: string; role: string; lastReadSequence: number }>;
}

export interface ApiMessage {
  id: string;
  clientMessageId: string;
  conversationId: string;
  senderId: string;
  senderType: "USER" | "BOT" | "SYSTEM";
  senderName: string;
  sequence: number;
  type: "TEXT" | "IMAGE" | "VIDEO" | "FILE" | "VOICE" | "SYSTEM";
  content: string;
  replyToId: string | null;
  metadata: Record<string, unknown> | null;
  reactions: Array<{ emoji: string; userId: string }>;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(body?.error?.message ?? `API error ${response.status}`);
  }
  return (await response.json()) as T;
}

export interface ApiPresenceInfo {
  online: boolean;
  connectionCount: number;
  devices: string[];
}

export const api = {
  listUsers: () => request<{ users: ApiUser[] }>("/users"),
  getPresence: (userIds: string[]) =>
    request<{ presence: Record<string, ApiPresenceInfo> }>(
      `/presence?userIds=${encodeURIComponent(userIds.join(","))}`,
    ),
  listConversations: (userId: string) =>
    request<{ conversations: ApiConversation[] }>(
      `/conversations?userId=${encodeURIComponent(userId)}`,
    ),
  createConversation: (body: {
    type: "DIRECT" | "GROUP";
    title?: string;
    createdBy: string;
    memberIds: string[];
  }) =>
    request<{ conversation: ApiConversation }>("/conversations", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  addMembers: (conversationId: string, userIds: string[], actorUserId: string) =>
    request<{ added: number }>(
      `/conversations/${conversationId}/members?actor=${encodeURIComponent(actorUserId)}`,
      {
        method: "POST",
        body: JSON.stringify({ userIds }),
      },
    ),
  /** Remove another member (admin) or leave self — canonical member-left. */
  removeMember: (conversationId: string, userId: string, actorUserId: string) =>
    request<{ removed: boolean }>(
      `/conversations/${conversationId}/members/${encodeURIComponent(userId)}?actor=${encodeURIComponent(actorUserId)}`,
      { method: "DELETE" },
    ),
  /** Delete a GROUP (tombstone; admin-only). Canonical event reconciles all. */
  deleteGroup: (conversationId: string, actorUserId: string) =>
    request<{ deleted: boolean }>(
      `/conversations/${conversationId}?actor=${encodeURIComponent(actorUserId)}`,
      { method: "DELETE" },
    ),
  getMessages: (
    conversationId: string,
    opts?: { before?: number; after?: number; limit?: number },
  ) => {
    const params = new URLSearchParams();
    if (opts?.before) params.set("before", String(opts.before));
    if (opts?.after) params.set("after", String(opts.after));
    params.set("limit", String(opts?.limit ?? 50));
    return request<{ messages: ApiMessage[]; hasMore: boolean }>(
      `/conversations/${conversationId}/messages?${params.toString()}`,
    );
  },
  /**
   * Upload a file through the same origin: POST /api/uploads (multipart) —
   * the API streams it into object storage server-side and returns the
   * durable storage key. No presigned URL / storage host touches the browser.
   */
  uploadFile: async (file: File, conversationId: string): Promise<{ key: string }> => {
    const form = new FormData();
    form.append("conversationId", conversationId);
    form.append("file", file);
    const response = await fetch(`${API_URL}/uploads`, { method: "POST", body: form });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      throw new Error(body?.error?.message ?? `Upload failed (${response.status})`);
    }
    return (await response.json()) as { key: string };
  },
};
