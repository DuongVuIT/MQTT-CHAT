"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { getRealtimeService } from "@/lib/realtime-service";
import { useChatStore } from "@/store/chat-store";
import { MessageBubble } from "@/components/MessageBubble";
import { retryPendingMessage } from "@/components/Composer";
import { Spinner, EmptyState } from "@mqtt-chat/ui";

/**
 * Message list: history loading (cursor pagination), scroll preservation when
 * loading older messages, jump-to-newest, typing indicator.
 */

// Stable reference for the "no typing users" case — a fresh `[]` inside the
// store selector would create a new snapshot on every call and trigger an
// infinite re-render loop in useSyncExternalStore.
const NO_TYPING_USERS: string[] = [];

export function MessageList({ conversationId }: { conversationId: string }) {
  const messages = useChatStore((s) => s.messagesByConversation[conversationId]);
  const pending = useChatStore((s) => s.pendingMessages);
  const typing = useChatStore((s) => s.typingUsers[conversationId] ?? NO_TYPING_USERS);
  const users = useChatStore((s) => s.users);
  const identity = useChatStore((s) => s.identity);
  const hasMore = useChatStore((s) => s.hasMoreHistory[conversationId] ?? false);
  const loadingHistory = useChatStore((s) => s.loadingHistory);

  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showJumpToNewest, setShowJumpToNewest] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevHeightRef = useRef(0);

  // Initial + reconnect history load with gap detection.
  useEffect(() => {
    let cancelled = false;
    setLoadingInitial(true);
    setLoadError(null);

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

  // Auto-scroll to newest on new message (unless user scrolled up).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom || !messages?.length) {
      bottomRef.current?.scrollIntoView({ block: "end" });
      setShowJumpToNewest(false);
    } else {
      setShowJumpToNewest(true);
    }
  }, [messages]);

  // Read receipt: mark conversation read when viewing latest.
  useEffect(() => {
    if (!identity || !messages?.length) return;
    const lastSeq = messages[messages.length - 1]?.sequence ?? 0;
    getRealtimeService().publishCommand("receipt.read", {
      conversationId,
      lastReadSequence: lastSeq,
    });
  }, [conversationId, identity, messages]);

  const loadOlder = async (): Promise<void> => {
    const list = useChatStore.getState().messagesByConversation[conversationId];
    const oldest = list?.[0];
    if (!oldest || !hasMore) return;
    const el = containerRef.current;
    prevHeightRef.current = el?.scrollHeight ?? 0;
    try {
      const res = await api.getMessages(conversationId, { before: oldest.sequence, limit: 50 });
      useChatStore.getState().prependMessages(conversationId, res.messages, res.hasMore);
      requestAnimationFrame(() => {
        if (el && prevHeightRef.current) {
          el.scrollTop += el.scrollHeight - prevHeightRef.current;
        }
      });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load older messages");
    }
  };

  const pendingForConversation = useMemo(
    () => pending.filter((p) => p.conversationId === conversationId),
    [pending, conversationId],
  );

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
              className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Load older messages
            </button>
          </div>
        )}

        {(messages ?? []).map((m) => (
          <MessageBubble key={m.id} message={m} isOwn={m.senderId === identity?.userId} />
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

      {showJumpToNewest && (
        <button
          type="button"
          onClick={() => {
            bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
            setShowJumpToNewest(false);
          }}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white shadow-lg hover:bg-indigo-500"
        >
          Jump to newest ↓
        </button>
      )}
    </div>
  );
}
