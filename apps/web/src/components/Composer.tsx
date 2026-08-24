"use client";

import { useEffect, useRef, useState } from "react";
import { api, type ApiMessage } from "@/lib/api";
import { getRealtimeService } from "@/lib/realtime-service";
import { republishPayload, useChatStore } from "@/store/chat-store";

const TYPING_DEBOUNCE_MS = 2000;
/** If no canonical message.created arrives within this window, mark failed. */
const SEND_TIMEOUT_MS = 10_000;
/** Queued-while-offline sends get a bounded but more patient window. */
const QUEUED_SEND_TIMEOUT_MS = 30_000;

/** Arm the reconciliation timeout for an optimistic send. */
function armSendTimeout(clientMessageId: string, timeoutMs: number = SEND_TIMEOUT_MS): void {
  setTimeout(() => {
    const entry = useChatStore
      .getState()
      .pendingMessages.find((p) => p.clientMessageId === clientMessageId);
    // Still unresolved (queued or published-but-unacked) → FAILED. The same
    // clientMessageId stays retryable, so nothing is ever silently dropped.
    if (entry && entry.status !== "failed") {
      useChatStore.getState().markPendingFailed(clientMessageId);
    }
  }, timeoutMs);
}

/** True when the realtime transport is currently connected. */
function isConnected(): boolean {
  return useChatStore.getState().connectionState === "connected";
}

/**
 * Publish a send command, or QUEUE it while offline. Queued sends are
 * flushed with the SAME clientMessageId on reconnect (see chat page) —
 * never an uncaught rejection, never a lost message.
 */
export function publishOrQueueSend(body: {
  conversationId: string;
  clientMessageId: string;
  content: string;
  type: string;
  replyToId: string | null;
  metadata: unknown;
  /** Optimistic bubble text when it differs from the message content (uploads). */
  pendingContent?: string;
}): void {
  const store = useChatStore.getState();
  store.addPending({
    clientMessageId: body.clientMessageId,
    conversationId: body.conversationId,
    content: body.pendingContent ?? body.content,
    replyToId: body.replyToId,
    // Carry the full logical payload so RETRY republishes it faithfully.
    type: body.type,
    metadata: body.metadata,
    status: isConnected() ? "pending" : "queued",
  });
  if (isConnected()) {
    getRealtimeService().publishCommand("message.send", { ...body });
    armSendTimeout(body.clientMessageId);
  } else {
    armSendTimeout(body.clientMessageId, QUEUED_SEND_TIMEOUT_MS);
  }
}

/**
 * Retry a failed/queued pending message. Re-publishes the SAME
 * clientMessageId AND the same logical payload (type/reply/metadata) —
 * chat-worker dedupes by clientMessageId, so retries are idempotent.
 * Exported for the retry button rendered next to failed bubbles.
 */
export function retryPendingMessage(clientMessageId: string): void {
  const s = useChatStore.getState();
  const pending = s.pendingMessages.find((p) => p.clientMessageId === clientMessageId);
  if (!pending) return;
  s.retryPending(clientMessageId);
  getRealtimeService().publishCommand("message.send", republishPayload(pending));
  armSendTimeout(clientMessageId);
}

/**
 * Composer v2 (§32): auto-growing multiline input, attachment + paste-image,
 * reply preview banner, upload state, and one consistent focus ring.
 */
