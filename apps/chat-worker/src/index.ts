import { loadServerEnv } from "@mqtt-chat/config";
import { createLogger } from "@mqtt-chat/logger";
import { createDb, closeDb } from "@mqtt-chat/database";
import {
  createRedisClient,
  closeRedisClient,
  PresenceRepository,
  TypingRepository,
  UnreadRepository,
} from "@mqtt-chat/redis";
import { createMqttClient, closeMqttClient, waitForConnect } from "@mqtt-chat/mqtt";
import type { WorkerContext } from "./context";
import { ChatWorker } from "./worker";
import { OutboxPublisher } from "./outbox";

/**
 * chat-worker entrypoint with graceful shutdown (SIGTERM/SIGINT):
 * stop consuming → drain in-flight work → flush outbox → close MQTT/Redis/DB.
 */

async function main(): Promise<void> {
  const env = loadServerEnv();
  const log = createLogger("chat-worker", env.LOG_LEVEL);

  const db = createDb();
  const redis = createRedisClient(env.REDIS_URL);
  // Deferred-ack bridge (P0-185): the client PUBACKs a command only after
  // ChatWorker.consume settles, so a crash mid-processing leaves the command
  // unacked and the broker redelivers — at-least-once actually reaches the
  // handler. The worker instance exists after infra handles are up, hence the
  // late-bound ref; deliveries cannot arrive before start() subscribes.
  let consumeCommand: ((topic: string, payload: Buffer) => Promise<void>) | null = null;
  const mqtt = createMqttClient({
    url: env.MQTT_URL,
    clientId: `chat-worker-${process.pid}-${Date.now()}`,
    logger: log,
    handleMessage: (topic, payload) => {
      if (!consumeCommand) throw new Error("chat-worker consumer not ready");
      return consumeCommand(topic, payload);
    },
  });

  await waitForConnect(mqtt);
  await db.$queryRaw`SELECT 1`; // fail fast if DB is unreachable

  const ctx: WorkerContext = {
    db,
    mqtt,
    redis,
    presence: new PresenceRepository(redis),
    typing: new TypingRepository(redis),
    unread: new UnreadRepository(redis),
    log,
  };

  const worker = new ChatWorker(ctx, mqtt, "chat-workers");
  consumeCommand = (topic, payload) => worker.consume(topic, payload);
  const outbox = new OutboxPublisher(db, mqtt, log.child({ component: "outbox" }));

  await worker.start();
  outbox.start();
  log.info("chat-worker ready");

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`Received ${signal}, shutting down gracefully...`);
    try {
      await worker.stop();
      await outbox.stop();
      await closeMqttClient(mqtt);
      await closeRedisClient(redis);
      await closeDb(db);
      log.info("Shutdown complete");
      process.exit(0);
    } catch (error) {
      log.error("Error during shutdown", {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  console.error("Fatal startup error:", error);
  process.exit(1);
});
