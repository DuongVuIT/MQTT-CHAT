"use client";

import { memo, useState } from "react";
import { mediaViewUrl, type ApiMessage } from "@/lib/api";
import { getRealtimeService } from "@/lib/realtime-service";
import { useChatStore } from "@/store/chat-store";
import { retryPendingMessage } from "@/components/Composer";
import type { ChatRow } from "@/lib/message-rows";

const QUICK_EMOJIS = ["👍", "❤️", "😂", "🎉", "😮"] as const;

interface PendingProps {
  content: string;
  status: "queued" | "pending" | "failed";
  clientMessageId: string;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

const FILE_GLYPHS: Array<[RegExp, string]> = [
  [/pdf/i, "📕"],
  [/text\/|^(.*\.(txt|md|csv))$/i, "📄"],
  [/zip|tar|gz|rar/i, "🗂️"],
  [/sheet|csv|xlsx/i, "📊"],
];

function fileGlyph(mimeType: string, filename: string): string {
  for (const [re, glyph] of FILE_GLYPHS) {
    if (re.test(mimeType) || re.test(filename)) return glyph;
  }
  return "📎";
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

/** Quoted-preview text with a graceful fallback when the target isn't loaded. */
function quoteText(source: ApiMessage | null): string {
  if (!source) return "Original message unavailable";
  if (source.deletedAt) return "Message deleted";
  if (source.type === "TEXT" || !source.metadata) return source.content || "(empty)";
  return `📎 ${String(source.metadata["filename"] ?? "Attachment")}`;
}

export const MessageBubble = memo(function MessageBubble({
  row,
  pending,
  isOwn,
  isNew,
  onReply,
}: {
  /** Canonical row (message + grouping/chips/receipts) — absent for pending. */
  row?: Extract<ChatRow, { kind: "message" }>;
  pending?: PendingProps;
  isOwn: boolean;
  /** Entrance motion only for rows that arrived live (§41 — never history). */
  isNew?: boolean;
  /** Raise a reply intent — provided by the page via MessageList. */
  onReply?: (message: ApiMessage) => void;
}) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const identity = useChatStore((s) => s.identity);

  if (pending) {
    return (
      <div className={`mb-1.5 flex ${isOwn ? "justify-end" : "justify-start"}`}>
        <div
          className={`max-w-[70%] rounded-2xl px-3.5 py-2 text-sm ${
            pending.status === "failed" ? "bg-danger-soft text-danger" : "bg-brand-soft text-ink-2"
          }`}
          data-testid="pending-message"
        >
          <p className="whitespace-pre-wrap break-words">{pending.content}</p>
          <p className="mt-0.5 flex items-center justify-end gap-1.5 text-[10px] opacity-80">
            {pending.status === "failed"
              ? "Failed to send"
              : pending.status === "queued"
                ? "Waiting for connection…"
                : "Sending…"}
            {pending.status === "failed" && (
              <button
                type="button"
                aria-label="Retry send"
                data-testid="retry-pending"
                onClick={() => {
                  // Faithful retry — same clientMessageId + full payload.
                  retryPendingMessage(pending.clientMessageId);
                }}
                className="rounded px-1.5 py-0.5 font-semibold text-danger hover:bg-danger/10"
              >
                Retry
              </button>
            )}
          </p>
        </div>
      </div>
    );
  }

  if (!row || !identity) return null;
  const message = row.message;
  const deleted = message.deletedAt !== null;
  const isBot = message.senderType === "BOT";
  const isSystem = message.senderType === "SYSTEM";

  if (isSystem) {
    return (
      <div className="my-2 text-center">
        <span className="rounded-full bg-surface px-3 py-1 text-xs text-ink-3">
          {message.content}
        </span>
      </div>
    );
  }

  // Corner shaping follows the sender run (§12): run head keeps round top
  // corners; the tail tightens toward the sender.
  const corners = isOwn
    ? `${row.startsGroup ? "rounded-tr-2xl" : "rounded-tr-md"} ${
        row.endsGroup ? "rounded-br-2xl" : "rounded-br-md"
      } rounded-tl-2xl rounded-bl-2xl`
    : `${row.startsGroup ? "rounded-tl-2xl" : "rounded-tl-md"} ${
        row.endsGroup ? "rounded-bl-2xl" : "rounded-bl-md"
      } rounded-tr-2xl rounded-br-2xl`;

  const toggleChip = (emoji: string, mine: boolean): void => {
    getRealtimeService().publishCommand(mine ? "reaction.remove" : "reaction.add", {
      conversationId: message.conversationId,
      messageId: message.id,
      emoji,
    });
  };

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
    <div
      className={`group/row mb-0.5 flex ${isOwn ? "justify-end" : "justify-start"} ${row.startsGroup ? "mt-2.5" : ""}`}
    >
      <div
        className={`flex max-w-[min(70%,42rem)] items-end gap-2 ${isOwn ? "flex-row-reverse" : ""}`}
      >
        {!isOwn && (
          <span
            className={`mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
              row.startsGroup ? "bg-high text-ink" : "bg-transparent text-transparent"
            }`}
            aria-hidden={!row.startsGroup}
          >
            {isBot ? "🤖" : message.senderName.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          {row.showSender && (
            <p className="mb-0.5 pl-1 text-xs font-semibold text-ink-2">
              {message.senderName}
              {isBot && (
                <span className="ml-1.5 rounded bg-brand-soft px-1 py-px text-[10px] font-medium text-brand-strong">
                  BOT
                </span>
              )}
            </p>
          )}

          <div
            className={`relative px-3.5 py-2 text-sm ${corners} ${
              isOwn ? "bg-brand text-on-brand" : "bg-raised text-ink"
            } ${deleted ? "italic opacity-60" : ""} ${isNew ? "animate-bubble-in" : ""}`}
            data-testid={isOwn ? "own-message" : "other-message"}
          >
            {/* Quoted reply preview (§15) — accent line + sender + truncated. */}
            {!editing && message.replyToId && (
              <div
                className={`mb-1.5 rounded-md border-l-2 px-2 py-1 text-xs ${
                  isOwn
                    ? "border-white/50 bg-white/10 text-white/90"
                    : "border-brand-strong bg-brand-soft text-ink-2"
                }`}
              >
                <p className="font-semibold">{row.replySource?.senderName ?? "Reply"}</p>
                <p className="truncate opacity-80">{quoteText(row.replySource)}</p>
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
                  className="w-56 rounded border border-line-strong bg-transparent px-1 py-0.5 text-sm outline-none"
                />
                <button
                  type="button"
                  onClick={saveEdit}
                  aria-label="Save edit"
                  className="rounded px-1 underline"
                >
                  Save
                </button>
              </span>
            ) : deleted ? (
              <p>Message deleted</p>
            ) : message.type === "IMAGE" && mediaSrc(message) ? (
              // Reserved dimensions prevent post-load layout shift (§54).
              <img
                src={mediaSrc(message) ?? undefined}
                alt={String(message.metadata?.["filename"] ?? "image")}
                width={320}
                height={240}
                loading="lazy"
                className="max-h-64 w-auto rounded-lg bg-app object-cover"
              />
            ) : message.type !== "TEXT" && message.type !== "SYSTEM" ? (
              // File card (§21): icon + name + size — no raw keys/URLs.
              <span className="flex min-w-[12rem] items-center gap-2.5 py-0.5">
                <span aria-hidden className="text-2xl">
                  {fileGlyph(
                    String(message.metadata?.["mimeType"] ?? ""),
                    String(message.metadata?.["filename"] ?? ""),
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {String(message.metadata?.["filename"] ?? "Attachment")}
                  </span>
                  <span className={`block text-[11px] ${isOwn ? "text-white/70" : "text-ink-3"}`}>
                    {typeof message.metadata?.["size"] === "number"
                      ? formatSize(message.metadata["size"])
                      : "File"}
                  </span>
                </span>
              </span>
            ) : (
              <p className="whitespace-pre-wrap break-words">{message.content}</p>
            )}

            <p
              className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] ${
                isOwn ? "text-white/60" : "text-ink-3"
              }`}
            >
              {message.editedAt && !deleted && <span>edited</span>}
              <span>{formatTime(message.createdAt)}</span>
              {/* Delivery receipts (§14): quiet ticks, never large words. */}
              {isOwn && !deleted && (
                <span
                  aria-label={row.read ? "Read" : "Sent"}
                  className={`tracking-tighter ${row.read ? "text-white" : "text-white/60"}`}
                >
                  {row.read ? "✓✓" : "✓"}
                </span>
              )}
            </p>
          </div>

          {/* Reaction chips (§16): compact, own-reaction highlighted, tap to
              toggle — adding AND removing, state-aware. */}
          {row.chips.length > 0 && (
            <div className={`mt-1 flex flex-wrap gap-1 ${isOwn ? "justify-end" : ""}`}>
              {row.chips.map((chip) => (
                <button
                  key={chip.emoji}
                  type="button"
                  aria-label={
                    chip.mine
                      ? `Remove your ${chip.emoji} reaction (${chip.count} total)`
                      : `React ${chip.emoji} (${chip.count})`
                  }
                  data-testid={`reaction-${chip.emoji}`}
                  onClick={() => {
                    toggleChip(chip.emoji, chip.mine);
                  }}
                  className={`flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors duration-fast ${
                    chip.mine
                      ? "border-brand bg-brand-soft text-brand-strong"
                      : "border-line bg-surface text-ink-2 hover:bg-high"
                  }`}
                >
                  <span aria-hidden>{chip.emoji}</span>
                  {chip.count > 1 && <span className="font-semibold">{chip.count}</span>}
                </button>
              ))}
            </div>
          )}

          {/* Hover actions — also keyboard-reachable via focus-within (§68). */}
          {!deleted && !editing && (
            <div
              className={`mt-0.5 flex gap-0.5 opacity-0 transition-opacity duration-fast focus-within:opacity-100 group-hover/row:opacity-100 ${
                isOwn ? "justify-end" : ""
              }`}
            >
              <button
                type="button"
                aria-label="Add reaction"
                onClick={() => {
                  setShowEmojiPicker((v) => !v);
                }}
                className="rounded px-1.5 py-0.5 text-xs text-ink-3 hover:text-ink"
              >
                😊+
              </button>
              {onReply && (
                <button
                  type="button"
                  aria-label="Reply to message"
                  data-testid="reply-action"
                  onClick={() => onReply(message)}
                  className="rounded px-1.5 py-0.5 text-xs text-ink-3 hover:text-ink"
                >
                  ↩ Reply
                </button>
              )}
              {isOwn && (
                <>
                  {message.type === "TEXT" && (
                    <button
                      type="button"
                      aria-label="Edit message"
                      onClick={() => {
                        setEditText(message.content);
                        setEditing(true);
                      }}
                      className="rounded px-1.5 py-0.5 text-xs text-ink-3 hover:text-ink"
                    >
                      Edit
                    </button>
                  )}
                  {confirmingDelete ? (
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label="Confirm delete message"
                        onClick={() => {
                          setConfirmingDelete(false);
                          getRealtimeService().publishCommand("message.delete", {
                            conversationId: message.conversationId,
                            messageId: message.id,
                          });
                        }}
                        className="rounded bg-danger px-1.5 py-0.5 text-xs font-semibold text-on-brand"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        aria-label="Cancel delete"
                        onClick={() => {
                          setConfirmingDelete(false);
                        }}
                        className="rounded border border-line-strong px-1.5 py-0.5 text-xs text-ink-2"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label="Delete message"
                      onClick={() => {
                        setConfirmingDelete(true);
                      }}
                      className="rounded px-1.5 py-0.5 text-xs text-danger/80 hover:text-danger"
                    >
                      Delete
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {showEmojiPicker && (
            <div
              className={`animate-sheet-in mt-1 flex w-fit gap-1 rounded-xl border border-line bg-surface p-1 shadow-lg ${
                isOwn ? "ml-auto" : ""
              }`}
            >
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
                  className="rounded-lg px-1.5 py-0.5 text-base hover:bg-high"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
