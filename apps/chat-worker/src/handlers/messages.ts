import { Prisma, toPrismaJson } from "@mqtt-chat/database";
import { publishJson } from "@mqtt-chat/mqtt";
import {
  buildEventEnvelope,
  EVENT_TOPICS,
  conversationEventTopic,
  type CommandEnvelope,
  type SendMessageCommand,
  type EditMessageCommand,
  type DeleteMessageCommand,
  type MessageEventData,
  type MessageRejectedData,
} from "@mqtt-chat/mqtt-contracts";
import type { Message } from "@mqtt-chat/database";
import type { WorkerContext } from "../context";

/**
 * Message command handlers.
 *
 * Flow (server-authoritative):
 *   validate → dedup (clientMessageId) → business rules →
 *   DB transaction (sequence + message + outbox) → canonical event via outbox.
 */

/** Map a DB message row to the canonical MessageEventData payload. */
export function toMessageEventData(message: Message): MessageEventData {
  // Canonical contract: reactions is ALWAYS an array. A freshly created
  // message has none; a preloaded reactions relation is projected as-is.
  const rawReactions = (message as { reactions?: unknown }).reactions;
  const reactions = Array.isArray(rawReactions)
    ? (rawReactions as { emoji: string; userId: string }[])
    : [];
  return {
    messageId: message.id,
    clientMessageId: message.clientMessageId,
    conversationId: message.conversationId,
    senderId: message.senderId,
    senderType: message.senderType,
    sequence: message.sequence,
    type: message.type,
    content: message.content,
    replyToId: message.replyToId,
    metadata: (message.metadata as Record<string, unknown> | null) ?? null,
    reactions,
    createdAt: message.createdAt.toISOString(),
  };
}

/**
 * Announce a command-level rejection to the ORIGINATING client so its
 * optimistic entry fails deterministically (repair-log #27) instead of
 * waiting out the reconciliation timeout. Best-effort QoS1 publish.
 */
function rejectSend(
  ctx: WorkerContext,
  envelope: CommandEnvelope<SendMessageCommand>,
  reason: string,
): void {
  const event = buildEventEnvelope<MessageRejectedData>({
    eventType: "message.rejected",
    origin: { type: "system", id: "chat-worker" },
    actor: envelope.actor,
    conversationId: envelope.data.conversationId,
    correlationId: envelope.requestId,
    data: {
      clientMessageId: envelope.data.clientMessageId,
      reason,
      conversationId: envelope.data.conversationId,
    },
  });
  void publishJson(ctx.mqtt, EVENT_TOPICS.messageRejected, event, 1);
  ctx.log.warn("message.send rejected", {
    requestId: envelope.requestId,
    reason,
    clientMessageId: envelope.data.clientMessageId,
  });
}

export async function handleMessageSend(
  ctx: WorkerContext,
  envelope: CommandEnvelope<SendMessageCommand>,
): Promise<void> {
  const data = envelope.data;
  const userId = envelope.actor.userId;
  if (!userId) {
    rejectSend(ctx, envelope, "missing actor userId");
    return;
  }

  // Business validation: sender must be a member of the conversation.
  const membership = await ctx.db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: data.conversationId, userId } },
  });
  if (!membership) {
    rejectSend(ctx, envelope, "sender is not a member of this conversation");
    return;
  }

  // Reply target validation (#19): must exist and belong to the SAME
  // conversation — otherwise the send is rejected deterministically.
  if (data.replyToId) {
    const replyTo = await ctx.db.message.findUnique({ where: { id: data.replyToId } });
    if (!replyTo || replyTo.conversationId !== data.conversationId) {
      rejectSend(ctx, envelope, `invalid reply target ${data.replyToId}`);
      return;
    }
  }

  try {
    // ---- Transaction: sequence + message + outbox (atomic) ----
    const message = await ctx.db.$transaction(
      async (tx) => {
        // Monotonic sequence via atomic UPDATE ... RETURNING (race-safe).
        const rows = await tx.$queryRaw<{ lastSequence: number }[]>`
          UPDATE "Conversation"
          SET "lastSequence" = "lastSequence" + 1, "updatedAt" = NOW()
          WHERE "id" = ${data.conversationId}
          RETURNING "lastSequence"
        `;
        const row = rows[0];
        if (!row) throw new Error(`Conversation not found: ${data.conversationId}`);
        const sequence = row.lastSequence;

        const created = await tx.message.create({
          data: {
            clientMessageId: data.clientMessageId,
            conversationId: data.conversationId,
            senderId: userId,
            senderType: "USER",
            sequence,
            type: data.type,
            content: data.content,
            replyToId: data.replyToId,
            metadata: data.metadata === null ? Prisma.JsonNull : toPrismaJson(data.metadata),
          },
        });

        const event = buildEventEnvelope<MessageEventData>({
          eventType: "message.created",
          origin: { type: "user", id: userId },
          actor: { userId, deviceId: envelope.actor.deviceId },
          conversationId: data.conversationId,
          correlationId: envelope.correlationId,
          data: toMessageEventData(created),
        });

        await tx.outboxEvent.create({
          data: {
            eventType: "message.created",
            aggregateType: "Message",
            aggregateId: created.id,
            topic: EVENT_TOPICS.messageCreated,
            payload: toPrismaJson(event),
          },
        });

        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );

    // Unread counters for other members (Redis, best-effort).
    const memberIds = await ctx.db.conversationMember.findMany({
      where: { conversationId: data.conversationId, userId: { not: userId } },
      select: { userId: true },
    });
    await Promise.all(
      memberIds.map((m) =>
        ctx.unread.increment(m.userId, data.conversationId).catch(() => undefined),
      ),
    );

    ctx.log.info("message.created", {
      messageId: message.id,
      conversationId: message.conversationId,
      sequence: message.sequence,
      userId,
      requestId: envelope.requestId,
    });
  } catch (error) {
    // ---- Idempotency: duplicate clientMessageId → ack without re-emitting ----
    // The canonical message.created event is created atomically with the
    // message (same transaction), so it is guaranteed to exist and be
    // published by the outbox. Re-emitting here would duplicate the event.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await ctx.db.message.findUnique({
        where: { clientMessageId: data.clientMessageId },
      });
      if (existing && existing.conversationId === data.conversationId) {
        ctx.log.info("message.send deduplicated (clientMessageId)", {
          clientMessageId: data.clientMessageId,
          messageId: existing.id,
          requestId: envelope.requestId,
        });
        return;
      }
    }
    if (error instanceof Error && error.message.startsWith("Conversation not found")) {
      rejectSend(ctx, envelope, "unknown conversation");
      return;
    }
    throw error;
  }
}

