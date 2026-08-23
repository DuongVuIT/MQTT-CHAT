"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { api, type ApiConversation } from "@/lib/api";
import { normalizeMessage } from "@mqtt-chat/realtime-core";
import { getRealtimeService, type ConnectionState } from "@/lib/realtime-service";
import { useChatStore } from "@/store/chat-store";
import { loadStoredIdentity } from "@/lib/identity";
import { Sidebar } from "@/components/Sidebar";
import { MessageList } from "@/components/MessageList";
import { Composer } from "@/components/Composer";
import { DetailsPanel } from "@/components/DetailsPanel";
import { DiagnosticsPanel } from "@/components/DiagnosticsPanel";
import { ConnectionBadge } from "@mqtt-chat/ui";
import type { EventEnvelope } from "@mqtt-chat/mqtt-contracts";

/**
 * Main chat shell. Wires realtime events into the store and renders the
 * 3-column desktop layout (sidebar / conversation / details).
 */

export default function ChatPage() {
  const router = useRouter();
  const store = useChatStore();
  const bootstrapped = useRef(false);
  // Previous transport state — used to detect reconnect transitions
  // (reconnecting/disconnected → connected) and trigger state recovery.
  const prevConnectionState = useRef<ConnectionState | null>(null);

  // Bootstrap: identity → REST data → MQTT connect → subscriptions.
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    const identity = loadStoredIdentity();
    if (!identity) {
      router.replace("/");
      return;
    }
    // Identity switch hygiene: if a DIFFERENT user was active in this tab,
    // drop every identity-scoped transient state before syncing new data —
    // conversations/pending/typing/presence never leak across identities.
    const prev = useChatStore.getState().identity;
    if (prev && (prev.userId !== identity.userId || prev.deviceId !== identity.deviceId)) {
      useChatStore.getState().resetTransient();
    }
    store.setIdentity(identity);

    const realtime = getRealtimeService();
    // Handlers live for the page lifetime and are NOT unregistered on effect
    // cleanup: React StrictMode (dev) double-invokes effects, and the cleanup
    // of the first run would permanently detach them from the singleton
    // realtime service while the second run early-returns on the bootstrap
    // guard — leaving the UI stuck "Offline" and deaf to all events.
    realtime.onState((state: ConnectionState) => {
      const prevState = prevConnectionState.current;
      prevConnectionState.current = state;
      useChatStore.getState().setConnectionState(state);
      // Reconnect recovery: a drop (reconnecting/disconnected) that returns to
      // "connected" means canonical events were missed while offline. Refetch
      // the conversation list and the active conversation's messages so the
      // UI converges with the server WITHOUT a manual reload — and flush any
      // sends that were QUEUED while offline (same clientMessageId).
      if (state === "connected" && (prevState === "reconnecting" || prevState === "disconnected")) {
        flushQueuedMessages();
        void recoverAfterReconnect();
      }
    });
    realtime.onEvent((envelope: EventEnvelope) => {
      // NO captured identity: the active identity is read from the store at
      // event time so a user switch can never leave stale-perspective logic
      // bound to the singleton realtime service.
      handleEvent(envelope);
    });

    void (async () => {
      try {
        const [usersRes, convRes] = await Promise.all([
          api.listUsers(),
          api.listConversations(identity.userId),
        ]);
        const s = useChatStore.getState();
        s.setUsers(usersRes.users);
        s.setConversations(convRes.conversations);
        // Presence starts UNKNOWN for everyone — never assume offline.
        // Apply the server-authoritative snapshot once it arrives.
        try {
          const presenceRes = await api.getPresence(usersRes.users.map((u) => u.id));
          for (const [userId, info] of Object.entries(presenceRes.presence)) {
            s.setPresence(userId, info.online);
          }
        } catch {
          // Snapshot unavailable → leave presence unknown; realtime events
          // will refine it. Do NOT default to offline.
        }

        await realtime.connect(identity);
        realtime.subscribeGlobal(identity.userId);
        for (const c of convRes.conversations) realtime.subscribeConversation(c.id);
      } catch (error) {
        useChatStore
          .getState()
          .setError(error instanceof Error ? error.message : "Failed to initialize");
      }
    })();

    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrap once
  }, [router]);

  const activeId = store.activeConversationId;
  const activeConversation = store.conversations.find((c) => c.id === activeId) ?? null;

  // Peer-relative DIRECT label: A sees B's name, B sees A's name.
  const activeTitle = (() => {
    if (!activeConversation) return "";
    if (activeConversation.type === "GROUP") {
      return activeConversation.title ?? "Group";
    }
    const peerId = activeConversation.members?.find(
      (m) => m.userId !== store.identity?.userId,
    )?.userId;
    const peer = store.users.find((u) => u.id === peerId);
    return peer?.displayName ?? peerId ?? "Direct chat";
  })();

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        {activeConversation ? (
          <>
            <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div className="min-w-0">
                <h2 className="truncate font-semibold">{activeTitle}</h2>
                <p className="text-xs text-slate-500">
                  {activeConversation.type === "GROUP"
                    ? `${activeConversation.memberCount} members`
                    : "Direct conversation"}
                </p>
              </div>
              <ConnectionBadge state={store.connectionState} />
            </header>
            <MessageList conversationId={activeConversation.id} />
            <Composer conversationId={activeConversation.id} />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-slate-400">
            Select a conversation to start chatting
          </div>
        )}
      </main>
      <DetailsPanel conversation={activeConversation} />
      <DiagnosticsPanel />
    </div>
  );
}

