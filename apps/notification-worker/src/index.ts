import { loadServerEnv } from "@mqtt-chat/config";
import { createLogger, type Logger } from "@mqtt-chat/logger";
import { createDb, closeDb, type PrismaClient } from "@mqtt-chat/database";
import {
  createRedisClient,
  closeRedisClient,
  PresenceRepository,
  NotificationDeliveryRepository,
} from "@mqtt-chat/redis";
import { createMqttClient, closeMqttClient, waitForConnect, subscribe } from "@mqtt-chat/mqtt";
import {
  parseEventEnvelope,
  sharedSubscription,
  SUBSCRIPTION_PATTERNS,
  MQTT_QOS,
  type MessageEventData,
} from "@mqtt-chat/mqtt-contracts";

/**
 * notification-worker.
 *
 * message.created → for each offline recipient → NotificationProvider.
 *
 * Provider abstraction: ConsoleNotificationProvider ships with the demo;
 * FCM/APNs adapters can be added later without touching business logic.
 */

interface NotificationPayload {
  recipientId: string;
  conversationId: string;
  messageId: string;
  senderId: string;
  preview: string;
}

/** Provider abstraction — implement this interface to add FCM/APNs. */
export interface NotificationProvider {
  readonly name: string;
  send(payload: NotificationPayload): Promise<void>;
}

/** Demo provider: logs the notification (no external credentials needed). */
export class ConsoleNotificationProvider implements NotificationProvider {
  readonly name = "console";

  async send(payload: NotificationPayload): Promise<void> {
    // Intentional console output: this IS the demo notification channel.
    console.log(
      `[PUSH] recipient=${payload.recipientId} conversation=${payload.conversationId} ` +
        `from=${payload.senderId} message=${payload.preview}`,
    );
  }
}

class NotificationService {
  constructor(
    private readonly db: PrismaClient,
    private readonly presence: PresenceRepository,
    private readonly provider: NotificationProvider,
    private readonly deliveries: NotificationDeliveryRepository,
    private readonly log: Logger,
  ) {}

  async handleMessageCreated(data: MessageEventData): Promise<void> {
    if (data.senderType === "SYSTEM") return;

    const members = await this.db.conversationMember.findMany({
      where: { conversationId: data.conversationId, userId: { not: data.senderId } },
      select: { userId: true },
    });

    await Promise.all(
      members.map(async (m) => {
        const online = await this.presence.isOnline(m.userId).catch(() => true);
        if (online) return; // only notify offline recipients
        try {
          const preview =
            data.type === "TEXT" ? data.content.slice(0, 120) : `[${data.type.toLowerCase()}]`;
          await this.provider.send({
            recipientId: m.userId,
            conversationId: data.conversationId,
            messageId: data.messageId,
            senderId: data.senderId,
            preview,
          });
          // Delivery audit trail (short TTL): makes push delivery observable
          // and assertable in E2E without scraping worker stdout.
          await this.deliveries.recordDelivery(m.userId, data.messageId, {
            conversationId: data.conversationId,
            senderId: data.senderId,
            preview,
            provider: this.provider.name,
          });
        } catch (error) {
          this.log.error("Notification send failed", {
            recipientId: m.userId,
            messageId: data.messageId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    );
  }
}

async function main(): Promise<void> {
  const env = loadServerEnv();
  const log = createLogger("notification-worker", env.LOG_LEVEL);

  const db = createDb();
  const redis = createRedisClient(env.REDIS_URL);
  const mqtt = createMqttClient({
    url: env.MQTT_URL,
    clientId: `notification-worker-${process.pid}-${Date.now()}`,
    logger: log,
  });

  await waitForConnect(mqtt);

  const presence = new PresenceRepository(redis);
  const service = new NotificationService(
    db,
    presence,
    new ConsoleNotificationProvider(),
    new NotificationDeliveryRepository(redis),
    log,
  );

  await subscribe(
    mqtt,
    sharedSubscription("notification-workers", SUBSCRIPTION_PATTERNS.messageCreated),
    MQTT_QOS.event,
  );

  let processing = 0;
  mqtt.on("message", (_topic, payload) => {
    void (async () => {
      let envelope;
      try {
        envelope = parseEventEnvelope(payload);
      } catch (error) {
        log.error("Invalid event payload dropped", {
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      processing++;
      try {
        await service.handleMessageCreated(envelope.data as MessageEventData);
      } catch (error) {
        log.error("Notification handling failed", {
          eventId: envelope.eventId,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        processing--;
      }
    })();
  });

  log.info("notification-worker ready");

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`Received ${signal}, shutting down gracefully...`);
    const deadline = Date.now() + 10_000;
    while (processing > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await closeMqttClient(mqtt);
    await closeRedisClient(redis);
    await closeDb(db);
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  console.error("Fatal startup error:", error);
  process.exit(1);
});
