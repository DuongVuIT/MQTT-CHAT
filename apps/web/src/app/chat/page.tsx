"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type ApiConversation, type ApiMessage } from "@/lib/api";
import { normalizeConversation, normalizeMessage } from "@mqtt-chat/realtime-core";
import { getRealtimeService, type ConnectionState } from "@/lib/realtime-service";
import { republishPayload, useChatStore } from "@/store/chat-store";
import { loadStoredIdentity } from "@/lib/identity";
import { Sidebar } from "@/components/Sidebar";
import { MessageList } from "@/components/MessageList";
import { Composer } from "@/components/Composer";
import { DetailsPanel } from "@/components/DetailsPanel";
import { ErrorBanner } from "@/components/ErrorBanner";
import { DiagnosticsPanel } from "@/components/DiagnosticsPanel";
import { Avatar, ConnectionBadge } from "@mqtt-chat/ui";
import type { EventEnvelope } from "@mqtt-chat/mqtt-contracts";

/**
 * Main chat shell v2 (§26): three-area workspace — conversations / chat /
 * details. Details is collapsible on desktop and becomes a drawer below
 * `lg`; the sidebar collapses below `md`. Connection state is a subtle dot
 * during normal operation (§29) and a labelled pill only when degraded.
 */

export default function ChatPage() {
  const router = useRouter();
  // PERF: subscribe to ONLY the slices this component renders. The old
  // whole-store subscription re-rendered the entire 3-column shell (sidebar,
  // list, composer, details) on every typing/presence/receipt/reaction event.
  // Actions come from getState() — they are stable and never trigger renders.
  const activeId = useChatStore((s) => s.activeConversationId);
  const activeConversation = useChatStore(
    (s) => s.conversations.find((c) => c.id === s.activeConversationId) ?? null,
  );
  const identityUserId = useChatStore((s) => s.identity?.userId);
  const users = useChatStore((s) => s.users);
  const connectionState = useChatStore((s) => s.connectionState);
  // Previous transport state — used to detect reconnect transitions
  // (reconnecting/disconnected → connected) and trigger state recovery.
  const prevConnectionState = useRef<ConnectionState | null>(null);
  // Reply target for the composer — canonical messageId of an existing message.
  const [replyTo, setReplyTo] = useState<ApiMessage | null>(null);
  // Drawer state for narrow viewports (§26): details → overlay drawer.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const activeConversationId = activeId;

  // Switching conversations must never carry a stale reply target over.
  useEffect(() => {
    setReplyTo(null);
    setDetailsOpen(false);
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
    const prev = useChatStore.getState().identity;
    if (prev && (prev.userId !== identity.userId || prev.deviceId !== identity.deviceId)) {
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
        const [usersRes, convRes] = await Promise.all([
          api.listUsers(),
          api.listConversations(identity.userId),
        ]);
        if (cancelled) return;
        const s = useChatStore.getState();
        s.setUsers(usersRes.users);
        s.setConversations(convRes.conversations);
        s.setConversationsLoaded(true);
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

        realtime.subscribeGlobal(identity.userId);
        for (const c of convRes.conversations) realtime.subscribeConversation(c.id);
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

  // Peer-relative DIRECT label: A sees B's name, B sees A's name.
  const activeTitle = (() => {
    if (!activeConversation) return "";
    if (activeConversation.type === "GROUP") {
      return activeConversation.title ?? "Group";
    }
    const peerId = activeConversation.members?.find((m) => m.userId !== identityUserId)?.userId;
    const peer = users.find((u) => u.id === peerId);
    return peer?.displayName ?? peerId ?? "Direct chat";
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
  // Canonical avatar color key: conversation id (group or DM alike) — never a
  // display name (REG-05 parity with mobile).
  const headerAvatarKey = activeConversation?.id ?? "?";

  return (
    <div className="relative flex h-screen overflow-hidden bg-app">
      {/* Sidebar: static ≥md, drawer below (§26). */}
      <div className="hidden md:flex">
        <Sidebar />
      </div>
      {detailsOpen && (
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
            onClick={() => setDetailsOpen(false)}
          />
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        {activeConversation ? (
          <>
            <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  aria-label="Open conversations"
                  onClick={() => setDetailsOpen(true)}
                  className="rounded-lg px-1 text-ink-2 hover:text-ink md:hidden"
                >
                  ☰
                </button>
                <Avatar name={headerAvatarName} colorKey={headerAvatarKey} size="sm" />
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold">{activeTitle}</h2>
                  <p className="truncate text-xs text-ink-3">{activeSubtitle}</p>
                </div>
              </div>
              {/* Subtle dot when healthy; labelled pill only when degraded. */}
              <ConnectionBadge state={connectionState} />
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
            <header className="flex items-center gap-3 border-b border-line px-4 py-2.5 md:hidden">
              <button
                type="button"
                aria-label="Open conversations"
                onClick={() => setDetailsOpen(true)}
                className="rounded-lg px-1 text-ink-2 hover:text-ink"
              >
                ☰
              </button>
              <h2 className="text-sm font-semibold">Chats</h2>
            </header>
            {/* Empty state (§28) — tasteful, never an enormous blank panel. */}
            <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
              <span
                aria-hidden
                className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface text-3xl"
              >
                💬
              </span>
              <p className="mt-4 text-sm font-semibold">Select a conversation</p>
              <p className="mt-1 max-w-xs text-xs leading-5 text-ink-3">
                Pick a chat on the left, or start a new one with the + button.
              </p>
            </div>
          </>
        )}
      </main>

      {/* Details: static rail ≥lg, drawer below (§26). */}
      <div className="hidden lg:flex">
        <DetailsPanel conversation={activeConversation} />
      </div>
      {detailsOpen && activeConversation && (
        <div className="absolute inset-0 z-40 flex lg:hidden" role="dialog" aria-label="Details">
          <div className="flex h-full">
            <DetailsPanel conversation={activeConversation} onClose={() => setDetailsOpen(false)} />
          </div>
          <button
            type="button"
            aria-label="Close details"
            className="flex-1 bg-scrim"
            onClick={() => setDetailsOpen(false)}
          />
        </div>
      )}
      {activeConversation && (
        <button
          type="button"
          aria-label="Show details"
          onClick={() => setDetailsOpen(true)}
          className="absolute right-3 top-16 z-10 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-2 shadow-md transition-colors duration-fast hover:bg-raised lg:hidden"
        >
          Details
        </button>
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
  const s = useChatStore.getState();
  for (const p of s.pendingMessages) {
    if (p.status !== "queued") continue;
    s.retryPending(p.clientMessageId);
    getRealtimeService().publishCommand("message.send", republishPayload(p));
  }
}

/** Route canonical events into the store. */
export function handleEvent(envelope: EventEnvelope): void {
  const s = useChatStore.getState();
  // Perspective is ALWAYS derived from the active identity at event time.
  const selfUserId = s.identity?.userId ?? "";
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
      // Sequence-gap detection must read the watermark BEFORE the store
      // advances it — reading `lastKnown` after applyMessageActivity made
      // `sequence > lastKnown + 1` unreachable (dead recovery path, audit
      // P0). Capture first, apply, then heal if the event jumped a gap.
      const convBefore = useChatStore.getState().conversations.find((c) => c.id === conversationId);
      const lastKnownBefore = Math.max(
        convBefore?.lastSequence ?? 0,
        lastKnownByMessages(conversationId),
      );
      s.upsertMessage(message);
      // Keep the conversation list entry in sync (lastSequence/preview/time)
      // so every client converges on the same server-side sequence.
      const preview = type === "TEXT" ? content.slice(0, 120) : `[${type.toLowerCase()}]`;
      s.applyMessageActivity(conversationId, {
        sequence,
        preview: content ? preview : null,
        at: envelope.timestamp,
      });
      if (Number.isFinite(sequence) && sequence > lastKnownBefore + 1) {
        void recoverSequenceGap(conversationId, lastKnownBefore);
      }
      // Resolve optimistic pending send.
      const clientMessageId = String(data["clientMessageId"] ?? "");
      if (clientMessageId) s.resolvePending(clientMessageId);
      break;
    }
    case "message.edited":
      s.updateMessage(
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
        s.removeConversation(deletedId);
      }
      break;
    }
    case "message.deleted":
      s.removeMessage(String(data["messageId"]), conversationId || undefined);
      break;
    case "message.rejected": {
      // Authority rejected the send — fail the optimistic entry NOW instead
      // of waiting out the reconciliation timeout (repair-log #27).
      const rejectedCmid = String(data["clientMessageId"] ?? "");
      if (rejectedCmid) {
        s.markPendingFailed(rejectedCmid);
        s.setError(`Message rejected: ${String(data["reason"] ?? "unknown reason")}`);
      }
      break;
    }
    case "reaction.added":
      // Authoritative: the event type names the target state, so a QoS1
      // redelivery is a no-op — never a flip (repair-log #31).
      s.applyReaction(
        String(data["messageId"]),
        String(data["emoji"]),
        String(data["userId"]),
        true,
        conversationId || undefined,
      );
      break;
    case "reaction.removed":
      s.applyReaction(
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
 * lastSequence/preview/unread) + active conversation healed SEQ-SCOPED —
 * the old latest-50 REPLACE destroyed paginated history and reset scroll
 * after every reconnect (audit P1); ?after=<watermark> merged by id heals
 * exactly the missed window instead.
 */
async function recoverAfterReconnect(): Promise<void> {
  const { identity, activeConversationId, messagesByConversation } = useChatStore.getState();
  if (!identity) return;
  try {
    const convRes = await api.listConversations(identity.userId);
    const store = useChatStore.getState();
    store.setConversations(convRes.conversations);
    for (const c of convRes.conversations) getRealtimeService().subscribeConversation(c.id);
    if (activeConversationId) {
      const cached = messagesByConversation[activeConversationId] ?? [];
      const watermark = cached[cached.length - 1]?.sequence ?? 0;
      if (watermark > 0) {
        const res = await api.getMessages(activeConversationId, { after: watermark, limit: 100 });
        const s = useChatStore.getState();
        for (const message of res.messages) s.upsertMessage(message);
      } else {
        const res = await api.getMessages(activeConversationId, { limit: 50 });
        useChatStore.getState().setMessages(activeConversationId, res.messages, res.hasMore);
      }
    }
  } catch {
    // Transient — the next reconnect cycle retries recovery.
  }
}
