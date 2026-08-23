import type { PrismaClient, OutboxEvent } from "@mqtt-chat/database";
import { publishJson } from "@mqtt-chat/mqtt";
import type { MqttClient } from "@mqtt-chat/mqtt";
import type { Logger } from "@mqtt-chat/logger";

/**
 * Transactional outbox publisher.
 *
 * Flow: pending outbox rows → publish MQTT (QoS1) → mark published.
 * Retryable with attempt cap; poison events are logged clearly and left
 * unpublished (never silently dropped). Consumers must be idempotent —
 * at-least-once delivery is assumed.
 */

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 500;

export class OutboxPublisher {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly db: PrismaClient,
    private readonly mqtt: MqttClient,
    private readonly log: Logger,
  ) {}

  start(): void {
    this.scheduleNext(POLL_INTERVAL_MS);
    this.log.info("Outbox publisher started");
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    // Drain one final pass so in-flight work completes on shutdown.
    await this.processBatch();
    this.log.info("Outbox publisher stopped");
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    if (this.running) {
      this.scheduleNext(POLL_INTERVAL_MS);
      return;
    }
    this.running = true;
    try {
      const processed = await this.processBatch();
      this.scheduleNext(processed >= BATCH_SIZE ? 0 : POLL_INTERVAL_MS);
    } catch (error) {
      this.log.error("Outbox publisher tick failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.scheduleNext(POLL_INTERVAL_MS * 2);
    } finally {
      this.running = false;
    }
  }

  /** Returns the number of events processed. */
  async processBatch(): Promise<number> {
    const events = await this.db.$queryRaw<OutboxEvent[]>`
      SELECT * FROM "OutboxEvent"
      WHERE "publishedAt" IS NULL AND "attemptCount" < ${MAX_ATTEMPTS}
      ORDER BY "createdAt" ASC
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    `;
    for (const event of events) {
      await this.publishOne(event);
    }
    return events.length;
  }

  private async publishOne(event: OutboxEvent): Promise<void> {
    try {
      await publishJson(this.mqtt, event.topic, event.payload, 1);
      await this.db.outboxEvent.update({
        where: { id: event.id },
        data: { publishedAt: new Date(), lastError: null },
      });
      this.log.debug("Outbox event published", { eventId: event.id, eventType: event.eventType });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.db.outboxEvent
        .update({
          where: { id: event.id },
          data: { attemptCount: { increment: 1 }, lastError: message },
        })
        .catch(() => undefined);
      this.log.error("Outbox publish failed", {
        eventId: event.id,
        eventType: event.eventType,
        attempt: event.attemptCount + 1,
        error: message,
      });
    }
  }
}