/**
 * Flush messages that were QUEUED while offline. Republishes with the SAME
 * clientMessageId — chat-worker dedupes, so retries are idempotent.
 */
function flushQueuedMessages(): void {
  const s = useChatStore.getState();
  for (const p of s.pendingMessages) {
    if (p.status !== "queued") continue;
    s.retryPending(p.clientMessageId);
    getRealtimeService().publishCommand("message.send", {
      conversationId: p.conversationId,
      clientMessageId: p.clientMessageId,
      content: p.content.startsWith("📎") ? "" : p.content,
      type: p.content.startsWith("📎") ? "FILE" : "TEXT",
      replyToId: p.replyToId,
      metadata: null,
    });
  }
}

/** Route canonical events into the store. */
function handleEvent(envelope: EventEnvelope): void {
  const s = useChatStore.getState();
  // Perspective is ALWAYS derived from the active identity at event time.
  const selfUserId = s.identity?.userId ?? "";
  const data = envelope.data as Record<string, unknown>;
  const conversationId = envelope.conversationId ?? String(data["conversationId"] ?? "");

  /** Parse a canonical conversation summary into the REST list-item shape. */
  const toConversation = (): ApiConversation => {
    const rawMembers = Array.isArray(data["members"]) ? data["members"] : [];
    return {
      id: String(data["id"] ?? conversationId),
      type: (data["type"] as ApiConversation["type"]) ?? "GROUP",
      title: (data["title"] as string | null) ?? null,
      memberCount: Number(data["memberCount"] ?? rawMembers.length),
      lastSequence: Number(data["lastSequence"] ?? 0),
      lastMessagePreview: (data["lastMessagePreview"] as string | null) ?? null,
      lastMessageAt: (data["lastMessageAt"] as string | null) ?? null,
      members: rawMembers.map((m) => {
        const member = m as Record<string, unknown>;
        return {
          userId: String(member["userId"]),
          role: String(member["role"] ?? "MEMBER"),
          lastReadSequence: Number(member["lastReadSequence"] ?? 0),
        };
      }),
    };
  };

  switch (envelope.eventType) {
    case "conversation.created": {
      // Only conversations this user belongs to are relevant. The canonical
      // payload mirrors the REST list item, so it can be inserted directly —
      // the sidebar updates immediately, no refetch, no reload.
      const rawMembers = Array.isArray(data["members"]) ? data["members"] : [];
      const isMember = rawMembers.some((m) => (m as { userId?: unknown })["userId"] === selfUserId);
      if (!isMember) break;
      s.upsertConversation(toConversation());
      getRealtimeService().subscribeConversation(String(data["id"]));
      break;
    }
    case "conversation.member-joined":
    case "conversation.member-left": {
      // Membership changed — the payload carries the FULL post-change summary.
      // Only relevant if this user is (still) a member of the conversation.
      const conversation = toConversation();
      const stillMember =
        envelope.eventType === "conversation.member-joined"
          ? conversation.members.some((m) => m.userId === selfUserId)
          : // For a leave event, non-members keep nothing to update; if I was
            // the one removed, drop the entity entirely.
            String(data["removedUserId"]) !== selfUserId &&
            useChatStore.getState().conversations.some((c) => c.id === conversation.id);
      if (
        envelope.eventType === "conversation.member-left" &&
        String(data["removedUserId"]) === selfUserId
      ) {
        useChatStore
          .getState()
          .setConversations(
            useChatStore.getState().conversations.filter((c) => c.id !== conversation.id),
          );
        break;
      }
      if (!stillMember) break;
      // Preserve locally-known preview/sequence (event payload has no message info).
      const existingConv = useChatStore
        .getState()
        .conversations.find((c) => c.id === conversation.id);
      s.upsertConversation({
        ...conversation,
        lastMessagePreview: existingConv?.lastMessagePreview ?? conversation.lastMessagePreview,
        lastMessageAt: existingConv?.lastMessageAt ?? conversation.lastMessageAt,
        lastSequence: Math.max(existingConv?.lastSequence ?? 0, conversation.lastSequence),
      });
      break;
    }
    case "conversation.updated": {
      const updated = toConversation();
      const known = useChatStore.getState().conversations.find((c) => c.id === updated.id);
      if (!known && !updated.members.some((m) => m.userId === selfUserId)) break;
      s.upsertConversation({
        ...updated,
        lastMessagePreview: updated.lastMessagePreview ?? known?.lastMessagePreview ?? null,
        lastMessageAt: updated.lastMessageAt ?? known?.lastMessageAt ?? null,
        lastSequence: Math.max(known?.lastSequence ?? 0, updated.lastSequence),
      });
      break;
    }
    case "message.created": {
      // ONE canonical normalizer for every message entering the UI (shared
      // with mobile) — guarantees invariants (reactions array, null dates).
      const message = normalizeMessage(data);
      if (!message.id || !message.conversationId) break; // malformed — ignore
      const sequence = message.sequence;
      const type = message.type;
      const content = message.content;
      s.upsertMessage(message);
      // Keep the conversation list entry in sync (lastSequence/preview/time)
      // so every client converges on the same server-side sequence.
      const preview = type === "TEXT" ? content.slice(0, 120) : `[${type.toLowerCase()}]`;
      s.applyMessageActivity(conversationId, {
        sequence,
        preview: content ? preview : null,
        at: envelope.timestamp,
      });
      // Sequence-gap detection: a canonical event jumping beyond last+1 means
      // events were missed (offline window, broker drop). Fetch the missing
      // range from history and merge — never render a silent gap.
      const conv = useChatStore.getState().conversations.find((c) => c.id === conversationId);
      const lastKnown = conv?.lastSequence ?? 0;
      if (Number.isFinite(sequence) && sequence > lastKnown + 1) {
        void recoverSequenceGap(conversationId, lastKnown);
      }
      // Resolve optimistic pending send.
      const clientMessageId = String(data["clientMessageId"] ?? "");
      if (clientMessageId) s.resolvePending(clientMessageId);
      break;
    }
    case "message.edited":
      s.updateMessage(String(data["messageId"]), {
        content: String(data["content"]),
        editedAt: envelope.timestamp,
      });
      break;
    case "message.deleted":
      s.removeMessage(String(data["messageId"]));
      break;
    case "reaction.added":
      s.toggleReaction(String(data["messageId"]), String(data["emoji"]), String(data["userId"]));
      break;
    case "reaction.removed":
      s.toggleReaction(String(data["messageId"]), String(data["emoji"]), String(data["userId"]));
      break;
    case "receipt.read": {
      if (String(data["userId"]) === selfUserId) break;
      // Update member read state in conversation list.
      s.applyReadReceipt(conversationId, String(data["userId"]), Number(data["lastReadSequence"]));
      break;
    }
    case "typing.started":
      s.setTyping(conversationId, String(data["userId"]), true);
      break;
    case "typing.stopped":
      s.setTyping(conversationId, String(data["userId"]), false);
      break;
    case "presence.online":
      s.setPresence(String(data["userId"]), true);
      break;
    case "presence.offline":
      s.setPresence(String(data["userId"]), false);
      break;
    default:
      break;
  }
}

