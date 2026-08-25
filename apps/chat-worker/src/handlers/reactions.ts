import { Prisma, toPrismaJson } from "@mqtt-chat/database";
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

  try {
    await ctx.db.$transaction(async (tx) => {
      // Create (not upsert) lets the composite PK distinguish a real state
      // transition from a QoS1 duplicate. Only the transition gets an event.
      await tx.messageReaction.create({
        data: {
          messageId: data.messageId,
          userId,
          emoji: data.emoji,
          conversationId: data.conversationId,
        },
      });
      await tx.outboxEvent.create({
        data: {
          eventType: "reaction.added",
          aggregateType: "Message",
          aggregateId: data.messageId,
          topic: EVENT_TOPICS.reactionAdded,
          payload: toPrismaJson(event),
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return;
    }
    throw error;
  }
}

export async function handleReactionRemove(
  ctx: WorkerContext,
  envelope: CommandEnvelope<AddReactionCommand>,
): Promise<void> {
  const data = envelope.data;
  const userId = envelope.actor.userId;
  if (!userId) return;

  const membership = await ctx.db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: data.conversationId, userId } },
  });
  if (!membership) return;

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

  await ctx.db.$transaction(async (tx) => {
    const removed = await tx.messageReaction.deleteMany({
      where: {
        messageId: data.messageId,
        userId,
        emoji: data.emoji,
        conversationId: data.conversationId,
      },
    });
    if (removed.count === 0) return;
    await tx.outboxEvent.create({
      data: {
        eventType: "reaction.removed",
        aggregateType: "Message",
        aggregateId: data.messageId,
        topic: EVENT_TOPICS.reactionRemoved,
        payload: toPrismaJson(event),
      },
    });
  });
}
