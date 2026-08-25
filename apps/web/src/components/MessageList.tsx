"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, type ApiMessage } from "@/lib/api";
import { getRealtimeService } from "@/lib/realtime-service";
import { useChatStore } from "@/store/chat-store";
import { MessageBubble } from "@/components/MessageBubble";
import { buildChatRows } from "@/lib/message-rows";
import { mergeMessageSnapshot } from "@mqtt-chat/realtime-core";

/**
 * Message list v2: cursor pagination, canonical scroll model, anchor
 * preservation, unread pill — plus phase-2 product structure: date
 * separators, sender-run grouping, receipts, skeleton and error states
 * (§11/§13/§14/§30/§31/§64/§66).
 *
 * Scroll model (one source of truth — `stickToBottomRef`):
 * - "Stuck to bottom" iff within FOLLOW_THRESHOLD px of the bottom; every
 *   scroll event updates it; nothing else does.
 * - Conversation open / history replace → INSTANT jump to the latest
 *   message before paint (never land at the top of a long thread, §34).
 * - Append while stuck → follow. Append while scrolled up → unread pill.
 * - Prepend (older history) → the anchor is captured at fetch start and
 *   consumed ONLY by the commit that actually prepends that page (the old
 *   "any commit while in flight" race is gone): scrollTop is compensated by
 *   the height delta in a layout effect, before paint (§37).
 */

const FOLLOW_THRESHOLD = 80;
const PAGE_SIZE = 50;
/** Content width cap so messages don't stretch across huge monitors (§30). */
const MAX_CONTENT_W = "max-w-3xl";

// Stable reference for the "no typing users" case — a fresh `[]` inside the
// store selector would create a new snapshot on every call and trigger an
// infinite re-render loop in useSyncExternalStore.
const NO_TYPING_USERS: string[] = [];

function TranscriptSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-3 py-4" aria-label="Loading messages" role="status">
      {[82, 56, 68, 44, 74, 60].map((w, i) => (
        <div key={i} className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}>
          <div
            className="animate-skeleton h-9 rounded-2xl bg-raised"
            style={{ width: `${w}%`, maxWidth: "70%" }}
          />
        </div>
      ))}
    </div>
  );
}

