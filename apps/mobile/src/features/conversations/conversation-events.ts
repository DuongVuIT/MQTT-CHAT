/**
 * Pure conversation-list event reducers (mobile).
 *
 * The realtime handler in useChatSession delegates ALL conversation-list
 * mutations here so the Web→Mobile discovery lifecycle is unit-testable
 * without React. Historical P0: the mobile handler had NO cases for
 * conversation.created / member-joined / member-left, so groups created on
 * Web only appeared after an app reload.
 *
 * Identity semantics: ONE conversationId = ONE entity, upsert everywhere,
 * never append blindly (duplicate-key regression class).
 */

import { advanceMemberWatermark, normalizeConversation } from "@mqtt-chat/realtime-core";
import type { ApiConversation, ApiMessage } from "@app/lib/api";

export type ConversationEventTypeName =
  | "conversation.created"
  | "conversation.updated"
  | "conversation.deleted"
  | "conversation.member-joined"
  | "conversation.member-left";

/**
 * Apply a canonical conversation lifecycle event to a list.
 *
 * @param list current list (order: most recent first)
 * @param eventType canonical event type
 * @param data raw event payload (normalized here — never trust wire shapes)
 * @param selfUserId active runtime identity — membership is judged by ID
 * @returns next list; identical reference when nothing changed
 */
export function applyConversationEvent(
  list: ApiConversation[],
  eventType: ConversationEventTypeName,
  data: unknown,
  selfUserId: string | null,
): ApiConversation[] {
  // Deleted group (#28): tombstone event carries the pre-delete member
  // snapshot — every relevant client removes the entity deterministically.
  if (eventType === "conversation.deleted") {
    const raw = (data ?? {}) as Record<string, unknown>;
    const deletedId = typeof raw["id"] === "string" ? raw["id"] : "";
    if (!deletedId) return list;
    const memberIds = Array.isArray(raw["memberIds"])
      ? (raw["memberIds"] as unknown[]).filter(
          (memberId): memberId is string => typeof memberId === "string",
        )
      : [];
    if (selfUserId !== null && memberIds.length > 0 && !memberIds.includes(selfUserId)) {
      return list; // not my problem
    }
    return list.filter((conversation) => conversation.id !== deletedId);
  }

  const conversation = normalizeConversation(data);
  if (!conversation.id) return list;

  // Removed while I was a member → drop the entity entirely.
  if (eventType === "conversation.member-left") {
    const rawRemoved = (data as Record<string, unknown>)?.["removedUserId"];
    if (rawRemoved === selfUserId) {
      return list.filter((candidate) => candidate.id !== conversation.id);
    }
    if (!list.some((candidate) => candidate.id === conversation.id)) return list;
    return upsertPreservingActivity(list, conversation);
  }

  // created / updated / member-joined: relevant when I am (still) a member.
  const isMember = conversation.members.some((member) => member.userId === selfUserId);
  if (!isMember && eventType === "conversation.created") return list;
  if (!isMember && !list.some((candidate) => candidate.id === conversation.id)) return list;

  return upsertPreservingActivity(list, conversation);
}

/** Membership events carry no message info — keep locally-known activity. */
function upsertPreservingActivity(
  list: ApiConversation[],
  incoming: ApiConversation,
): ApiConversation[] {
  const existing = list.find((conversation) => conversation.id === incoming.id);
  const merged: ApiConversation = existing
    ? {
        ...incoming,
        lastMessagePreview: incoming.lastMessagePreview ?? existing.lastMessagePreview,
        lastMessageAt: incoming.lastMessageAt ?? existing.lastMessageAt,
        lastSequence: Math.max(existing.lastSequence ?? 0, incoming.lastSequence ?? 0),
      }
    : incoming;
  return existing
    ? list.map((conversation) => (conversation.id === incoming.id ? merged : conversation))
    : [merged, ...list];
}

