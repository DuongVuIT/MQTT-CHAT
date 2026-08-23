import { z } from "zod";
import type { EventEnvelope } from "./envelope";

/**
 * Canonical event data schemas. Types are inferred from schemas.
 */

export const messageEventDataSchema = z.object({
  messageId: z.string().min(1),
  clientMessageId: z.string().min(1),
  conversationId: z.string().min(1),
  senderId: z.string().min(1),
  senderType: z.enum(["USER", "BOT", "SYSTEM"]),
  sequence: z.number().int().positive(),
  type: z.enum(["TEXT", "IMAGE", "VIDEO", "FILE", "VOICE", "SYSTEM"]),
  content: z.string(),
  replyToId: z.string().nullable().default(null),
  metadata: z.record(z.unknown()).nullable().default(null),
  createdAt: z.string().datetime(),
});
export type MessageEventData = z.infer<typeof messageEventDataSchema>;
export type MessageCreatedEvent = EventEnvelope<MessageEventData>;

export const messageEditedDataSchema = z.object({
  messageId: z.string().min(1),
  conversationId: z.string().min(1),
  content: z.string(),
  editedAt: z.string().datetime(),
});
export type MessageEditedData = z.infer<typeof messageEditedDataSchema>;
export type MessageEditedEvent = EventEnvelope<MessageEditedData>;

export const messageDeletedDataSchema = z.object({
  messageId: z.string().min(1),
  conversationId: z.string().min(1),
  deletedAt: z.string().datetime(),
});
export type MessageDeletedData = z.infer<typeof messageDeletedDataSchema>;
export type MessageDeletedEvent = EventEnvelope<MessageDeletedData>;

export const reactionAddedDataSchema = z.object({
  messageId: z.string().min(1),
  conversationId: z.string().min(1),
  userId: z.string().min(1),
  emoji: z.string().min(1).max(16),
});
export type ReactionAddedData = z.infer<typeof reactionAddedDataSchema>;
export type ReactionAddedEvent = EventEnvelope<ReactionAddedData>;

export const reactionRemovedDataSchema = reactionAddedDataSchema;
export type ReactionRemovedData = ReactionAddedData;
export type ReactionRemovedEvent = EventEnvelope<ReactionRemovedData>;

export const receiptReadDataSchema = z.object({
  conversationId: z.string().min(1),
  userId: z.string().min(1),
  lastReadSequence: z.number().int().positive(),
});
export type ReceiptReadData = z.infer<typeof receiptReadDataSchema>;
export type ReceiptReadEvent = EventEnvelope<ReceiptReadData>;

export const typingEventDataSchema = z.object({
  conversationId: z.string().min(1),
  userId: z.string().min(1),
});
export type TypingEventData = z.infer<typeof typingEventDataSchema>;
export type TypingStartedEvent = EventEnvelope<TypingEventData>;
export type TypingStoppedEvent = EventEnvelope<TypingEventData>;

export const presenceEventDataSchema = z.object({
  userId: z.string().min(1),
  deviceId: z.string().min(1),
  /** Number of remaining active connections for this user (after the change). */
  connectionCount: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
});
export type PresenceEventData = z.infer<typeof presenceEventDataSchema>;
export type PresenceOnlineEvent = EventEnvelope<PresenceEventData>;
export type PresenceOfflineEvent = EventEnvelope<PresenceEventData>;

export const conversationMemberEventDataSchema = z.object({
  conversationId: z.string().min(1),
  userId: z.string().min(1),
});
export type ConversationMemberEventData = z.infer<typeof conversationMemberEventDataSchema>;

/**
 * conversation.created payload — mirrors the REST list-conversations item
 * shape so clients can insert the conversation into their list directly
 * without a refetch. `members` is REQUIRED: the canonical conversation
 * contract always carries its members.
 */
export const conversationMemberSummarySchema = z.object({
  userId: z.string().min(1),
  role: z.string().min(1),
  lastReadSequence: z.number().int().nonnegative(),
});
export type ConversationMemberSummary = z.infer<typeof conversationMemberSummarySchema>;

export const conversationCreatedDataSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["DIRECT", "GROUP"]),
  title: z.string().nullable(),
  memberCount: z.number().int().positive(),
  lastSequence: z.number().int().nonnegative(),
  lastMessagePreview: z.string().nullable(),
  lastMessageAt: z.string().datetime().nullable(),
  members: z.array(conversationMemberSummarySchema).min(1),
  createdAt: z.string().datetime(),
});
export type ConversationCreatedData = z.infer<typeof conversationCreatedDataSchema>;
export type ConversationCreatedEvent = EventEnvelope<ConversationCreatedData>;

/** Map of eventType -> data schema, used by consumers for validation. */
export const EVENT_SCHEMAS = {
  "message.created": messageEventDataSchema,
  "message.edited": messageEditedDataSchema,
  "message.deleted": messageDeletedDataSchema,
  "reaction.added": reactionAddedDataSchema,
  "reaction.removed": reactionRemovedDataSchema,
  "receipt.read": receiptReadDataSchema,
  "typing.started": typingEventDataSchema,
  "typing.stopped": typingEventDataSchema,
  "presence.online": presenceEventDataSchema,
  "presence.offline": presenceEventDataSchema,
  "conversation.created": conversationCreatedDataSchema,
} as const;

export type EventType = keyof typeof EVENT_SCHEMAS;