/** Guard against concurrent gap recovery for the same conversation. */
const gapRecovering = new Set<string>();

/**
 * Fetch messages after `afterSequence` and merge them into the store. Used
 * when a canonical event reveals a sequence gap (event.sequence > last+1).
 */
async function recoverSequenceGap(conversationId: string, afterSequence: number): Promise<void> {
  if (gapRecovering.has(conversationId)) return;
  gapRecovering.add(conversationId);
  try {
    const res = await api.getMessages(conversationId, { after: afterSequence, limit: 100 });
    const store = useChatStore.getState();
    for (const message of res.messages) store.upsertMessage(message);
  } catch {
    // Recovery failed — the next canonical event for this conversation will
    // retry; the UI never silently accepts a gap as final state.
  } finally {
    gapRecovering.delete(conversationId);
  }
}

/**
 * Refetch server state after an MQTT reconnect: conversation list (fresh
 * lastSequence/preview/unread) + active conversation messages. This heals
 * any events missed while the transport was down.
 */
async function recoverAfterReconnect(): Promise<void> {
  const { identity, activeConversationId } = useChatStore.getState();
  if (!identity) return;
  try {
    const convRes = await api.listConversations(identity.userId);
    const store = useChatStore.getState();
    store.setConversations(convRes.conversations);
    for (const c of convRes.conversations) getRealtimeService().subscribeConversation(c.id);
    if (activeConversationId) {
      const res = await api.getMessages(activeConversationId, { limit: 50 });
      useChatStore.getState().setMessages(activeConversationId, res.messages, res.hasMore);
    }
  } catch {
    // Transient — the next reconnect cycle retries recovery.
  }
}
