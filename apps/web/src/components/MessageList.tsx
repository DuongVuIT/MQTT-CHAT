"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, type ApiMessage } from "@/lib/api";
import { getRealtimeService } from "@/lib/realtime-service";
import { useChatStore } from "@/store/chat-store";
import { MessageBubble } from "@/components/MessageBubble";
import { retryPendingMessage } from "@/components/Composer";
import { Spinner, EmptyState } from "@mqtt-chat/ui";

/**
 * Message list: history loading (cursor pagination), canonical scroll model,
 * scroll-anchor preservation when loading older messages, unread new-message
 * indicator, typing indicator.
 *
 * Scroll model (one source of truth — `stickToBottomRef`):
 * - The viewport is "stuck to bottom" iff the user is within FOLLOW_THRESHOLD
 *   px of the bottom. Every scroll event updates it; nothing else does.
 * - Conversation open / history replace → INSTANT jump to the latest message
 *   (never land at the top of a long conversation).
 * - Append while stuck → follow. Append while scrolled up → unread counter +
 *   jump pill (no motion theft).
 * - Prepend (older history) → viewport anchor preserved exactly: scrollTop is
 *   compensated by the height delta in a layout effect (before paint), so no
 *   jump is ever visible.
 */

// Stable reference for the "no typing users" case — a fresh `[]` inside the
// store selector would create a new snapshot on every call and trigger an
// infinite re-render loop in useSyncExternalStore.
const NO_TYPING_USERS: string[] = [];

