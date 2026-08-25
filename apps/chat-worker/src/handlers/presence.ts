import { toPrismaJson } from "@mqtt-chat/database";
import {
  buildEventEnvelope,
  EVENT_TOPICS,
  type CommandEnvelope,
  type PresenceSetCommand,
} from "@mqtt-chat/mqtt-contracts";
import type { WorkerContext } from "../context";

/**
 * Presence handler — multi-device aware.
 * A user is offline only when the last active connection is removed.
 * Clients publish presence.set on connect; MQTT LWT delivers presence.set
 * {isOnline:false} on abrupt disconnects.
 */

export async function handlePresenceSet(
  ctx: WorkerContext,
  envelope: CommandEnvelope<PresenceSetCommand>,
): Promise<void> {
  const userId = envelope.actor.userId;
  const deviceId = envelope.actor.deviceId;
  if (!userId || !deviceId) {
    ctx.log.warn("presence.set rejected: missing actor identity", {
      requestId: envelope.requestId,
    });
    return;
  }

  if (envelope.data.isOnline) {
    const transition = await ctx.presence.addConnection(userId, deviceId);
    await ctx.db.device.upsert({
      where: { clientId: `${userId}:${deviceId}` },
      update: { lastSeenAt: new Date() },
      create: { clientId: `${userId}:${deviceId}`, userId, platform: "web" },
    });
    await ctx.presence.touchActivity(userId).catch(() => undefined);
    if (!transition.changed) return;
    const info = transition.info;

    const event = buildEventEnvelope({
      eventType: "presence.online",
      origin: { type: "user", id: userId },
      actor: { userId, deviceId },
      correlationId: envelope.correlationId,
      data: {
        userId,
        deviceId,
        connectionCount: info.connectionCount,
        timestamp: new Date().toISOString(),
      },
    });
    await ctx.db.outboxEvent.create({
      data: {
        eventType: "presence.online",
        aggregateType: "User",
        aggregateId: userId,
        topic: EVENT_TOPICS.presenceOnline,
        payload: toPrismaJson(event),
      },
    });

    ctx.log.info("presence.online", { userId, deviceId, connections: info.connectionCount });
  } else {
    const transition = await ctx.presence.removeConnection(userId, deviceId);
    if (!transition.changed) return;
    const info = transition.info;
    await ctx.presence.touchActivity(userId).catch(() => undefined);

    const event = buildEventEnvelope({
      eventType: "presence.offline",
      origin: { type: "user", id: userId },
      actor: { userId, deviceId },
      correlationId: envelope.correlationId,
      data: {
        userId,
        deviceId,
        connectionCount: info.connectionCount,
        timestamp: new Date().toISOString(),
      },
    });
    await ctx.db.outboxEvent.create({
      data: {
        eventType: "presence.offline",
        aggregateType: "User",
        aggregateId: userId,
        topic: EVENT_TOPICS.presenceOffline,
        payload: toPrismaJson(event),
      },
    });

    ctx.log.info("presence.offline", { userId, deviceId, connections: info.connectionCount });
  }
}
