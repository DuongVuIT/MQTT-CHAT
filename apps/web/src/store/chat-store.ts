import { create } from "zustand";
import type { ApiConversation, ApiMessage, ApiUser } from "@/lib/api";
import type { ConnectionState } from "@/lib/realtime-service";

/**
 * Client chat state (zustand). Server remains the authority — this store is a
 * projection of canonical events + optimistic local sends.
 */

export interface PendingMessage {
  clientMessageId: string;
  conversationId: string;
  content: string;
  replyToId: string | null;
  /**
   * Canonical message type + media metadata, carried so RETRY republishes the
   * exact same logical message (repair-log #27: retry used to downgrade
   * replies to plain text and lose their target).
   */
  type?: string;
  metadata?: unknown;
  /** queued = offline, waiting for reconnect; pending = published, awaiting ack. */
  status: "queued" | "pending" | "failed";
}

/**
 * Build the exact `message.send` payload for re-publishing a pending entry —
 * shared by the manual RETRY button AND the offline-queue FLUSH so the two
 * paths cannot drift apart. Dropping `type`/`metadata` here would turn a
 * queued IMAGE/FILE into a metadata-less broken bubble on reconnect
 * (repair-log #34 wave follow-up: offline flush lost the storage key).
 * Pendings created before the `type` field existed keep the historical
 * 📎-content heuristic.
 */
export function republishPayload(p: PendingMessage): {
  conversationId: string;
  clientMessageId: string;
  content: string;
  type: string;
  replyToId: string | null;
  metadata: unknown;
} {
  return {
    conversationId: p.conversationId,
    clientMessageId: p.clientMessageId,
    content: p.type === undefined && p.content.startsWith("📎") ? "" : p.content,
    type: p.type ?? (p.content.startsWith("📎") ? "FILE" : "TEXT"),
    replyToId: p.replyToId,
    metadata: p.metadata ?? null,
  };
}

export interface ChatState {
  identity: { userId: string; deviceId: string } | null;
  users: ApiUser[];
  conversations: ApiConversation[];
  activeConversationId: string | null;
  messagesByConversation: Record<string, ApiMessage[]>;
  pendingMessages: PendingMessage[];
  typingUsers: Record<string, string[]>; // conversationId → userIds
  presence: Record<string, boolean>; // userId → online
  connectionState: ConnectionState;
  hasMoreHistory: Record<string, boolean>;
  loadingHistory: boolean;
  error: string | null;

