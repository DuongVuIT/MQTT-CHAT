import type { Prisma, PrismaClient, OutboxEvent } from "@mqtt-chat/database";
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
  private inFlight: Promise<number> | null = null;

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
    // Never overlap the shutdown drain with an active poll.
    if (this.inFlight) await this.inFlight;
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
      this.inFlight = this.processBatch();
      const processed = await this.inFlight;
      this.scheduleNext(processed >= BATCH_SIZE ? 0 : POLL_INTERVAL_MS);
    } catch (error) {
      this.log.error("Outbox publisher tick failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.scheduleNext(POLL_INTERVAL_MS * 2);
    } finally {
      this.inFlight = null;
      this.running = false;
    }
  }

  /** Returns the number of events processed. */
  async processBatch(): Promise<number> {
    // The row locks only have meaning inside an explicit transaction. The
    // previous standalone SELECT released them before MQTT publish, allowing
    // two worker replicas to select and publish the same batch concurrently.
    // A crash after broker ACK and before commit can still redeliver (the
    // documented at-least-once boundary), but live replicas no longer race.
    return this.db.$transaction(
      async (tx) => {
        const events = await tx.$queryRaw<OutboxEvent[]>`
          SELECT * FROM "OutboxEvent"
          WHERE "publishedAt" IS NULL AND "attemptCount" < ${MAX_ATTEMPTS}
          ORDER BY "createdAt" ASC
          LIMIT ${BATCH_SIZE}
          FOR UPDATE SKIP LOCKED
        `;
        for (const event of events) await this.publishOne(tx, event);
        return events.length;
      },
      { timeout: 60_000 },
    );
  }

  private async publishOne(db: Prisma.TransactionClient, event: OutboxEvent): Promise<void> {
    try {
      await publishJson(this.mqtt, event.topic, event.payload, 1);
      await db.outboxEvent.update({
        where: { id: event.id },
        data: { publishedAt: new Date(), lastError: null },
      });
      this.log.debug("Outbox event published", { eventId: event.id, eventType: event.eventType });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.outboxEvent
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
