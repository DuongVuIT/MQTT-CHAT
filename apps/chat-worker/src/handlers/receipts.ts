import { toPrismaJson } from "@mqtt-chat/database";
import {
  buildEventEnvelope,
  userEventTopic,
  type CommandEnvelope,
  type ReadReceiptCommand,
  type DeliveredReceiptCommand,
} from "@mqtt-chat/mqtt-contracts";
import type { WorkerContext } from "../context";

/**
 * Receipt handlers.
 * lastReadSequence / lastDeliveredSequence are monotonic high-water marks —
 * no per-message read rows. Events are targeted at the message sender via
 * per-user topics.
 */

export async function handleReceiptRead(
  ctx: WorkerContext,
  envelope: CommandEnvelope<ReadReceiptCommand>,
): Promise<void> {
  const data = envelope.data;
  const userId = envelope.actor.userId;
  if (!userId) return;

  const membership = await ctx.db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: data.conversationId, userId } },
  });
  if (!membership) return;

  if (data.lastReadSequence <= membership.lastReadSequence) return; // stale/out-of-order — idempotent

  await ctx.db.conversationMember.update({
    where: { conversationId_userId: { conversationId: data.conversationId, userId } },
    data: { lastReadSequence: data.lastReadSequence },
  });
  await ctx.unread.reset(userId, data.conversationId).catch(() => undefined);

  // Notify other members (esp. the sender) via per-user topics.
  const others = await ctx.db.conversationMember.findMany({
    where: { conversationId: data.conversationId, userId: { not: userId } },
    select: { userId: true },
  });

  const event = buildEventEnvelope({
    eventType: "receipt.read",
    origin: { type: "user", id: userId },
    actor: { userId, deviceId: envelope.actor.deviceId },
    conversationId: data.conversationId,
    correlationId: envelope.correlationId,
    data: {
      conversationId: data.conversationId,
      userId,
      lastReadSequence: data.lastReadSequence,
    },
  });

  await Promise.all(
    others.map((m) =>
      ctx.db.outboxEvent.create({
        data: {
          eventType: "receipt.read",
          aggregateType: "ConversationMember",
          aggregateId: `${data.conversationId}:${m.userId}`,
          topic: userEventTopic(m.userId, "receipt/read"),
          payload: toPrismaJson(event),
        },
      }),
    ),
  );
}

export async function handleReceiptDelivered(
  ctx: WorkerContext,
  envelope: CommandEnvelope<DeliveredReceiptCommand>,
): Promise<void> {
  const data = envelope.data;
  const userId = envelope.actor.userId;
  if (!userId) return;

  const membership = await ctx.db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: data.conversationId, userId } },
  });
  if (!membership) return;
  if (data.lastDeliveredSequence <= membership.lastDeliveredSequence) return; // idempotent

  await ctx.db.conversationMember.update({
    where: { conversationId_userId: { conversationId: data.conversationId, userId } },
    data: { lastDeliveredSequence: data.lastDeliveredSequence },
  });

  const others = await ctx.db.conversationMember.findMany({
    where: { conversationId: data.conversationId, userId: { not: userId } },
    select: { userId: true },
  });

  const event = buildEventEnvelope({
    eventType: "receipt.delivered",
    origin: { type: "user", id: userId },
    actor: { userId, deviceId: envelope.actor.deviceId },
    conversationId: data.conversationId,
    correlationId: envelope.correlationId,
    data: {
      conversationId: data.conversationId,
      userId,
      lastDeliveredSequence: data.lastDeliveredSequence,
    },
  });

  await Promise.all(
    others.map((m) =>
      ctx.db.outboxEvent.create({
        data: {
          eventType: "receipt.delivered",
          aggregateType: "ConversationMember",
          aggregateId: `${data.conversationId}:${m.userId}`,
          topic: userEventTopic(m.userId, "receipt/delivered"),
          payload: toPrismaJson(event),
        },
      }),
    ),
  );
}