  setIdentity: (identity: ChatState["identity"]) => void;
  /**
   * Identity switch hygiene: drop ALL identity-scoped transient state
   * (conversations, messages, pending sends, typing, presence) so nothing
   * leaks from the previous session into the new one.
   */
  resetTransient: () => void;
  setUsers: (users: ApiUser[]) => void;
  setConversations: (conversations: ApiConversation[]) => void;
  /** Insert or replace a conversation (canonical conversation.created / refetch). */
  upsertConversation: (conversation: ApiConversation) => void;
  /**
   * Reflect a canonical message.created onto the conversation list entry:
   * advance lastSequence (monotonic), preview, timestamp. Returns nothing —
   * gap detection reads state directly.
   */
  applyMessageActivity: (
    conversationId: string,
    opts: { sequence: number; preview: string | null; at: string },
  ) => void;
  setActiveConversation: (id: string | null) => void;
  /**
   * conversation.deleted (#28): drop EVERY trace — list entity, message
   * cache, pending sends, typing state — and close the chat if it was open.
   */
  removeConversation: (conversationId: string) => void;
  setMessages: (conversationId: string, messages: ApiMessage[], hasMore: boolean) => void;
  prependMessages: (conversationId: string, messages: ApiMessage[], hasMore: boolean) => void;
  upsertMessage: (message: ApiMessage) => void;
  addPending: (pending: PendingMessage) => void;
  resolvePending: (clientMessageId: string, message?: ApiMessage) => void;
  markPendingFailed: (clientMessageId: string) => void;
  /** Return a failed pending message to "pending" before re-publishing. */
  retryPending: (clientMessageId: string) => void;
  updateMessage: (messageId: string, patch: Partial<ApiMessage>, conversationId?: string) => void;
  removeMessage: (messageId: string, conversationId?: string) => void;
  /**
   * Apply a canonical reaction.added / reaction.removed event AUTHORITATIVELY:
   * the event type names the target state, so a QoS1 redelivery is a no-op —
   * never a flip (repair-log #31).
   */
  applyReaction: (
    messageId: string,
    emoji: string,
    userId: string,
    present: boolean,
    conversationId?: string,
  ) => void;
  setTyping: (conversationId: string, userId: string, isTyping: boolean) => void;
  setPresence: (userId: string, online: boolean) => void;
  /** Update a member's read watermark; tolerates conversations missing `members`. */
  applyReadReceipt: (conversationId: string, userId: string, lastReadSequence: number) => void;
  setConnectionState: (state: ConnectionState) => void;
  setLoadingHistory: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

const sortMessages = (messages: ApiMessage[]): ApiMessage[] =>
  [...messages].sort((a, b) => a.sequence - b.sequence);

/**
 * Authoritative reaction state for ONE message list. The canonical event type
 * names the TARGET STATE (added ⇒ present, removed ⇒ absent), so applying the
 * same event twice is a no-op — QoS1 redelivery must never flip state.
 */
function applyReactionPresenceList(
  list: ApiMessage[],
  messageId: string,
  emoji: string,
  userId: string,
  present: boolean,
): ApiMessage[] {
  return list.map((m) => {
    if (m.id !== messageId) return m;
    // Defensive: reactions is contractually an array, but a malformed
    // row must not crash the whole store update.
    const reactions = m.reactions ?? [];
    const exists = reactions.some((r) => r.emoji === emoji && r.userId === userId);
    if (exists === present) return m; // already in target state — idempotent
    return {
      ...m,
      reactions: present
        ? [...reactions, { emoji, userId }]
        : reactions.filter((r) => !(r.emoji === emoji && r.userId === userId)),
    };
  });
}

function applyReactionPresence(
  cache: Record<string, ApiMessage[]>,
  conversationId: string | undefined,
  messageId: string,
  emoji: string,
  userId: string,
  present: boolean,
): Record<string, ApiMessage[]> {
  if (conversationId && cache[conversationId]) {
    return {
      ...cache,
      [conversationId]: applyReactionPresenceList(
        cache[conversationId],
        messageId,
        emoji,
        userId,
        present,
      ),
    };
  }
  const out: Record<string, ApiMessage[]> = {};
  for (const [cid, list] of Object.entries(cache)) {
    out[cid] = applyReactionPresenceList(list, messageId, emoji, userId, present);
  }
  return out;
}

export const useChatStore = create<ChatState>((set) => ({
  identity: null,
  users: [],
  conversations: [],
  activeConversationId: null,
  messagesByConversation: {},
  pendingMessages: [],
  typingUsers: {},
  presence: {},
  connectionState: "disconnected",
  hasMoreHistory: {},
  loadingHistory: false,
  error: null,

  setIdentity: (identity) => set({ identity }),
  resetTransient: () =>
    set({
      conversations: [],
      activeConversationId: null,
      messagesByConversation: {},
      pendingMessages: [],
      typingUsers: {},
      presence: {},
      hasMoreHistory: {},
      loadingHistory: false,
      error: null,
    }),
  setUsers: (users) => set({ users }),
  setConversations: (conversations) => set({ conversations }),
  upsertConversation: (conversation) =>
    set((s) => {
      const exists = s.conversations.some((c) => c.id === conversation.id);
      return {
        conversations: exists
          ? s.conversations.map((c) => (c.id === conversation.id ? conversation : c))
          : [conversation, ...s.conversations],
      };
    }),
  applyMessageActivity: (conversationId, { sequence, preview, at }) =>
    set((s) => ({
      conversations: s.conversations.map((c) => {
        if (c.id !== conversationId) return c;
        // Sequence is monotonic per conversation: never regress.
        if (sequence <= c.lastSequence) return c;
        return {
          ...c,
          lastSequence: sequence,
          lastMessagePreview: preview,
          lastMessageAt: at,
        };
      }),
    })),
  setActiveConversation: (id) => set({ activeConversationId: id }),

  removeConversation: (conversationId) =>
    set((s) => {
      const next: Partial<ChatState> = {
        conversations: s.conversations.filter((c) => c.id !== conversationId),
        messagesByConversation: Object.fromEntries(
          Object.entries(s.messagesByConversation).filter(([cid]) => cid !== conversationId),
        ),
        pendingMessages: s.pendingMessages.filter((p) => p.conversationId !== conversationId),
        typingUsers: Object.fromEntries(
          Object.entries(s.typingUsers).filter(([cid]) => cid !== conversationId),
        ),
      };
      if (s.activeConversationId === conversationId) next.activeConversationId = null;
      return next;
    }),

  setMessages: (conversationId, messages, hasMore) =>
    set((s) => ({
      messagesByConversation: {
        ...s.messagesByConversation,
        [conversationId]: sortMessages(messages),
      },
      hasMoreHistory: { ...s.hasMoreHistory, [conversationId]: hasMore },
    })),

  prependMessages: (conversationId, messages, hasMore) =>
    set((s) => {
      const existing = s.messagesByConversation[conversationId] ?? [];
      const known = new Set(existing.map((m) => m.id));
      const merged = sortMessages([...existing, ...messages.filter((m) => !known.has(m.id))]);
      return {
        messagesByConversation: {
          ...s.messagesByConversation,
          [conversationId]: merged,
        },
        hasMoreHistory: { ...s.hasMoreHistory, [conversationId]: hasMore },
      };
    }),

  upsertMessage: (message) =>
    set((s) => {
      const list = s.messagesByConversation[message.conversationId] ?? [];
      if (list.some((m) => m.id === message.id)) {
        return {
          messagesByConversation: {
            ...s.messagesByConversation,
            [message.conversationId]: list.map((m) => (m.id === message.id ? message : m)),
          },
        };
      }
      return {
        messagesByConversation: {
          ...s.messagesByConversation,
          [message.conversationId]: sortMessages([...list, message]),
        },
      };
    }),

  addPending: (pending) => set((s) => ({ pendingMessages: [...s.pendingMessages, pending] })),

  resolvePending: (clientMessageId) =>
    set((s) => ({
      pendingMessages: s.pendingMessages.filter((p) => p.clientMessageId !== clientMessageId),
    })),

  markPendingFailed: (clientMessageId) =>
    set((s) => ({
      pendingMessages: s.pendingMessages.map((p) =>
        p.clientMessageId === clientMessageId ? { ...p, status: "failed" as const } : p,
      ),
    })),

  retryPending: (clientMessageId) =>
    set((s) => ({
      pendingMessages: s.pendingMessages.map((p) =>
        p.clientMessageId === clientMessageId ? { ...p, status: "pending" as const } : p,
      ),
    })),

  /**
   * PERF: when `conversationId` is supplied the mutation touches exactly ONE
   * cached list; every other conversation keeps its array reference, so memo
   * rows and per-conversation subscriptions do not invalidate. Without it the
   * (slower) whole-cache scan applies — callers should pass the id when the
   * canonical event carries one.
   */
  updateMessage: (messageId, patch, conversationId?) =>
    set((s) => ({
      messagesByConversation:
        conversationId && s.messagesByConversation[conversationId]
          ? {
              ...s.messagesByConversation,
              [conversationId]: s.messagesByConversation[conversationId].map((m) =>
                m.id === messageId ? { ...m, ...patch } : m,
              ),
            }
          : Object.fromEntries(
              Object.entries(s.messagesByConversation).map(([cid, list]) => [
                cid,
                list.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
              ]),
            ),
    })),

  removeMessage: (messageId, conversationId?) =>
    set((s) => ({
      messagesByConversation:
        conversationId && s.messagesByConversation[conversationId]
          ? {
              ...s.messagesByConversation,
              [conversationId]: s.messagesByConversation[conversationId].map((m) =>
                m.id === messageId ? { ...m, deletedAt: new Date().toISOString(), content: "" } : m,
              ),
            }
          : Object.fromEntries(
              Object.entries(s.messagesByConversation).map(([cid, list]) => [
                cid,
                list.map((m) =>
                  m.id === messageId
                    ? { ...m, deletedAt: new Date().toISOString(), content: "" }
                    : m,
                ),
              ]),
            ),
    })),

  applyReaction: (messageId, emoji, userId, present, conversationId?) =>
    set((s) => ({
      messagesByConversation: applyReactionPresence(
        s.messagesByConversation,
        conversationId,
        messageId,
        emoji,
        userId,
        present,
      ),
    })),

  setTyping: (conversationId, userId, isTyping) =>
    set((s) => {
      const current = s.typingUsers[conversationId] ?? [];
      const next = isTyping
        ? current.includes(userId)
          ? current
          : [...current, userId]
        : current.filter((u) => u !== userId);
      return { typingUsers: { ...s.typingUsers, [conversationId]: next } };
    }),

  setPresence: (userId, online) => set((s) => ({ presence: { ...s.presence, [userId]: online } })),

  applyReadReceipt: (conversationId, userId, lastReadSequence) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              // Defensive: a conversation payload missing `members` (stale or
              // incomplete API response) must not crash the event handler.
              members: (c.members ?? []).map((m) =>
                m.userId === userId ? { ...m, lastReadSequence } : m,
              ),
            }
          : c,
      ),
    })),

  setConnectionState: (connectionState) => set({ connectionState }),
  setLoadingHistory: (loadingHistory) => set({ loadingHistory }),
  setError: (error) => set({ error }),
}));
