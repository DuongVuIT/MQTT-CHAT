/**
 * REST client for apps/api. History + setup only — realtime is MQTT.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Resolve a durable media storage key to a browser-fetchable URL.
 * Keys are resolved at READ time via the API's /uploads/view endpoint
 * (302 → short-lived presigned GET), so no fragile signed URL or dev-only
 * host is ever persisted in message metadata. Legacy metadata that stored
 * an absolute http(s) URL is passed through unchanged.
 */
export function mediaViewUrl(storageKey: string): string {
  if (/^https?:\/\//i.test(storageKey)) return storageKey;
  return `${API_URL}/uploads/view?key=${encodeURIComponent(storageKey)}`;
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
  presignUpload: (body: {
    conversationId: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
  }) =>
    request<{ uploadUrl: string; key: string }>("/uploads/presign", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  completeUpload: (body: { conversationId: string; key: string }) =>
    request<{ ok: boolean }>("/uploads/complete", { method: "POST", body: JSON.stringify(body) }),
};