export function Composer({
  conversationId,
  replyTo,
  onCancelReply,
}: {
  conversationId: string;
  /** Current reply target (quoted preview above the input). */
  replyTo?: ApiMessage | null;
  onCancelReply?: () => void;
}) {
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);
  const identity = useChatStore((s) => s.identity);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingRef = useRef(0);

  // Auto-grow: the textarea tracks its content up to the cap (§32) — no
  // one-row box with internal scrolling.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  if (!identity) return null;

  const notifyTyping = (): void => {
    const now = Date.now();
    if (now - lastTypingRef.current > TYPING_DEBOUNCE_MS / 2) {
      lastTypingRef.current = now;
      getRealtimeService().publishCommand("typing.set", { conversationId, isTyping: true }, 0);
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      getRealtimeService().publishCommand("typing.set", { conversationId, isTyping: false }, 0);
    }, TYPING_DEBOUNCE_MS);
  };

  const send = (): void => {
    const content = text.trim();
    if (!content || uploading) return;
    setText("");
    // Stop typing indicator immediately.
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    getRealtimeService().publishCommand("typing.set", { conversationId, isTyping: false }, 0);

    // Offline → QUEUED (flushed on reconnect); online → published now.
    publishOrQueueSend({
      conversationId,
      clientMessageId: crypto.randomUUID(),
      content,
      type: "TEXT",
      // Canonical reply relation — the target's messageId (#17).
      replyToId: replyTo?.id ?? null,
      metadata: null,
    });
    onCancelReply?.();
  };

  const uploadFile = async (file: File): Promise<void> => {
    if (!file || uploading) return;
    setUploading(true);
    try {
      // Same-origin multipart upload — the API streams to object storage
      // server-side and returns the durable storage key.
      const { key } = await api.uploadFile(file, conversationId);

      const isImage = file.type.startsWith("image/");
      publishOrQueueSend({
        conversationId,
        clientMessageId: crypto.randomUUID(),
        content: "",
        type: isImage ? "IMAGE" : "FILE",
        replyToId: null,
        pendingContent: `📎 ${file.name}`,
        metadata: {
          // Durable storage key ONLY — never a signed URL or dev host.
          // Recipients resolve it at read time via GET /media.
          storageKey: key,
          filename: file.name,
          mimeType: file.type,
          size: file.size,
        },
      });
    } catch (error) {
      useChatStore.getState().setError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <footer className="border-t border-line px-3 py-2.5">
      {replyTo && !replyTo.deletedAt && (
        <div
          className="animate-sheet-in mb-2 flex items-center justify-between gap-2 rounded-lg border-l-2 border-brand-strong bg-raised px-3 py-1.5 text-xs"
          data-testid="reply-banner"
        >
          <div className="min-w-0">
            <p className="font-semibold text-brand-strong">Replying to {replyTo.senderName}</p>
            <p className="truncate text-ink-3">
              {replyTo.type === "TEXT" || !replyTo.metadata
                ? replyTo.content || "(empty)"
                : `📎 ${String(replyTo.metadata["filename"] ?? "Attachment")}`}
            </p>
          </div>
          <button
            type="button"
            aria-label="Cancel reply"
            onClick={onCancelReply}
            className="rounded px-1.5 py-0.5 text-ink-3 hover:text-ink"
          >
            ✕
          </button>
        </div>
      )}
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <button
          type="button"
          aria-label={uploading ? "Uploading…" : "Attach file"}
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-raised text-lg text-ink-2 transition-colors duration-fast hover:bg-high hover:text-ink disabled:opacity-50"
        >
          <span aria-hidden>📎</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void uploadFile(file);
          }}
        />

        <textarea
          ref={inputRef}
          value={text}
          rows={1}
          aria-label="Message"
          data-testid="composer-input"
          placeholder={uploading ? "Uploading…" : "Type a message… (/help for bot commands)"}
          disabled={uploading}
          onChange={(e) => {
            setText(e.target.value);
            notifyTyping();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          onPaste={(e) => {
            // Screenshot → paste sends the image directly (§32 nicety).
            const file = e.clipboardData.files?.[0];
            if (file && file.type.startsWith("image/")) {
              e.preventDefault();
              void uploadFile(file);
            }
          }}
          className="max-h-40 min-h-[42px] flex-1 resize-none rounded-2xl bg-raised px-3.5 py-2.5 text-sm outline-none transition-colors duration-fast placeholder:text-ink-3 disabled:opacity-60"
        />

        <button
          type="button"
          onClick={send}
          disabled={!text.trim() || uploading}
          aria-label="Send message"
          data-testid="send-button"
          className="flex h-10 shrink-0 items-center justify-center rounded-full bg-brand px-4 text-sm font-semibold text-on-brand transition-all duration-fast hover:bg-brand-strong disabled:opacity-40"
        >
          {uploading ? "…" : "Send"}
        </button>
      </div>
    </footer>
  );
}
