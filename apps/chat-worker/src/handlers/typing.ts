import {
  buildEventEnvelope,
  EVENT_TOPICS,
  MQTT_QOS,
  type CommandEnvelope,
  type TypingSetCommand,
} from "@mqtt-chat/mqtt-contracts";
import { publishJson } from "@mqtt-chat/mqtt";
import type { WorkerContext } from "../context";

/**
 * Typing handler — ephemeral, Redis TTL-backed.
 * Canonical typing events are published directly (QoS 0) and NOT persisted:
 * they are transient signals, not durable facts.
 */

export async function handleTypingSet(
  ctx: WorkerContext,
  envelope: CommandEnvelope<TypingSetCommand>,
): Promise<void> {
  const data = envelope.data;
  const userId = envelope.actor.userId;
  if (!userId) return;

  const membership = await ctx.db.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId: data.conversationId, userId } },
  });
  if (!membership) return;

  await ctx.typing.setTyping(data.conversationId, userId, data.isTyping);

  const event = buildEventEnvelope({
    eventType: data.isTyping ? "typing.started" : "typing.stopped",
    origin: { type: "user", id: userId },
    actor: { userId, deviceId: envelope.actor.deviceId },
    conversationId: data.conversationId,
    correlationId: envelope.correlationId,
    data: { conversationId: data.conversationId, userId },
  });

  await publishJson(
    ctx.mqtt,
    data.isTyping ? EVENT_TOPICS.typingStarted : EVENT_TOPICS.typingStopped,
    event,
    MQTT_QOS.ephemeral,
  );
}