/**
 * Reflect a canonical message.created onto the conversation list summary
 * (lastSequence monotonic, preview, timestamp) and re-sort by activity —
 * the list reacts to new messages with NO reload (§45/§46).
 */
export function applyMessageActivity(
  list: ApiConversation[],
  input: {
    conversationId: string;
    sequence: number;
    preview: string | null;
    at: string;
  },
): ApiConversation[] {
  const updated = list.map((conversation) => {
    if (conversation.id !== input.conversationId) return conversation;
    const lastSequence = conversation.lastSequence ?? 0;
    if (input.sequence <= lastSequence) return conversation;
    return {
      ...conversation,
      lastSequence: input.sequence,
      lastMessagePreview: input.preview ?? conversation.lastMessagePreview ?? null,
      lastMessageAt: input.at,
    };
  });
  return sortByActivity(updated);
}

/**
 * Apply a canonical receipt.read event to the conversation list — REG-02.
 *
 * Advances ONE member's lastReadSequence watermark through the shared
 * monotonic merge from @mqtt-chat/realtime-core:
 *  - the READER's own watermark → the unread badge (`lastSequence − myRead`)
 *    clears on every device of that user;
 *  - OTHER members' watermarks → ✓✓ read ticks advance live in transcripts.
 * Stale/duplicate QoS1 deliveries are no-ops (watermark never regresses).
 *
 * @returns next list; identical reference when nothing changed
 */
export function applyReadReceipt(
  list: ApiConversation[],
  input: { conversationId: string; userId: string; lastReadSequence: number },
): ApiConversation[] {
  let changed = false;
  const nextList = list.map((conversation) => {
    if (conversation.id !== input.conversationId) return conversation;
    const members = advanceMemberWatermark(
      conversation.members,
      input.userId,
      input.lastReadSequence,
    );
    if (!members) return conversation;
    changed = true;
    return { ...conversation, members };
  });
  return changed ? nextList : list;
}

/** Most recently active conversation first (creation order is meaningless). */
export function sortByActivity(list: ApiConversation[]): ApiConversation[] {
  return [...list].sort((firstConversation, secondConversation) => {
    const firstTimestamp = firstConversation.lastMessageAt
      ? Date.parse(firstConversation.lastMessageAt)
      : 0;
    const secondTimestamp = secondConversation.lastMessageAt
      ? Date.parse(secondConversation.lastMessageAt)
      : 0;
    return secondTimestamp - firstTimestamp;
  });
}

export type MessageReactionEventTypeName = "reaction.added" | "reaction.removed";

/**
 * Apply a canonical reaction event to ONE conversation's message list.
 *
 * Authoritative by event type and idempotent under QoS1 redelivery: the
 * list is driven to the target state (present for added, absent for
 * removed) — re-applying the same event is a no-op. A blind toggle would
 * flip-flop on redeliveries. Malformed payloads never mutate the list.
 */
export function applyReactionEvent(
  list: ApiMessage[],
  eventType: MessageReactionEventTypeName,
  data: unknown,
): ApiMessage[] {
  const eventData = (data ?? {}) as Record<string, unknown>;
  const messageId = typeof eventData["messageId"] === "string" ? eventData["messageId"] : "";
  const emoji = typeof eventData["emoji"] === "string" ? eventData["emoji"] : "";
  const userId = typeof eventData["userId"] === "string" ? eventData["userId"] : "";
  if (!messageId || !emoji || !userId) return list;

  const wantPresent = eventType === "reaction.added";
  let changed = false;
  const nextList = list.map((message) => {
    if (message.id !== messageId) return message;
    const reactions = message.reactions ?? [];
    const exists = reactions.some(
      (reaction) => reaction.emoji === emoji && reaction.userId === userId,
    );
    if (exists === wantPresent) return message;
    changed = true;
    return {
      ...message,
      reactions: wantPresent
        ? [...reactions, { emoji, userId }]
        : reactions.filter((reaction) => !(reaction.emoji === emoji && reaction.userId === userId)),
    };
  });
  return changed ? nextList : list;
}
