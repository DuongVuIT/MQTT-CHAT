"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { api, type ApiConversation, type ApiMessage } from "@/lib/api";
import { getRealtimeService, type ConnectionState } from "@/lib/realtime-service";
import { useChatStore } from "@/store/chat-store";
import { loadStoredIdentity } from "@/lib/identity";
import { Sidebar } from "@/components/Sidebar";
import { MessageList } from "@/components/MessageList";
import { Composer } from "@/components/Composer";
import { DetailsPanel } from "@/components/DetailsPanel";
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
    store.setIdentity(identity);

    const realtime = getRealtimeService();
    // Handlers live for the page lifetime and are NOT unregistered on effect
    // cleanup: React StrictMode (dev) double-invokes effects, and the cleanup
    // of the first run would permanently detach them from the singleton
    // realtime service while the second run early-returns on the bootstrap
    // guard — leaving the UI stuck "Offline" and deaf to all events.
    realtime.onState((state: ConnectionState) => {
      const prev = prevConnectionState.current;
      prevConnectionState.current = state;
      useChatStore.getState().setConnectionState(state);
      // Reconnect recovery: a drop (reconnecting/disconnected) that returns to
      // "connected" means canonical events were missed while offline. Refetch
      // the conversation list and the active conversation's messages so the
      // UI converges with the server WITHOUT a manual reload.
      if (state === "connected" && (prev === "reconnecting" || prev === "disconnected")) {
        void recoverAfterReconnect();
      }
    });
    realtime.onEvent((envelope: EventEnvelope) => {
      handleEvent(envelope, identity.userId);
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

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        {activeConversation ? (
          <>
            <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <div className="min-w-0">
                <h2 className="truncate font-semibold">
                  {activeConversation.title ?? "Direct chat"}
                </h2>
                <p className="text-xs text-slate-500">{activeConversation.memberCount} members</p>
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
    </div>
  );
}

/** Route canonical events into the store. */
function handleEvent(envelope: EventEnvelope, selfUserId: string): void {
  const s = useChatStore.getState();
  const data = envelope.data as Record<string, unknown>;
  const conversationId = envelope.conversationId ?? String(data["conversationId"] ?? "");

  switch (envelope.eventType) {
    case "conversation.created": {
      // Only conversations this user belongs to are relevant. The canonical
      // payload mirrors the REST list item, so it can be inserted directly —
      // the sidebar updates immediately, no refetch, no reload.
      const rawMembers = Array.isArray(data["members"]) ? data["members"] : [];
      const isMember = rawMembers.some((m) => (m as { userId?: unknown })["userId"] === selfUserId);
      if (!isMember) break;
      const conversation: ApiConversation = {
        id: String(data["id"]),
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
      s.upsertConversation(conversation);
      getRealtimeService().subscribeConversation(conversation.id);
      break;
    }
    case "message.created": {
      const sequence = Number(data["sequence"]);
      const type = (data["type"] as ApiMessage["type"]) ?? "TEXT";
      const content = String(data["content"] ?? "");
      s.upsertMessage({
        id: String(data["messageId"]),
        clientMessageId: String(data["clientMessageId"] ?? ""),
        conversationId,
        senderId: String(data["senderId"]),
        senderType: (data["senderType"] as "USER" | "BOT" | "SYSTEM") ?? "USER",
        senderName: String(data["senderName"] ?? data["senderId"]),
        sequence,
        type,
        content,
        replyToId: (data["replyToId"] as string | null) ?? null,
        metadata: (data["metadata"] as Record<string, unknown> | null) ?? null,
        reactions: [],
        createdAt: envelope.timestamp,
        editedAt: null,
        deletedAt: null,
      });
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
