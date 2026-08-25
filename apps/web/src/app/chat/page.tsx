"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChatMarkIcon, InfoIcon, MenuIcon } from "@/components/icons";
import { api, type ApiConversation, type ApiMessage } from "@/lib/api";
import { normalizeConversation, normalizeMessage } from "@mqtt-chat/realtime-core";
import { getRealtimeService, type ConnectionState } from "@/lib/realtime-service";
import { republishPayload, useChatStore } from "@/store/chat-store";
import { loadStoredIdentity } from "@/lib/identity";
import { applyCanonicalReadReceipt } from "@/lib/canonical-events";
import { Sidebar } from "@/components/Sidebar";
import { MessageList } from "@/components/MessageList";
import { Composer } from "@/components/Composer";
import { DetailsPanel } from "@/components/DetailsPanel";
import { ErrorBanner } from "@/components/ErrorBanner";
import { DiagnosticsPanel } from "@/components/DiagnosticsPanel";
import { Avatar, ConnectionBadge } from "@mqtt-chat/ui";
import type { EventEnvelope } from "@mqtt-chat/mqtt-contracts";

export default function ChatPage() {
  const router = useRouter();
  const activeConversationId = useChatStore((state) => state.activeConversationId);
  const activeConversation = useChatStore(
    (state) =>
      state.conversations.find((conversation) => conversation.id === state.activeConversationId) ??
      null,
  );
  const identityUserId = useChatStore((state) => state.identity?.userId);
  const users = useChatStore((state) => state.users);
  const connectionState = useChatStore((state) => state.connectionState);
  const prevConnectionState = useRef<ConnectionState | null>(null);
  const [replyTo, setReplyTo] = useState<ApiMessage | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  useEffect(() => {
    setReplyTo(null);
    setIsSidebarOpen(false);
    setIsDetailsOpen(false);
  }, [activeConversationId]);

  // Subscribe first, then install the REST snapshot, then replay events that
  // arrived while the snapshot was in flight. This closes both bootstrap
  // races: fetch→subscribe event loss and stale REST overwriting live state.
  useEffect(() => {
    const identity = loadStoredIdentity();
    if (!identity) {
      router.replace("/");
      return;
    }
    // Identity switch hygiene: if a DIFFERENT user was active in this tab,
    // drop every identity-scoped transient state before syncing new data —
    // conversations/pending/typing/presence never leak across identities.
    const previousIdentity = useChatStore.getState().identity;
    if (
      previousIdentity &&
      (previousIdentity.userId !== identity.userId ||
        previousIdentity.deviceId !== identity.deviceId)
    ) {
      useChatStore.getState().resetTransient();
    }
    useChatStore.getState().setIdentity(identity);

    const realtime = getRealtimeService();
    let cancelled = false;
    let buffering = true;
    let initialSnapshotReady = false;
    const bufferedEvents: EventEnvelope[] = [];
    const replayBufferedEvents = (): void => {
      buffering = false;
      for (const envelope of bufferedEvents.splice(0)) handleEvent(envelope);
    };
    const unsubscribeState = realtime.onState((state: ConnectionState) => {
      const prevState = prevConnectionState.current;
      prevConnectionState.current = state;
      useChatStore.getState().setConnectionState(state);
      if (state === "reconnecting" || state === "disconnected") buffering = true;
      // Reconnect recovery: a drop (reconnecting/disconnected) that returns to
      // "connected" means canonical events were missed while offline. Refetch
      // the conversation list and the active conversation's messages so the
      // UI converges with the server WITHOUT a manual reload — and flush any
      // sends that were QUEUED while offline (same clientMessageId).
      if (
        initialSnapshotReady &&
        state === "connected" &&
        (prevState === "reconnecting" || prevState === "disconnected")
      ) {
        flushQueuedMessages();
        void recoverAfterReconnect().finally(() => {
          if (!cancelled) replayBufferedEvents();
        });
      }
    });
    const unsubscribeEvent = realtime.onEvent((envelope: EventEnvelope) => {
      if (buffering) bufferedEvents.push(envelope);
      else handleEvent(envelope);
    });

    void (async () => {
      try {
        // connect() resolves only after SUBACK for canonical + user topics.
        await realtime.connect(identity);
        if (cancelled) return;
        const [usersResponse, conversationsResponse] = await Promise.all([
          api.listUsers(),
          api.listConversations(identity.userId),
        ]);
        if (cancelled) return;
        const store = useChatStore.getState();
        store.setUsers(usersResponse.users);
        store.setConversations(conversationsResponse.conversations);
        store.setConversationsLoaded(true);
        // Presence starts UNKNOWN for everyone — never assume offline.
        // Apply the server-authoritative snapshot once it arrives.
        try {
          const presenceResponse = await api.getPresence(
            usersResponse.users.map((user) => user.id),
          );
          for (const [userId, presenceInfo] of Object.entries(presenceResponse.presence)) {
            store.setPresence(userId, presenceInfo.online);
          }
        } catch {
          // Snapshot unavailable → leave presence unknown; realtime events
          // will refine it. Do NOT default to offline.
        }

        realtime.subscribeGlobal(identity.userId);
        for (const conversation of conversationsResponse.conversations) {
          realtime.subscribeConversation(conversation.id);
        }
        initialSnapshotReady = true;
        replayBufferedEvents();
      } catch (error) {
        if (!cancelled) {
          useChatStore
            .getState()
            .setError(error instanceof Error ? error.message : "Failed to initialize");
        }
      }
    })();

    return () => {
      cancelled = true;
      buffering = false;
      bufferedEvents.length = 0;
      unsubscribeEvent();
      unsubscribeState();
      prevConnectionState.current = null;
      void realtime.disconnect();
      useChatStore.getState().resetTransient();
    };
  }, [router]);

  const activePeerId =
    activeConversation?.type === "DIRECT"
      ? activeConversation.members?.find((member) => member.userId !== identityUserId)?.userId
      : undefined;

  // Peer-relative DIRECT label: A sees B's name, B sees A's name.
  const activeTitle = (() => {
    if (!activeConversation) return "";
    if (activeConversation.type === "GROUP") {
      return activeConversation.title ?? "Group";
    }
    const peer = users.find((user) => user.id === activePeerId);
    return peer?.displayName ?? activePeerId ?? "Direct chat";
  })();

  const activeSubtitle = activeConversation
    ? activeConversation.type === "GROUP"
      ? `${activeConversation.memberCount} members`
      : "Direct message"
    : "";
  const headerAvatarName =
    activeConversation?.type === "GROUP"
      ? (activeConversation.title ?? "Group")
      : activeTitle || "?";
  // DIRECT avatars represent the peer user; GROUP avatars represent the room.
  const headerAvatarKey =
    activeConversation?.type === "DIRECT"
      ? (activePeerId ?? activeConversation.id)
      : (activeConversation?.id ?? "?");

  return (
    <div className="relative flex h-screen overflow-hidden bg-app">
      <div className="hidden md:flex">
        <Sidebar />
      </div>
      {isSidebarOpen && (
        <div
          className="absolute inset-0 z-40 flex md:hidden"
          role="dialog"
          aria-label="Conversations"
        >
          <div className="flex h-full">
            <Sidebar />
          </div>
          <button
            type="button"
            aria-label="Close conversations"
            className="flex-1 bg-scrim"
            onClick={() => setIsSidebarOpen(false)}
          />
        </div>
      )}

      <main className="relative flex min-w-0 flex-1 flex-col bg-app/70">
        {activeConversation ? (
          <>
            <header className="glass-surface z-20 flex min-h-16 items-center justify-between gap-3 border-b border-line px-4 md:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  aria-label="Open conversations"
                  onClick={() => setIsSidebarOpen(true)}
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-2 transition-colors duration-fast hover:bg-raised hover:text-ink md:hidden"
                >
                  <MenuIcon className="h-5 w-5" />
                </button>
                <Avatar name={headerAvatarName} colorKey={headerAvatarKey} size="md" />
                <div className="min-w-0">
                  <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em]">
                    {activeTitle}
                  </h2>
                  <p className="truncate text-xs text-ink-2">{activeSubtitle}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <ConnectionBadge state={connectionState} />
                <button
                  type="button"
                  aria-label="Show conversation details"
                  onClick={() => setIsDetailsOpen(true)}
                  className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-raised/70 text-ink-2 transition-colors duration-fast hover:border-brand/50 hover:bg-high hover:text-ink lg:hidden"
                >
                  <InfoIcon className="h-5 w-5" />
                </button>
              </div>
            </header>
            <MessageList conversationId={activeConversation.id} onRequestReply={setReplyTo} />
            <Composer
              conversationId={activeConversation.id}
              replyTo={replyTo}
              onCancelReply={() => setReplyTo(null)}
            />
          </>
        ) : (
          <>
            <header className="glass-surface flex min-h-16 items-center gap-3 border-b border-line px-4 md:hidden">
              <button
                type="button"
                aria-label="Open conversations"
                onClick={() => setIsSidebarOpen(true)}
                className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-2 hover:bg-raised hover:text-ink"
              >
                <MenuIcon className="h-5 w-5" />
              </button>
              <h2 className="text-[15px] font-semibold">Messages</h2>
            </header>
            <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
              <span className="flex h-20 w-20 items-center justify-center rounded-[24px] border border-line bg-surface text-brand-strong shadow-panel">
                <ChatMarkIcon className="h-9 w-9" />
              </span>
              <p className="mt-5 text-base font-semibold">Your conversations live here</p>
              <p className="mt-2 max-w-sm text-sm leading-6 text-ink-2">
                Choose a chat from the sidebar or create a new conversation to get started.
              </p>
            </div>
          </>
        )}
      </main>

      <div className="hidden lg:flex">
        <DetailsPanel conversation={activeConversation} />
      </div>
      {isDetailsOpen && activeConversation && (
        <div className="absolute inset-0 z-40 flex lg:hidden" role="dialog" aria-label="Details">
          <div className="flex h-full">
            <DetailsPanel
              conversation={activeConversation}
              onClose={() => setIsDetailsOpen(false)}
            />
          </div>
          <button
            type="button"
            aria-label="Close details"
            className="flex-1 bg-scrim"
            onClick={() => setIsDetailsOpen(false)}
          />
        </div>
      )}

      <DiagnosticsPanel />
      <ErrorBanner />
    </div>
  );
}

