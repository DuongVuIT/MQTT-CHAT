"use client";

import { memo, useState } from "react";
import { mediaViewUrl, type ApiMessage } from "@/lib/api";
import { getRealtimeService } from "@/lib/realtime-service";
import { useChatStore } from "@/store/chat-store";
import { retryPendingMessage } from "@/components/Composer";

const QUICK_EMOJIS = ["👍", "❤️", "😂", "🎉"] as const;

interface PendingProps {
  content: string;
  status: "queued" | "pending" | "failed";
  clientMessageId: string;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Resolve a media message's browser-fetchable URL from its metadata.
 * Canonical metadata carries a durable `storageKey`; legacy rows may carry
 * the key under `url`. Keys are resolved at read time (GET /uploads/view →
 * 302 presigned GET) so URLs can never be stale or dev-host bound.
 */
function mediaSrc(message: ApiMessage): string | null {
  const metadata = message.metadata;
  if (!metadata) return null;
  const key = metadata["storageKey"] ?? metadata["url"];
  if (typeof key !== "string" || key.length === 0) return null;
  return mediaViewUrl(key);
}

export const MessageBubble = memo(function MessageBubble({
  message,
  pending,
  isOwn,
  replySource,
  onReply,
}: {
  message?: ApiMessage;
  pending?: PendingProps;
  isOwn: boolean;
  /** Resolved target for this message's quoted preview (null when not a reply). */
  replySource?: ApiMessage | null;
  /** Raise a reply intent — provided by the page via MessageList. */
  onReply?: (message: ApiMessage) => void;
}) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const identity = useChatStore((s) => s.identity);

  if (pending) {
    return (
      <div className={`mb-2 flex ${isOwn ? "justify-end" : "justify-start"}`}>
        <div
          className={`max-w-[70%] rounded-2xl px-3.5 py-2 text-sm ${
            pending.status === "failed"
              ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
              : "bg-indigo-200/60 text-slate-600 dark:bg-indigo-900/40 dark:text-slate-300"
          }`}
          data-testid="pending-message"
        >
          <p className="whitespace-pre-wrap break-words">{pending.content}</p>
          <p className="mt-0.5 text-right text-[10px] opacity-70">
            {pending.status === "queued"
              ? "Queued…"
              : pending.status === "pending"
                ? "Sending…"
                : "Failed"}
            {pending.status === "failed" && (
              <button
                type="button"
                aria-label="Retry send"
                onClick={() => {
                  // Faithful retry — same clientMessageId + full payload.
                  retryPendingMessage(pending.clientMessageId);
                }}
                className="ml-1 underline"
              >
                Retry
              </button>
            )}
          </p>
        </div>
      </div>
    );
  }

  if (!message || !identity) return null;

  const deleted = message.deletedAt !== null;
  const isBot = message.senderType === "BOT";
  const isSystem = message.senderType === "SYSTEM";

  if (isSystem) {
    return (
      <div className="my-2 text-center">
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          {message.content}
        </span>
      </div>
    );
  }

  const groupedReactions = Object.entries(
    message.reactions.reduce<Record<string, string[]>>((acc, r) => {
      acc[r.emoji] = [...(acc[r.emoji] ?? []), r.userId];
      return acc;
    }, {}),
  );

  const saveEdit = (): void => {
    setEditing(false);
    if (!editText.trim() || editText === message.content) return;
    getRealtimeService().publishCommand("message.edit", {
      conversationId: message.conversationId,
      messageId: message.id,
      content: editText.trim(),
    });
  };

  return (
    <div className={`group mb-2 flex ${isOwn ? "justify-end" : "justify-start"}`}>
      {!isOwn && (
        <span className="mr-2 mt-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-medium dark:bg-slate-700">
          {isBot ? "🤖" : message.senderName.slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className="max-w-[70%]">
        {!isOwn && (
          <p className="mb-0.5 pl-1 text-xs font-medium text-slate-500">
            {message.senderName}
            {isBot && (
              <span className="ml-1 rounded bg-indigo-100 px-1 text-[10px] text-indigo-600 dark:bg-indigo-900/60 dark:text-indigo-300">
                BOT
              </span>
            )}
          </p>
        )}

        <div
          className={`relative rounded-2xl px-3.5 py-2 text-sm ${
            isOwn
              ? "bg-indigo-600 text-white"
              : "bg-white text-slate-800 shadow-sm dark:bg-slate-800 dark:text-slate-100"
          } ${deleted ? "italic opacity-60" : ""}`}
          data-testid={isOwn ? "own-message" : "other-message"}
        >
          {/* Quoted reply preview — never raw IDs (#57). */}
          {!editing && replySource && (
            <div
              className={`mb-1.5 rounded-lg border-l-2 px-2 py-1 text-xs ${
                isOwn
                  ? "border-indigo-200 bg-indigo-500/30 text-indigo-50"
                  : "border-indigo-400 bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300"
              }`}
            >
              <p className="font-medium">{replySource.senderName}</p>
              <p className="truncate opacity-80">
                {replySource.deletedAt
                  ? "Message deleted"
                  : replySource.type === "TEXT" || !replySource.metadata
                    ? replySource.content || "(empty)"
                    : `📎 ${String(replySource.metadata["filename"] ?? "Attachment")}`}
              </p>
            </div>
          )}
          {editing ? (
            <span className="flex items-center gap-2">
              <input
                value={editText}
                onChange={(e) => {
                  setEditText(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveEdit();
                  if (e.key === "Escape") setEditing(false);
                }}
                autoFocus
                className="w-56 rounded border border-white/40 bg-transparent px-1 py-0.5 text-sm outline-none"
              />
              <button type="button" onClick={saveEdit} aria-label="Save edit" className="underline">
                Save
              </button>
            </span>
          ) : deleted ? (
            <p>Message deleted</p>
          ) : message.type === "IMAGE" && mediaSrc(message) ? (
            <img
              src={mediaSrc(message) ?? undefined}
              alt={String(message.metadata?.["filename"] ?? "image")}
              className="max-h-64 rounded-lg"
            />
          ) : message.type !== "TEXT" && message.type !== "SYSTEM" ? (
            // Non-text message without resolvable media — explicit fallback,
            // never a broken <img>.
            <p className="whitespace-pre-wrap break-words">
              📎 {String(message.metadata?.["filename"] ?? "Attachment")}
            </p>
          ) : (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          )}

          <p
            className={`mt-0.5 text-right text-[10px] ${
              isOwn ? "text-indigo-200" : "text-slate-400"
            }`}
          >
            {formatTime(message.createdAt)}
            {message.editedAt && !deleted && " · edited"}
          </p>

          {/* Reactions */}
          {groupedReactions.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {groupedReactions.map(([emoji, userIds]) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`Reaction ${emoji} by ${userIds.length}`}
                  onClick={() => {
                    if (!identity) return;
                    getRealtimeService().publishCommand("reaction.remove", {
                      conversationId: message.conversationId,
                      messageId: message.id,
                      emoji,
                    });
                  }}
                  className="rounded-full bg-slate-100 px-1.5 py-0.5 text-xs hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600"
                >
                  {emoji} {userIds.length}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Hover actions */}
        {!deleted && !editing && (
          <div
            className={`mt-0.5 flex gap-1 opacity-0 transition group-hover:opacity-100 ${
              isOwn ? "justify-end" : ""
            }`}
          >
            <button
              type="button"
              aria-label="Add reaction"
              onClick={() => {
                setShowEmojiPicker((v) => !v);
              }}
              className="rounded px-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              😊+
            </button>
            {onReply && (
              <button
                type="button"
                aria-label="Reply to message"
                data-testid="reply-action"
                onClick={() => onReply(message)}
                className="rounded px-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                ↩ Reply
              </button>
            )}
            {isOwn && (
              <>
                <button
                  type="button"
                  aria-label="Edit message"
                  onClick={() => {
                    setEditText(message.content);
                    setEditing(true);
                  }}
                  className="rounded px-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  Edit
                </button>
                <button
                  type="button"
                  aria-label="Delete message"
                  onClick={() => {
                    getRealtimeService().publishCommand("message.delete", {
                      conversationId: message.conversationId,
                      messageId: message.id,
                    });
                  }}
                  className="rounded px-1 text-xs text-red-400 hover:text-red-600"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        )}

        {showEmojiPicker && (
          <div className="mt-1 flex gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            {QUICK_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`React with ${emoji}`}
                onClick={() => {
                  setShowEmojiPicker(false);
                  getRealtimeService().publishCommand("reaction.add", {
                    conversationId: message.conversationId,
                    messageId: message.id,
                    emoji,
                  });
                }}
                className="rounded-lg px-1.5 py-0.5 text-base hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
