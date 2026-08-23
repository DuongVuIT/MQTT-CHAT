import { z } from "zod";
import type { CommandEnvelope } from "./envelope";

/**
 * Command payload schemas. Types are inferred from schemas (single source of truth).
 */

export const sendMessageCommandSchema = z
  .object({
    conversationId: z.string().min(1),
    clientMessageId: z.string().min(1),
    type: z.enum(["TEXT", "IMAGE", "VIDEO", "FILE", "VOICE"]),
    content: z.string().max(10_000).default(""),
    replyToId: z.string().min(1).nullable().default(null),
    metadata: z.record(z.unknown()).nullable().default(null),
  })
  .refine((cmd) => cmd.type !== "TEXT" || cmd.content.trim().length > 0, {
    message: "TEXT messages require non-empty content",
    path: ["content"],
  });
export type SendMessageCommand = z.infer<typeof sendMessageCommandSchema>;
export type SendMessageEnvelope = CommandEnvelope<SendMessageCommand>;

export const editMessageCommandSchema = z.object({
  messageId: z.string().min(1),
  conversationId: z.string().min(1),
  content: z.string().max(10_000),
});
export type EditMessageCommand = z.infer<typeof editMessageCommandSchema>;
export type EditMessageEnvelope = CommandEnvelope<EditMessageCommand>;

export const deleteMessageCommandSchema = z.object({
  messageId: z.string().min(1),
  conversationId: z.string().min(1),
});
export type DeleteMessageCommand = z.infer<typeof deleteMessageCommandSchema>;
export type DeleteMessageEnvelope = CommandEnvelope<DeleteMessageCommand>;

export const addReactionCommandSchema = z.object({
  messageId: z.string().min(1),
  conversationId: z.string().min(1),
  emoji: z.string().min(1).max(16),
});
export type AddReactionCommand = z.infer<typeof addReactionCommandSchema>;
export type AddReactionEnvelope = CommandEnvelope<AddReactionCommand>;

export const removeReactionCommandSchema = addReactionCommandSchema;
export type RemoveReactionCommand = AddReactionCommand;
export type RemoveReactionEnvelope = AddReactionEnvelope;

export const readReceiptCommandSchema = z.object({
  conversationId: z.string().min(1),
  lastReadSequence: z.number().int().positive(),
});
export type ReadReceiptCommand = z.infer<typeof readReceiptCommandSchema>;
export type ReadReceiptEnvelope = CommandEnvelope<ReadReceiptCommand>;

/** Client ack: messages up to this sequence were received by this device. */
export const deliveredReceiptCommandSchema = z.object({
  conversationId: z.string().min(1),
  lastDeliveredSequence: z.number().int().positive(),
});
export type DeliveredReceiptCommand = z.infer<typeof deliveredReceiptCommandSchema>;
export type DeliveredReceiptEnvelope = CommandEnvelope<DeliveredReceiptCommand>;

/** Presence command — published on connect and via MQTT LWT on abrupt disconnect. */
export const presenceSetCommandSchema = z.object({
  isOnline: z.boolean(),
});
export type PresenceSetCommand = z.infer<typeof presenceSetCommandSchema>;
export type PresenceSetEnvelope = CommandEnvelope<PresenceSetCommand>;

export const typingSetCommandSchema = z.object({
  conversationId: z.string().min(1),
  isTyping: z.boolean(),
});
export type TypingSetCommand = z.infer<typeof typingSetCommandSchema>;
export type TypingSetEnvelope = CommandEnvelope<TypingSetCommand>;

/** Bot send command — bots request message creation through chat-worker. */
export const botSendCommandSchema = z
  .object({
    conversationId: z.string().min(1),
    clientMessageId: z.string().min(1),
    botId: z.string().min(1),
    type: z.enum(["TEXT", "IMAGE", "FILE"]).default("TEXT"),
    content: z.string().max(10_000).default(""),
    replyToId: z.string().min(1).nullable().default(null),
    metadata: z.record(z.unknown()).nullable().default(null),
    /** Traceability for automation chains. */
    correlationId: z.string().min(1).optional(),
    causationId: z.string().min(1).optional(),
    ruleId: z.string().min(1).optional(),
  })
  .refine((cmd) => cmd.type !== "TEXT" || cmd.content.trim().length > 0, {
    message: "TEXT messages require non-empty content",
    path: ["content"],
  });
export type BotSendCommand = z.infer<typeof botSendCommandSchema>;
export type BotSendEnvelope = CommandEnvelope<BotSendCommand>;

/** Map of commandType -> payload schema, used by the chat-worker dispatcher. */
export const COMMAND_SCHEMAS = {
  "message.send": sendMessageCommandSchema,
  "message.edit": editMessageCommandSchema,
  "message.delete": deleteMessageCommandSchema,
  "reaction.add": addReactionCommandSchema,
  "reaction.remove": removeReactionCommandSchema,
  "receipt.read": readReceiptCommandSchema,
  "receipt.delivered": deliveredReceiptCommandSchema,
  "presence.set": presenceSetCommandSchema,
  "typing.set": typingSetCommandSchema,
  "bot.send": botSendCommandSchema,
} as const;

export type CommandType = keyof typeof COMMAND_SCHEMAS;