/**
 * Flush messages that were QUEUED while offline. Republishes with the SAME
 * clientMessageId — chat-worker dedupes, so retries are idempotent — and the
 * SAME logical payload via republishPayload: a queued IMAGE/FILE must come
 * back with its type + storage-key metadata intact, not downgraded to a
 * metadata-less FILE bubble.
 */
function flushQueuedMessages(): void {
  const store = useChatStore.getState();
  for (const pendingMessage of store.pendingMessages) {
    if (pendingMessage.status !== "queued") continue;
    store.retryPending(pendingMessage.clientMessageId);
    getRealtimeService().publishCommand("message.send", republishPayload(pendingMessage));
  }
}

/** Route canonical events into the store. */
function handleEvent(envelope: EventEnvelope): void {
  const store = useChatStore.getState();
  // Perspective is ALWAYS derived from the active identity at event time.
  const selfUserId = store.identity?.userId ?? "";
  const data = envelope.data as Record<string, unknown>;
  const conversationId = envelope.conversationId ?? String(data["conversationId"] ?? "");

  /** ONE shared normalizer for every conversation entering the web UI. */
  const toConversation = (): ApiConversation => {
    const conversation = normalizeConversation({ ...data, id: data["id"] ?? conversationId });
    return conversation;
  };

  switch (envelope.eventType) {
    case "conversation.created": {
      // Only conversations this user belongs to are relevant. The canonical
      // payload mirrors the REST list item, so it can be inserted directly —
      // the sidebar updates immediately, no refetch, no reload.
      const rawMembers = Array.isArray(data["members"]) ? data["members"] : [];
      const isMember = rawMembers.some(
        (member) => (member as { userId?: unknown })["userId"] === selfUserId,
      );
      if (!isMember) break;
      store.upsertConversation(toConversation());
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
          ? conversation.members.some((member) => member.userId === selfUserId)
          : // For a leave event, non-members keep nothing to update; if I was
            // the one removed, drop the entity entirely.
            String(data["removedUserId"]) !== selfUserId &&
            useChatStore
              .getState()
              .conversations.some((candidate) => candidate.id === conversation.id);
      if (
        envelope.eventType === "conversation.member-left" &&
        String(data["removedUserId"]) === selfUserId
      ) {
        useChatStore
          .getState()
          .setConversations(
            useChatStore
              .getState()
              .conversations.filter((candidate) => candidate.id !== conversation.id),
          );
        break;
      }
      if (!stillMember) break;
      // Preserve locally-known preview/sequence (event payload has no message info).
      const existingConversation = useChatStore
        .getState()
        .conversations.find((candidate) => candidate.id === conversation.id);
      store.upsertConversation({
        ...conversation,
        lastMessagePreview:
          existingConversation?.lastMessagePreview ?? conversation.lastMessagePreview,
        lastMessageAt: existingConversation?.lastMessageAt ?? conversation.lastMessageAt,
        lastSequence: Math.max(existingConversation?.lastSequence ?? 0, conversation.lastSequence),
      });
      break;
    }
    case "conversation.updated": {
      const updatedConversation = toConversation();
      const knownConversation = useChatStore
        .getState()
        .conversations.find((candidate) => candidate.id === updatedConversation.id);
      if (
        !knownConversation &&
        !updatedConversation.members.some((member) => member.userId === selfUserId)
      ) {
        break;
      }
      store.upsertConversation({
        ...updatedConversation,
        lastMessagePreview:
          updatedConversation.lastMessagePreview ?? knownConversation?.lastMessagePreview ?? null,
        lastMessageAt:
          updatedConversation.lastMessageAt ?? knownConversation?.lastMessageAt ?? null,
        lastSequence: Math.max(
          knownConversation?.lastSequence ?? 0,
          updatedConversation.lastSequence,
        ),
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
      // Sequence-gap detection must read the watermark BEFORE the store
      // advances it — reading `lastKnown` after applyMessageActivity made
      // `sequence > lastKnown + 1` unreachable (dead recovery path, audit
      // P0). Capture first, apply, then heal if the event jumped a gap.
      const conversationBeforeEvent = useChatStore
        .getState()
        .conversations.find((candidate) => candidate.id === conversationId);
      const lastKnownBefore = Math.max(
        conversationBeforeEvent?.lastSequence ?? 0,
        lastKnownByMessages(conversationId),
      );
      store.upsertMessage(message);
      // Keep the conversation list entry in sync (lastSequence/preview/time)
      // so every client converges on the same server-side sequence.
      const preview = type === "TEXT" ? content.slice(0, 120) : `[${type.toLowerCase()}]`;
      store.applyMessageActivity(conversationId, {
        sequence,
        preview: content ? preview : null,
        at: envelope.timestamp,
      });
      if (Number.isFinite(sequence) && sequence > lastKnownBefore + 1) {
        void recoverSequenceGap(conversationId, lastKnownBefore);
      }
      // Resolve optimistic pending send.
      const clientMessageId = String(data["clientMessageId"] ?? "");
      if (clientMessageId) store.resolvePending(clientMessageId);
      break;
    }
    case "message.edited":
      store.updateMessage(
        String(data["messageId"]),
        {
          content: String(data["content"]),
          editedAt: envelope.timestamp,
        },
        conversationId || undefined,
      );
      break;
    case "conversation.deleted": {
      // Tombstone event (#28): remove EVERY trace without reload; an open
      // chat on this conversation closes safely (active id → null).
      const deletedId = String(data["id"] ?? conversationId);
      const deletedMemberIds = Array.isArray(data["memberIds"])
        ? (data["memberIds"] as unknown[]).map(String)
        : [];
      if (!deletedMemberIds.length || deletedMemberIds.includes(selfUserId)) {
        store.removeConversation(deletedId);
      }
      break;
    }
    case "message.deleted":
      store.removeMessage(String(data["messageId"]), conversationId || undefined);
      break;
    case "message.rejected": {
      // Authority rejected the send — fail the optimistic entry NOW instead
      // of waiting out the reconciliation timeout (repair-log #27).
      const rejectedCmid = String(data["clientMessageId"] ?? "");
      if (rejectedCmid) {
        store.markPendingFailed(rejectedCmid);
        store.setError(`Message rejected: ${String(data["reason"] ?? "unknown reason")}`);
      }
      break;
    }
    case "reaction.added":
      // Authoritative: the event type names the target state, so a QoS1
      // redelivery is a no-op — never a flip (repair-log #31).
      store.applyReaction(
        String(data["messageId"]),
        String(data["emoji"]),
        String(data["userId"]),
        true,
        conversationId || undefined,
      );
      break;
    case "reaction.removed":
      store.applyReaction(
        String(data["messageId"]),
        String(data["emoji"]),
        String(data["userId"]),
        false,
        conversationId || undefined,
      );
      break;
    case "receipt.read": {
      // Apply the canonical self event too: the worker fans it back so this
      // user's other tabs/devices converge. The monotonic reducer makes the
      // optimistic local echo and QoS1 redelivery harmless.
      applyCanonicalReadReceipt(envelope);
      break;
    }
    case "typing.started":
      store.setTyping(conversationId, String(data["userId"]), true);
      break;
    case "typing.stopped":
      store.setTyping(conversationId, String(data["userId"]), false);
      break;
    case "presence.online":
      store.setPresence(String(data["userId"]), true);
      break;
    case "presence.offline":
      store.setPresence(String(data["userId"]), false);
      break;
    default:
      break;
  }
}

/** Highest sequence cached for a conversation (0 when none) — the transcript
 *  watermark can lead the list summary, and gap detection must use the MAX. */
function lastKnownByMessages(conversationId: string): number {
  const list = useChatStore.getState().messagesByConversation[conversationId];
  return list && list.length > 0 ? (list[list.length - 1]?.sequence ?? 0) : 0;
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
    const response = await api.getMessages(conversationId, { after: afterSequence, limit: 100 });
    const store = useChatStore.getState();
    for (const message of response.messages) store.upsertMessage(message);
  } catch {
    // Recovery failed — the next canonical event for this conversation will
    // retry; the UI never silently accepts a gap as final state.
  } finally {
    gapRecovering.delete(conversationId);
  }
}

/**
 * Refetch server state after an MQTT reconnect: conversation list (fresh
 * lastSequence/preview/unread) + active conversation healed SEQ-SCOPED —
 * the old latest-50 REPLACE destroyed paginated history and reset scroll
 * after every reconnect (audit P1); ?after=<watermark> merged by id heals
 * exactly the missed window instead.
 */
async function recoverAfterReconnect(): Promise<void> {
  const { identity, activeConversationId, messagesByConversation } = useChatStore.getState();
  if (!identity) return;
  try {
    const conversationsResponse = await api.listConversations(identity.userId);
    const store = useChatStore.getState();
    store.setConversations(conversationsResponse.conversations);
    for (const conversation of conversationsResponse.conversations) {
      getRealtimeService().subscribeConversation(conversation.id);
    }
    if (activeConversationId) {
      const cached = messagesByConversation[activeConversationId] ?? [];
      const watermark = cached[cached.length - 1]?.sequence ?? 0;
      if (watermark > 0) {
        const response = await api.getMessages(activeConversationId, {
          after: watermark,
          limit: 100,
        });
        const latestStore = useChatStore.getState();
        for (const message of response.messages) latestStore.upsertMessage(message);
      } else {
        const response = await api.getMessages(activeConversationId, { limit: 50 });
        useChatStore
          .getState()
          .setMessages(activeConversationId, response.messages, response.hasMore);
      }
    }
  } catch {
    // Transient — the next reconnect cycle retries recovery.
  }
}
