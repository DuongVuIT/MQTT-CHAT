import { toPrismaJson } from "@mqtt-chat/database";
import {
  buildEventEnvelope,
  EVENT_TOPICS,
  type CommandEnvelope,
  type AddReactionCommand,
} from "@mqtt-chat/mqtt-contracts";
import type { WorkerContext } from "../context";

export async function handleReactionAdd(
  ctx: WorkerContext,
  envelope: CommandEnvelope<AddReactionCommand>,
): Promise<void> {
  const data = envelope.data;
  const userId = envelope.actor.userId;
  if (!userId) return;

  const message = await ctx.db.message.findUnique({ where: { id: data.messageId } });
  if (!message || message.conversationId !== data.conversationId || message.deletedAt) {
    ctx.log.warn("reaction.add rejected: message not found", { messageId: data.messageId });
    return;
  }

  const membership = await ctx.db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: data.conversationId, userId } },
  });
  if (!membership) return;

  // Idempotent upsert (composite PK messageId+userId+emoji).
  await ctx.db.messageReaction.upsert({
    where: {
      messageId_userId_emoji: {
        messageId: data.messageId,
        userId,
        emoji: data.emoji,
      },
    },
    update: {},
    create: {
      messageId: data.messageId,
      userId,
      emoji: data.emoji,
      conversationId: data.conversationId,
    },
  });

  const event = buildEventEnvelope({
    eventType: "reaction.added",
    origin: { type: "user", id: userId },
    actor: { userId, deviceId: envelope.actor.deviceId },
    conversationId: data.conversationId,
    correlationId: envelope.correlationId,
    causationId: envelope.requestId,
    data: {
      messageId: data.messageId,
      conversationId: data.conversationId,
      userId,
      emoji: data.emoji,
    },
  });

  await ctx.db.outboxEvent.create({
    data: {
      eventType: "reaction.added",
      aggregateType: "Message",
      aggregateId: data.messageId,
      topic: EVENT_TOPICS.reactionAdded,
      payload: toPrismaJson(event),
    },
  });
}

export async function handleReactionRemove(
  ctx: WorkerContext,
  envelope: CommandEnvelope<AddReactionCommand>,
): Promise<void> {
  const data = envelope.data;
  const userId = envelope.actor.userId;
  if (!userId) return;

  const existing = await ctx.db.messageReaction.findUnique({
    where: { messageId_userId_emoji: { messageId: data.messageId, userId, emoji: data.emoji } },
  });
  if (!existing) return; // idempotent

  await ctx.db.messageReaction.delete({
    where: { messageId_userId_emoji: { messageId: data.messageId, userId, emoji: data.emoji } },
  });

  const event = buildEventEnvelope({
    eventType: "reaction.removed",
    origin: { type: "user", id: userId },
    actor: { userId, deviceId: envelope.actor.deviceId },
    conversationId: data.conversationId,
    correlationId: envelope.correlationId,
    causationId: envelope.requestId,
    data: {
      messageId: data.messageId,
      conversationId: data.conversationId,
      userId,
      emoji: data.emoji,
    },
  });

  await ctx.db.outboxEvent.create({
    data: {
      eventType: "reaction.removed",
      aggregateType: "Message",
      aggregateId: data.messageId,
      topic: EVENT_TOPICS.reactionRemoved,
      payload: toPrismaJson(event),
    },
  });
}
