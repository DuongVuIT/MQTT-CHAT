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

import { normalizeConversation } from '@mqtt-chat/realtime-core';
import type { ApiConversation, ApiMessage } from '../../lib/api';

export type ConversationEventTypeName =
  | 'conversation.created'
  | 'conversation.updated'
  | 'conversation.member-joined'
  | 'conversation.member-left';

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
  const conversation = normalizeConversation(data);
  if (!conversation.id) return list;

  // Removed while I was a member → drop the entity entirely.
  if (eventType === 'conversation.member-left') {
    const rawRemoved = (data as Record<string, unknown>)?.['removedUserId'];
    if (rawRemoved === selfUserId) {
      return list.filter(c => c.id !== conversation.id);
    }
    if (!list.some(c => c.id === conversation.id)) return list;
    return upsertPreservingActivity(list, conversation);
  }

  // created / updated / member-joined: relevant when I am (still) a member.
  const isMember = conversation.members.some(m => m.userId === selfUserId);
  if (!isMember && eventType === 'conversation.created') return list;
  if (!isMember && !list.some(c => c.id === conversation.id)) return list;

  return upsertPreservingActivity(list, conversation);
}

/** Membership events carry no message info — keep locally-known activity. */
function upsertPreservingActivity(
  list: ApiConversation[],
  incoming: ApiConversation,
): ApiConversation[] {
  const existing = list.find(c => c.id === incoming.id);
  const merged: ApiConversation = existing
    ? {
        ...incoming,
        lastMessagePreview:
          incoming.lastMessagePreview ?? existing.lastMessagePreview,
        lastMessageAt: incoming.lastMessageAt ?? existing.lastMessageAt,
        lastSequence: Math.max(
          existing.lastSequence ?? 0,
          incoming.lastSequence ?? 0,
        ),
      }
    : incoming;
  return existing
    ? list.map(c => (c.id === incoming.id ? merged : c))
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
  const updated = list.map(c => {
    if (c.id !== input.conversationId) return c;
    const lastSequence = c.lastSequence ?? 0;
    if (input.sequence <= lastSequence) return c; // monotonic — never regress
    return {
      ...c,
      lastSequence: input.sequence,
      lastMessagePreview: input.preview ?? c.lastMessagePreview ?? null,
      lastMessageAt: input.at,
    };
  });
  return sortByActivity(updated);
}

/** Most recently active conversation first (creation order is meaningless). */
export function sortByActivity(list: ApiConversation[]): ApiConversation[] {
  return [...list].sort((a, b) => {
    const ta = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
    const tb = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
    return tb - ta;
  });
}

export type MessageReactionEventTypeName =
  'reaction.added' | 'reaction.removed';

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
  const d = (data ?? {}) as Record<string, unknown>;
  const messageId = typeof d['messageId'] === 'string' ? d['messageId'] : '';
  const emoji = typeof d['emoji'] === 'string' ? d['emoji'] : '';
  const userId = typeof d['userId'] === 'string' ? d['userId'] : '';
  if (!messageId || !emoji || !userId) return list;

  const wantPresent = eventType === 'reaction.added';
  let changed = false;
  const next = list.map(m => {
    if (m.id !== messageId) return m;
    const reactions = m.reactions ?? [];
    const exists = reactions.some(
      r => r.emoji === emoji && r.userId === userId,
    );
    if (exists === wantPresent) return m; // already in the target state
    changed = true;
    return {
      ...m,
      reactions: wantPresent
        ? [...reactions, { emoji, userId }]
        : reactions.filter(r => !(r.emoji === emoji && r.userId === userId)),
    };
  });
  return changed ? next : list;
}