export function MessageList({
  conversationId,
  onRequestReply,
}: {
  conversationId: string;
  /** Raise a reply intent to the page (composer reply target). */
  onRequestReply?: (message: ApiMessage) => void;
}) {
  const messages = useChatStore((s) => s.messagesByConversation[conversationId]);
  const pending = useChatStore((s) => s.pendingMessages);
  const typing = useChatStore((s) => s.typingUsers[conversationId] ?? NO_TYPING_USERS);
  const users = useChatStore((s) => s.users);
  const identity = useChatStore((s) => s.identity);
  const conversations = useChatStore((s) => s.conversations);
  const hasMore = useChatStore((s) => s.hasMoreHistory[conversationId] ?? false);
  const loadingHistory = useChatStore((s) => s.loadingHistory);
  const connectionState = useChatStore((s) => s.connectionState);

  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Unread messages accumulated while the user was scrolled away. State only
  // so the pill can render; the hot path lives in refs (no re-render churn).
  const [unreadCount, setUnreadCount] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // --- Scroll-model refs (mutable, never trigger renders) -------------------
  const stickToBottomRef = useRef(true);
  const lastConvIdRef = useRef<string | null>(null);
  const prevFirstIdRef = useRef<string | null>(null);
  const prevLastIdRef = useRef<string | null>(null);
  const prevCountRef = useRef(0);
  // Anchor captured when an older-page fetch STARTS, consumed only by the
  // commit that actually grows the list at the TOP (firstId changed while
  // lastId held) — any other commit leaves the anchor untouched.
  const prependAnchorRef = useRef<{ prevHeight: number } | null>(null);
  // Set when history was just (re)loaded for THIS conversation → next layout
  // pass must land on the latest message instantly.
  const jumpToLatestRef = useRef(true);
  // Rows that arrived live (appends after mount) — the only ones that animate.
  const seenIdsRef = useRef<Set<string> | null>(null);
  const [arrivedIds, setArrivedIds] = useState<ReadonlySet<string>>(new Set());

  // Initial + reconnect-safe history load.
  useEffect(() => {
    let cancelled = false;
    setLoadingInitial(true);
    setLoadError(null);
    setUnreadCount(0);
    setArrivedIds(new Set());
    stickToBottomRef.current = true;
    jumpToLatestRef.current = true;
    prevFirstIdRef.current = null;
    prevLastIdRef.current = null;
    prevCountRef.current = 0;

    void (async () => {
      try {
        const res = await api.getMessages(conversationId, { limit: PAGE_SIZE });
        if (cancelled) return;
        // Events may arrive after this request starts but before it resolves.
        // Install the snapshot as a base and let the already-applied canonical
        // rows win by id, so history can never erase a live create/edit/delete.
        const store = useChatStore.getState();
        const live = store.messagesByConversation[conversationId] ?? [];
        store.setMessages(conversationId, mergeMessageSnapshot(res.messages, live), res.hasMore);
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "Failed to load history");
        }
      } finally {
        if (!cancelled) setLoadingInitial(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // Live-arrival tracking: rows appended after the newest-known id animate
  // in; history loads, prepends and gap-fills never do (§41).
  useEffect(() => {
    if (!messages?.length) return;
    if (seenIdsRef.current === null) {
      seenIdsRef.current = new Set(messages.map((m) => m.id));
      return;
    }
    const fresh = messages.filter((m) => !seenIdsRef.current?.has(m.id));
    if (fresh.length === 0) return;
    for (const m of fresh) seenIdsRef.current?.add(m.id);
    const lastId = messages[messages.length - 1]?.id;
    const arrived = fresh.filter((m) => m.id === lastId).map((m) => m.id);
    if (arrived.length > 0) {
      setArrivedIds((prev) => new Set([...prev, ...arrived]));
    }
  }, [messages]);

  // Scroll classification + response — runs after every message-array change.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!messages?.length) return;

    const firstId = messages[0]?.id ?? null;
    const lastId = messages[messages.length - 1]?.id ?? null;
    const count = messages.length;
    const isReplace =
      lastConvIdRef.current !== conversationId ||
      (prevLastIdRef.current === null && prevCountRef.current === 0);
    const isPrepend =
      !isReplace && firstId !== prevFirstIdRef.current && lastId === prevLastIdRef.current;
    const isAppend = !isReplace && !isPrepend && lastId !== prevLastIdRef.current;

    if (isPrepend && prependAnchorRef.current && el) {
      // Older history landed: compensate BEFORE paint — zero visible jump,
      // regardless of how tall the inserted block is (§37).
      el.scrollTop += el.scrollHeight - prependAnchorRef.current.prevHeight;
      prependAnchorRef.current = null;
    } else if (isReplace || (isAppend && jumpToLatestRef.current)) {
      // Open/history-replace (or a pending own send that just resolved):
      // land on the latest message instantly (§34).
      if (el) el.scrollTop = el.scrollHeight;
      stickToBottomRef.current = true;
      jumpToLatestRef.current = false;
      setUnreadCount(0);
    } else if (isAppend) {
      if (stickToBottomRef.current) {
        // Follow live traffic while pinned (§35) — scroll the CONTAINER to
        // its true max (scrollIntoView stops at the padding edge, leaving a
        // permanent ~16px gap under the latest message).
        if (el) el.scrollTop = el.scrollHeight;
      } else {
        // User is reading history — never yank the viewport (§35).
        setUnreadCount((c) => c + Math.max(1, count - prevCountRef.current));
      }
    }
    // Prepends without an anchor marker (gap recovery) fall through:
    // native scroll anchoring keeps the view stable.

    prevFirstIdRef.current = firstId;
    prevLastIdRef.current = lastId;
    prevCountRef.current = count;
    lastConvIdRef.current = conversationId;
  }, [messages, conversationId]);

  // Keep the viewport pinned while content settles (images loading, fonts
  // swapping) — but ONLY while the reader is actually near the bottom,
  // computed LIVE at callback time: the stickToBottomRef can be stale for a
  // programmatic scroll whose event hasn't fired yet, and re-pinning on a
  // prepend would fight the anchor compensation (§34/§35/§37).
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => {
      const el = containerRef.current;
      if (!el) return;
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distance < FOLLOW_THRESHOLD) {
        el.scrollTop = el.scrollHeight;
      }
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [conversationId, loadingInitial]);

  // Own sends ALWAYS reach the latest message — even if the user had scrolled
  // away, they intend to see the result of their action (§38).
  const prevPendingCountRef = useRef(pending.length);
  useEffect(() => {
    const grew = pending.length > prevPendingCountRef.current;
    prevPendingCountRef.current = pending.length;
    if (!grew || !pending.length) return;
    if (pending[pending.length - 1]?.conversationId !== conversationId) return;
    stickToBottomRef.current = true;
    jumpToLatestRef.current = true; // consume on the next messages commit
    setUnreadCount(0);
    // If the optimistic bubble already rendered, go now.
    requestAnimationFrame(() => {
      const el = containerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [pending, conversationId]);

  // Read receipt: mark conversation read ONLY while actually viewing the
  // latest message, and only when the watermark actually ADVANCED — edits,
  // reactions and gap-merges change the array identity without changing the
  // sequence and must not spam QoS1 publishes (§ perf).
  const lastPublishedReadRef = useRef(0);
  const inFlightReadRef = useRef<{ conversationId: string; sequence: number } | null>(null);
  useEffect(() => {
    lastPublishedReadRef.current = 0;
    inFlightReadRef.current = null;
  }, [conversationId]);
  useEffect(() => {
    if (!identity || !messages?.length) return;
    if (connectionState !== "connected") return;
    if (!stickToBottomRef.current) return;
    const lastSeq = messages[messages.length - 1]?.sequence ?? 0;
    if (
      lastSeq === 0 ||
      lastSeq <= lastPublishedReadRef.current ||
      (inFlightReadRef.current?.conversationId === conversationId &&
        lastSeq <= inFlightReadRef.current.sequence)
    )
      return;
    inFlightReadRef.current = { conversationId, sequence: lastSeq };
    void getRealtimeService()
      .publishCommandAsync("receipt.read", {
        conversationId,
        lastReadSequence: lastSeq,
      })
      .then(() => {
        if (inFlightReadRef.current?.conversationId === conversationId) {
          lastPublishedReadRef.current = Math.max(lastPublishedReadRef.current, lastSeq);
        }
      })
      .catch(() => {
        // Keep the watermark retryable. A reconnect changes connectionState
        // and re-runs this effect; persistence failure cannot be hidden behind
        // an optimistic badge clear.
        useChatStore.getState().setError("Read receipt could not be synchronized");
      })
      .finally(() => {
        if (
          inFlightReadRef.current?.conversationId === conversationId &&
          inFlightReadRef.current.sequence === lastSeq
        ) {
          inFlightReadRef.current = null;
        }
      });
    // Advance OUR OWN watermark locally — the server only echoes receipt.read
    // to members' user topics for cross-device convergence; without this the
    // sidebar badge derived from `lastSequence − myRead` stayed stale until
    // the next refetch (REG-02). Monotonic via the shared merge.
    useChatStore.getState().applyReadReceipt(conversationId, identity.userId, lastSeq);
  }, [connectionState, conversationId, identity, messages]);

  const scrollToLatest = (behavior: ScrollBehavior): void => {
    stickToBottomRef.current = true;
    setUnreadCount(0);
    containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior });
  };

  const loadOlder = async (): Promise<void> => {
    const list = useChatStore.getState().messagesByConversation[conversationId];
    const oldest = list?.[0];
    if (!oldest || !hasMore) return;
    const store = useChatStore.getState();
    if (store.loadingHistory) return; // overlapping fetches corrupt the anchor
    const el = containerRef.current;
    if (el) prependAnchorRef.current = { prevHeight: el.scrollHeight };
    store.setLoadingHistory(true);
    try {
      const res = await api.getMessages(conversationId, {
        before: oldest.sequence,
        limit: PAGE_SIZE,
      });
      useChatStore.getState().prependMessages(conversationId, res.messages, res.hasMore);
    } catch (error) {
      prependAnchorRef.current = null;
      setLoadError(error instanceof Error ? error.message : "Failed to load older messages");
    } finally {
      useChatStore.getState().setLoadingHistory(false);
    }
  };

  const onScroll = (): void => {
    const el = containerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distance < FOLLOW_THRESHOLD;
    if (stickToBottomRef.current && unreadCount > 0) setUnreadCount(0);
  };

  const pendingForConversation = useMemo(
    () => pending.filter((p) => p.conversationId === conversationId),
    [pending, conversationId],
  );

  const activeConversation = conversations.find((c) => c.id === conversationId);
  // Read watermark (§14): max lastReadSequence among OTHER members.
  const readWatermark = useMemo(() => {
    let max = 0;
    for (const m of activeConversation?.members ?? []) {
      if (m.userId === identity?.userId) continue;
      if (m.lastReadSequence > max) max = m.lastReadSequence;
    }
    return max;
  }, [activeConversation, identity?.userId]);

  const rowsDesc = useMemo(
    () =>
      buildChatRows(messages ?? [], {
        identityUserId: identity?.userId ?? null,
        isGroup: activeConversation?.type === "GROUP",
        readWatermark,
      }),
    [messages, identity?.userId, activeConversation?.type, readWatermark],
  );
  // buildChatRows returns NEWEST-FIRST (the mobile inverted-FlatList order);
  // a normal DOM container renders top-down, so display order is reversed —
  // oldest at top, live edge at the bottom.
  const rows = useMemo(() => [...rowsDesc].reverse(), [rowsDesc]);

  if (loadingInitial) {
    return (
      <div className={`mx-auto w-full flex-1 px-4 ${MAX_CONTENT_W}`}>
        <TranscriptSkeleton />
      </div>
    );
  }

  if (loadError && !messages?.length) {
    // Contextual error surface (§64) — product copy + recovery, never a
    // dead-end raw fetch message.
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="max-w-sm text-center">
          <p className="text-sm font-semibold">Couldn’t load messages</p>
          <p role="alert" className="mt-1 text-xs text-ink-3">
            {loadError}
          </p>
          <button
            type="button"
            onClick={() => {
              setLoadError(null);
              setLoadingInitial(true);
              void api
                .getMessages(conversationId, { limit: PAGE_SIZE })
                .then((res) =>
                  useChatStore.getState().setMessages(conversationId, res.messages, res.hasMore),
                )
                .catch((e: unknown) =>
                  setLoadError(e instanceof Error ? e.message : "Failed to load history"),
                )
                .finally(() => setLoadingInitial(false));
            }}
            className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:bg-brand-strong"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={containerRef}
        className={`scroll-contain h-full overflow-y-auto px-4 py-4 ${MAX_CONTENT_W} mx-auto w-full`}
        role="log"
        aria-label="Message list"
        onScroll={onScroll}
      >
        <div ref={contentRef}>
          {(!messages || messages.length === 0) && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <span aria-hidden className="text-4xl">
                👋
              </span>
              <p className="mt-3 text-sm font-semibold">No messages yet</p>
              <p className="mt-1 text-xs text-ink-3">Say hello — messages arrive in realtime.</p>
            </div>
          )}

          {hasMore && messages && messages.length > 0 && (
            <div className="mb-3 flex justify-center">
              {loadingHistory ? (
                <span className="text-xs text-ink-3">Loading earlier messages…</span>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    void loadOlder();
                  }}
                  data-testid="load-older"
                  className="rounded-full border border-line-strong px-3 py-1 text-xs text-ink-2 transition-colors duration-fast hover:bg-raised"
                >
                  Load earlier messages
                </button>
              )}
            </div>
          )}

          {rows.map((row) =>
            row.kind === "date" ? (
              <div key={row.key} className="my-3 flex items-center gap-3">
                <span className="h-px flex-1 bg-line" />
                <span className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-[11px] font-semibold text-ink-2">
                  {row.label}
                </span>
                <span className="h-px flex-1 bg-line" />
              </div>
            ) : (
              <MessageBubble
                key={row.key}
                row={row}
                isOwn={row.mine}
                isNew={arrivedIds.has(row.key)}
                onReply={onRequestReply}
              />
            ),
          )}

          {pendingForConversation.map((p) => (
            <div key={p.clientMessageId}>
              <MessageBubble
                pending={{
                  content: p.content,
                  status: p.status,
                  clientMessageId: p.clientMessageId,
                }}
                isOwn
              />
            </div>
          ))}

          {typing.length > 0 && (
            <p className="mt-2 pl-10 text-xs italic text-ink-3" aria-live="polite">
              {typing.map((id) => users.find((u) => u.id === id)?.displayName ?? id).join(", ")}{" "}
              {typing.length === 1 ? "is" : "are"} typing…
            </p>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {unreadCount > 0 && (
        <button
          type="button"
          data-testid="new-messages-pill"
          onClick={() => {
            scrollToLatest("smooth");
          }}
          className="animate-pill-in absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-brand-strong px-4 py-1.5 text-xs font-semibold text-app shadow-lg transition-colors duration-fast hover:bg-brand"
        >
          ↓ {unreadCount} new message{unreadCount === 1 ? "" : "s"}
        </button>
      )}
    </div>
  );
}
