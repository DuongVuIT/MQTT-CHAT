import { Prisma, toPrismaJson } from "@mqtt-chat/database";
import {
  buildEventEnvelope,
  EVENT_TOPICS,
  type CommandEnvelope,
  type BotSendCommand,
  type MessageEventData,
} from "@mqtt-chat/mqtt-contracts";
import type { WorkerContext } from "../context";
import { toMessageEventData } from "./messages";

/**
 * bot.send handler — the ONLY path for bots to create chat messages.
 * Bots never publish canonical message events directly; this handler runs the
 * same transactional flow as user messages (sequence + DB + outbox), so bot
 * messages get IDs, sequences, history, receipts and reactions like any other.
 */

export async function handleBotSend(
  ctx: WorkerContext,
  envelope: CommandEnvelope<BotSendCommand>,
): Promise<void> {
  const data = envelope.data;

  // Validate the bot exists and is enabled.
  const bot = await ctx.db.bot.findUnique({ where: { id: data.botId } });
  if (!bot || !bot.enabled) {
    ctx.log.warn("bot.send rejected: bot disabled or unknown", {
      botId: data.botId,
      requestId: envelope.requestId,
    });
    return;
  }

  const membership = await ctx.db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: data.conversationId, userId: data.botId } },
  });
  if (!membership) {
    ctx.log.warn("bot.send rejected: bot not a conversation member", {
      botId: data.botId,
      conversationId: data.conversationId,
    });
    return;
  }

  if (data.replyToId) {
    const replyTo = await ctx.db.message.findUnique({ where: { id: data.replyToId } });
    if (!replyTo || replyTo.conversationId !== data.conversationId) {
      ctx.log.warn("bot.send rejected: invalid replyToId", { replyToId: data.replyToId });
      return;
    }
  }

  try {
    await ctx.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ lastSequence: number }[]>`
        UPDATE "Conversation"
        SET "lastSequence" = "lastSequence" + 1, "updatedAt" = NOW()
        WHERE "id" = ${data.conversationId}
        RETURNING "lastSequence"
      `;
      const row = rows[0];
      if (!row) throw new Error(`Conversation not found: ${data.conversationId}`);

      const created = await tx.message.create({
        data: {
          clientMessageId: data.clientMessageId,
          conversationId: data.conversationId,
          senderId: data.botId,
          senderType: "BOT",
          sequence: row.lastSequence,
          type: data.type,
          content: data.content,
          replyToId: data.replyToId,
          metadata:
            data.metadata === null
              ? Prisma.JsonNull
              : {
                  ...(data.metadata ?? {}),
                  ...(data.ruleId ? { ruleId: data.ruleId } : {}),
                },
        },
      });

      const event = buildEventEnvelope<MessageEventData>({
        eventType: "message.created",
        origin: {
          type: "bot",
          id: data.botId,
          ...(data.ruleId ? { ruleId: data.ruleId } : {}),
        },
        actor: { botId: data.botId },
        conversationId: data.conversationId,
        correlationId: data.correlationId ?? envelope.correlationId,
        causationId: data.causationId ?? envelope.causationId,
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

      ctx.log.info("bot message.created", {
        messageId: created.id,
        botId: data.botId,
        sequence: created.sequence,
        ruleId: data.ruleId,
        requestId: envelope.requestId,
      });
    });
  } catch (error) {
    // Idempotency for redelivered bot commands.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      ctx.log.info("bot.send deduplicated (clientMessageId)", {
        clientMessageId: data.clientMessageId,
        requestId: envelope.requestId,
      });
      return;
    }
    throw error;
  }
}
