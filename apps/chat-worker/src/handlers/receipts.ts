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

  const advanced = await ctx.db.$transaction(async (tx) => {
    const membership = await tx.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: data.conversationId, userId } },
      include: { conversation: { select: { lastSequence: true } } },
    });
    if (!membership) return false;

    // A client cannot read messages that do not exist. Clamping at the
    // authority prevents a malformed/hostile command from moving the
    // watermark beyond lastSequence and suppressing future unread counts.
    const acceptedSequence = Math.min(data.lastReadSequence, membership.conversation.lastSequence);
    if (acceptedSequence <= membership.lastReadSequence) return false;

    // Compare-and-advance inside the transaction. Two devices can publish
    // different watermarks concurrently; a stale update must never win the
    // last writer race and move persisted state backwards.
    const update = await tx.conversationMember.updateMany({
      where: {
        conversationId: data.conversationId,
        userId,
        lastReadSequence: { lt: acceptedSequence },
      },
      data: { lastReadSequence: acceptedSequence },
    });
    if (update.count === 0) return false;

    // Fan out to EVERY member — including the reader. Persistence and every
    // outbox row commit atomically, so a crash can never leave a durable read
    // watermark without the canonical events needed for client convergence.
    const recipients = await tx.conversationMember.findMany({
      where: { conversationId: data.conversationId },
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
        lastReadSequence: acceptedSequence,
      },
    });
    await tx.outboxEvent.createMany({
      data: recipients.map((recipient) => ({
        eventType: "receipt.read",
        aggregateType: "ConversationMember",
        aggregateId: `${data.conversationId}:${recipient.userId}`,
        topic: userEventTopic(recipient.userId, "receipt/read"),
        payload: toPrismaJson(event),
      })),
    });
    return true;
  });

  if (advanced) {
    // Redis is a derived acceleration structure; PostgreSQL is authoritative.
    await ctx.unread.reset(userId, data.conversationId).catch(() => undefined);
  }
}

export async function handleReceiptDelivered(
  ctx: WorkerContext,
  envelope: CommandEnvelope<DeliveredReceiptCommand>,
): Promise<void> {
  const data = envelope.data;
  const userId = envelope.actor.userId;
  if (!userId) return;

  await ctx.db.$transaction(async (tx) => {
    const membership = await tx.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: data.conversationId, userId } },
      include: { conversation: { select: { lastSequence: true } } },
    });
    if (!membership) return;
    const acceptedSequence = Math.min(
      data.lastDeliveredSequence,
      membership.conversation.lastSequence,
    );
    if (acceptedSequence <= membership.lastDeliveredSequence) return;

    const update = await tx.conversationMember.updateMany({
      where: {
        conversationId: data.conversationId,
        userId,
        lastDeliveredSequence: { lt: acceptedSequence },
      },
      data: { lastDeliveredSequence: acceptedSequence },
    });
    if (update.count === 0) return;

    const others = await tx.conversationMember.findMany({
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
        lastDeliveredSequence: acceptedSequence,
      },
    });
    await tx.outboxEvent.createMany({
      data: others.map((recipient) => ({
        eventType: "receipt.delivered",
        aggregateType: "ConversationMember",
        aggregateId: `${data.conversationId}:${recipient.userId}`,
        topic: userEventTopic(recipient.userId, "receipt/delivered"),
        payload: toPrismaJson(event),
      })),
    });
  });
}