export async function handleMessageEdit(
  ctx: WorkerContext,
  envelope: CommandEnvelope<EditMessageCommand>,
): Promise<void> {
  const data = envelope.data;
  const userId = envelope.actor.userId;
  if (!userId) return;

  const message = await ctx.db.message.findUnique({ where: { id: data.messageId } });
  if (!message || message.conversationId !== data.conversationId) {
    ctx.log.warn("message.edit rejected: not found", { messageId: data.messageId });
    return;
  }
  if (message.senderId !== userId || message.senderType !== "USER") {
    ctx.log.warn("message.edit rejected: not the author", { messageId: data.messageId, userId });
    return;
  }
  if (message.deletedAt) {
    ctx.log.warn("message.edit rejected: already deleted", { messageId: data.messageId });
    return;
  }

  const editedAt = new Date();
  await ctx.db.$transaction(async (tx) => {
    const updated = await tx.message.update({
      where: { id: data.messageId },
      data: { content: data.content, editedAt },
    });

    const event = buildEventEnvelope({
      eventType: "message.edited",
      origin: { type: "user", id: userId },
      actor: { userId, deviceId: envelope.actor.deviceId },
      conversationId: data.conversationId,
      correlationId: envelope.correlationId,
      data: {
        messageId: updated.id,
        conversationId: updated.conversationId,
        content: updated.content,
        editedAt: editedAt.toISOString(),
      },
    });

    await tx.outboxEvent.create({
      data: {
        eventType: "message.edited",
        aggregateType: "Message",
        aggregateId: updated.id,
        topic: EVENT_TOPICS.messageEdited,
        payload: toPrismaJson(event),
      },
    });
  });

  ctx.log.info("message.edited", { messageId: data.messageId, userId });
}

export async function handleMessageDelete(
  ctx: WorkerContext,
  envelope: CommandEnvelope<DeleteMessageCommand>,
): Promise<void> {
  const data = envelope.data;
  const userId = envelope.actor.userId;
  if (!userId) return;

  const message = await ctx.db.message.findUnique({ where: { id: data.messageId } });
  if (!message || message.conversationId !== data.conversationId) {
    ctx.log.warn("message.delete rejected: not found", { messageId: data.messageId });
    return;
  }

  const membership = await ctx.db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: data.conversationId, userId } },
  });
  const isAuthor = message.senderId === userId && message.senderType === "USER";
  const isAdmin = membership?.role === "ADMIN";
  if (!isAuthor && !isAdmin) {
    ctx.log.warn("message.delete rejected: forbidden", { messageId: data.messageId, userId });
    return;
  }
  if (message.deletedAt) return; // already deleted — idempotent

  const deletedAt = new Date();
  await ctx.db.$transaction(async (tx) => {
    await tx.message.update({
      where: { id: data.messageId },
      data: { deletedAt, content: "" },
    });

    const event = buildEventEnvelope({
      eventType: "message.deleted",
      origin: { type: "user", id: userId },
      actor: { userId, deviceId: envelope.actor.deviceId },
      conversationId: data.conversationId,
      correlationId: envelope.correlationId,
      data: {
        messageId: data.messageId,
        conversationId: data.conversationId,
        deletedAt: deletedAt.toISOString(),
      },
    });

    await tx.outboxEvent.create({
      data: {
        eventType: "message.deleted",
        aggregateType: "Message",
        aggregateId: data.messageId,
        topic: EVENT_TOPICS.messageDeleted,
        payload: toPrismaJson(event),
      },
    });
  });

  ctx.log.info("message.deleted", { messageId: data.messageId, userId });
}

/** Shared helper used by the bot.send handler. */
export { conversationEventTopic };
