"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { getRealtimeService } from "@/lib/realtime-service";
import { useChatStore } from "@/store/chat-store";

const TYPING_DEBOUNCE_MS = 2000;
/** If no canonical message.created arrives within this window, mark failed. */
const SEND_TIMEOUT_MS = 10_000;

/** Arm the reconciliation timeout for an optimistic send. */
function armSendTimeout(clientMessageId: string): void {
  setTimeout(() => {
    const stillPending = useChatStore
      .getState()
      .pendingMessages.some((p) => p.clientMessageId === clientMessageId && p.status === "pending");
    if (stillPending) useChatStore.getState().markPendingFailed(clientMessageId);
  }, SEND_TIMEOUT_MS);
}

/**
 * Retry a failed pending message. Re-publishes the SAME clientMessageId —
 * chat-worker dedupes by it, so retries are idempotent.
 * Exported for the retry button rendered next to failed bubbles.
 */
export function retryPendingMessage(clientMessageId: string): void {
  const s = useChatStore.getState();
  const pending = s.pendingMessages.find((p) => p.clientMessageId === clientMessageId);
  if (!pending) return;
  s.retryPending(clientMessageId);
  getRealtimeService().publishCommand("message.send", {
    conversationId: pending.conversationId,
    clientMessageId,
    content: pending.content.startsWith("📎") ? "" : pending.content,
    type: pending.content.startsWith("📎") ? "FILE" : "TEXT",
    replyToId: null,
    metadata: null,
  });
  armSendTimeout(clientMessageId);
}

/**
 * Message composer: optimistic send with clientMessageId, typing indicator
 * publishing (debounced stop), file upload via presigned URL (metadata over MQTT).
 */

export function Composer({ conversationId }: { conversationId: string }) {
  const [text, setText] = useState("");
  const [uploading, setUploading] = useState(false);
  const identity = useChatStore((s) => s.identity);
  const inputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingRef = useRef(0);

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

  /** Publish a send command and arm the reconciliation timeout. */
  const publishSend = (clientMessageId: string, body: Record<string, unknown>): void => {
    getRealtimeService().publishCommand("message.send", { clientMessageId, ...body });
    armSendTimeout(clientMessageId);
  };

  const send = (): void => {
    const content = text.trim();
    if (!content || uploading) return;
    setText("");
    // Stop typing indicator immediately.
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    getRealtimeService().publishCommand("typing.set", { conversationId, isTyping: false }, 0);

    const clientMessageId = crypto.randomUUID();
    useChatStore.getState().addPending({
      clientMessageId,
      conversationId,
      content,
      replyToId: null,
      status: "pending",
    });
    publishSend(clientMessageId, {
      conversationId,
      content,
      type: "TEXT",
      replyToId: null,
      metadata: null,
    });
  };

  const uploadFile = async (file: File): Promise<void> => {
    if (!file) return;
    setUploading(true);
    try {
      const { uploadUrl, key } = await api.presignUpload({
        conversationId,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      });
      const putRes = await fetch(uploadUrl, { method: "PUT", body: file });
      if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);
      await api.completeUpload({ conversationId, key });

      const isImage = file.type.startsWith("image/");
      const clientMessageId = crypto.randomUUID();
      useChatStore.getState().addPending({
        clientMessageId,
        conversationId,
        content: `📎 ${file.name}`,
        replyToId: null,
        status: "pending",
      });
      publishSend(clientMessageId, {
        conversationId,
        content: "",
        type: isImage ? "IMAGE" : "FILE",
        replyToId: null,
        metadata: {
          // Durable storage key ONLY — never a signed URL or dev host.
          // Recipients resolve it at read time via GET /uploads/view.
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
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <footer className="border-t border-slate-200 p-3 dark:border-slate-800">
      <div className="flex items-end gap-2">
        <label className="cursor-pointer rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800">
          <span aria-hidden>📎</span>
          <span className="sr-only">Attach file</span>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadFile(file);
            }}
          />
        </label>

        <textarea
          value={text}
          rows={1}
          aria-label="Message"
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
          className="max-h-32 min-h-[42px] flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-slate-600 dark:bg-slate-800"
        />

        <button
          type="button"
          onClick={send}
          disabled={!text.trim() || uploading}
          className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </footer>
  );
}