const FOLLOW_THRESHOLD = 80;

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
  const hasMore = useChatStore((s) => s.hasMoreHistory[conversationId] ?? false);
  const loadingHistory = useChatStore((s) => s.loadingHistory);

  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Unread messages accumulated while the user was scrolled away. State only
  // so the pill can render; the hot path lives in refs (no re-render churn).
  const [unreadCount, setUnreadCount] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // --- Scroll-model refs (mutable, never trigger renders) -------------------
  const stickToBottomRef = useRef(true);
  const lastConvIdRef = useRef<string | null>(null);
  // Classification of the previous render's message list — distinguishes
  // appends (follow/notify) from prepends (anchor) from replaces (jump).
  const prevFirstIdRef = useRef<string | null>(null);
  const prevLastIdRef = useRef<string | null>(null);
  const prevCountRef = useRef(0);
  // Set while an older-history fetch is in flight; the layout effect consumes
  // it to restore the anchor before the browser paints.
  const prependAnchorRef = useRef<{ prevHeight: number } | null>(null);
  // Set when history was just (re)loaded for THIS conversation → next layout
  // pass must land on the latest message instantly.
  const jumpToLatestRef = useRef(true);

  // Initial + reconnect history load with gap detection.
  useEffect(() => {
    let cancelled = false;
    setLoadingInitial(true);
    setLoadError(null);
    setUnreadCount(0);
    stickToBottomRef.current = true;
    jumpToLatestRef.current = true;
    prevFirstIdRef.current = null;
    prevLastIdRef.current = null;
    prevCountRef.current = 0;

    void (async () => {
      try {
        const res = await api.getMessages(conversationId, { limit: 50 });
        if (cancelled) return;
        useChatStore.getState().setMessages(conversationId, res.messages, res.hasMore);
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

    if (prependAnchorRef.current && el) {
      // Older history landed: compensate BEFORE paint — zero visible jump,
      // regardless of how tall the inserted block is.
      el.scrollTop += el.scrollHeight - prependAnchorRef.current.prevHeight;
      prependAnchorRef.current = null;
    } else if (isReplace || (isAppend && jumpToLatestRef.current)) {
      // Open/history-replace (or a pending own send that just resolved):
      // land on the latest message instantly.
      if (el) el.scrollTop = el.scrollHeight;
      stickToBottomRef.current = true;
      jumpToLatestRef.current = false;
      setUnreadCount(0);
    } else if (isAppend) {
      if (stickToBottomRef.current) {
        // Follow live traffic while pinned.
        bottomRef.current?.scrollIntoView({ block: "end" });
      } else {
        // User is reading history — never yank the viewport.
        setUnreadCount((c) => c + Math.max(1, count - prevCountRef.current));
      }
    }
    // Prepends without an in-flight anchor marker (e.g. gap recovery) fall
    // through: browsers with native scroll anchoring keep the view stable.

    prevFirstIdRef.current = firstId;
    prevLastIdRef.current = lastId;
    prevCountRef.current = count;
    lastConvIdRef.current = conversationId;
  }, [messages, conversationId]);

  // Own sends ALWAYS reach the latest message — even if the user had scrolled
  // away, they intend to see the result of their action. Triggered by pending
  // growth (optimistic bubble appears immediately, not on ack).
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
  // latest message — reading older history must not forge read watermarks.
  useEffect(() => {
    if (!identity || !messages?.length) return;
    if (!stickToBottomRef.current) return;
    const lastSeq = messages[messages.length - 1]?.sequence ?? 0;
    getRealtimeService().publishCommand("receipt.read", {
      conversationId,
      lastReadSequence: lastSeq,
    });
  }, [conversationId, identity, messages]);

  const scrollToLatest = (behavior: ScrollBehavior): void => {
    stickToBottomRef.current = true;
    setUnreadCount(0);
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });
  };

  const loadOlder = async (): Promise<void> => {
    const list = useChatStore.getState().messagesByConversation[conversationId];
    const oldest = list?.[0];
    if (!oldest || !hasMore) return;
    const el = containerRef.current;
    if (el) prependAnchorRef.current = { prevHeight: el.scrollHeight };
    try {
      const res = await api.getMessages(conversationId, { before: oldest.sequence, limit: 50 });
      useChatStore.getState().prependMessages(conversationId, res.messages, res.hasMore);
    } catch (error) {
      prependAnchorRef.current = null;
      setLoadError(error instanceof Error ? error.message : "Failed to load older messages");
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

  // Reply-source resolution for quoted previews (id → canonical message).
  const byId = useMemo(() => new Map((messages ?? []).map((m) => [m.id, m])), [messages]);

  if (loadingInitial) {
    return (
      <div className="flex flex-1 items-center justify-center" aria-label="Loading messages">
        <Spinner />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <p role="alert" className="text-sm text-red-500">
          {loadError}
        </p>
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={containerRef}
        className="h-full overflow-y-auto px-4 py-4"
        role="log"
        aria-label="Message list"
        onScroll={onScroll}
      >
        {(!messages || messages.length === 0) && (
          <EmptyState
            title="No messages yet"
            description="Say hello to start the conversation 👋"
          />
        )}

        {hasMore && messages && messages.length > 0 && (
          <div className="mb-3 flex justify-center">
            <button
              type="button"
              onClick={() => {
                void loadOlder();
              }}
              disabled={loadingHistory}
              data-testid="load-older"
              className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Load older messages
            </button>
          </div>
        )}

        {(messages ?? []).map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            isOwn={m.senderId === identity?.userId}
            replySource={m.replyToId ? (byId.get(m.replyToId) ?? null) : null}
            onReply={onRequestReply}
          />
        ))}

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
            {p.status === "failed" && (
              <div className="mb-2 flex justify-end pr-2">
                <button
                  type="button"
                  onClick={() => {
                    retryPendingMessage(p.clientMessageId);
                  }}
                  className="rounded-full border border-red-300 px-3 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
                >
                  ↻ Retry
                </button>
              </div>
            )}
          </div>
        ))}

        {typing.length > 0 && (
          <p className="mt-2 text-xs italic text-slate-400" aria-live="polite">
            {typing.map((id) => users.find((u) => u.id === id)?.displayName ?? id).join(", ")}{" "}
            {typing.length === 1 ? "is" : "are"} typing…
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      {unreadCount > 0 && (
        <button
          type="button"
          data-testid="new-messages-pill"
          onClick={() => {
            scrollToLatest("smooth");
          }}
          className="animate-pill-nudge absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white shadow-lg hover:bg-indigo-500"
        >
          ↓ {unreadCount} new message{unreadCount === 1 ? "" : "s"}
        </button>
      )}
    </div>
  );
}
