import { loadServerEnv } from "@mqtt-chat/config";
import { createLogger } from "@mqtt-chat/logger";
import { createDb, closeDb } from "@mqtt-chat/database";
import {
  createRedisClient,
  closeRedisClient,
  BotStateRepository,
  PresenceRepository,
} from "@mqtt-chat/redis";
import { createMqttClient, closeMqttClient, waitForConnect, subscribe } from "@mqtt-chat/mqtt";
import {
  parseEventEnvelope,
  sharedSubscription,
  SUBSCRIPTION_PATTERNS,
  MQTT_QOS,
  type EventEnvelope,
} from "@mqtt-chat/mqtt-contracts";
import { Bot } from "@mqtt-chat/bot-sdk";
import { MqttBotTransport } from "./transport";
import { RuleEngine } from "./rule-engine";
import { DynamicResponder } from "./dynamic-responder";
import { BotScheduler } from "./scheduler";

/**
 * bot-worker entrypoint.
 *
 * Consumes chat/v1/events/# (shared subscription) and:
 *   - runs DB-driven rules (trigger → conditions → actions)
 *   - tracks user activity (online/offline/message counters)
 *   - executes persistent scheduled jobs
 *
 * Loop protection: BOT-originated events are ignored unless explicitly allowed;
 * per-rule/user cooldowns + correlation/causation tracing prevent storms.
 */

const SYSTEM_BOT_NAME = "system-bot";

async function main(): Promise<void> {
  const env = loadServerEnv();
  const log = createLogger("bot-worker", env.LOG_LEVEL);

  const db = createDb();
  const redis = createRedisClient(env.REDIS_URL);
  const mqtt = createMqttClient({
    url: env.MQTT_URL,
    clientId: `bot-worker-${process.pid}-${Date.now()}`,
    logger: log,
  });

  await waitForConnect(mqtt);

  // Resolve the demo bot identity.
  const botRow = await db.bot.findUnique({ where: { name: SYSTEM_BOT_NAME } });
  if (!botRow) throw new Error(`Bot "${SYSTEM_BOT_NAME}" not found — run db:seed first`);

  const transport = new MqttBotTransport(mqtt, botRow.id, log);
  const botStateRepo = new BotStateRepository(redis);
  // Adapt the Redis repository (botId-scoped) to the SDK's BotStateStore interface.
  const state = {
    getState: <T>(scopeKey: string) => botStateRepo.getState<T>(botRow.id, scopeKey),
    setState: (scopeKey: string, value: unknown) =>
      botStateRepo.setState(botRow.id, scopeKey, value),
    deleteState: (scopeKey: string) => botStateRepo.deleteState(botRow.id, scopeKey),
    incrementCounter: (scopeKey: string, field: string) =>
      botStateRepo.incrementCounter(botRow.id, scopeKey, field),
  };
  const presence = new PresenceRepository(redis);
  const responder = new DynamicResponder(db, transport, presence);

  // ---- Bot SDK instance (programmatic handlers) ----
  const bot = new Bot(
    { id: botRow.id, allowBotMessages: false, maxAutomationDepth: 3 },
    transport,
    state,
  );

  // User tracking via SDK handlers.
  bot.onUserOnline(async (ctx) => {
    if (!ctx.presence) return;
    await presence.touchActivity(ctx.presence.userId).catch(() => undefined);
    log.info("bot observed user online", { userId: ctx.presence.userId });
  });
  bot.onUserOffline(async (ctx) => {
    if (!ctx.presence) return;
    await presence.touchActivity(ctx.presence.userId).catch(() => undefined);
    log.info("bot observed user offline", { userId: ctx.presence.userId });
  });

  // ---- Rule engine ----
  const ruleEngine = new RuleEngine(db, transport, botStateRepo, log.child({ component: "rules" }));
  ruleEngine.setTransportClient(mqtt);

  // Bridge: dynamic responders only fire for their OWN command. Previously
  // this looped over every action type for any message, so e.g. "/ping"
  // also produced a spurious "Cách dùng: /status <user>" usage reply.
  const COMMAND_TO_ACTION: Record<string, string> = {
    status: "reply_status",
    users: "reply_users",
    stats: "reply_stats",
    room: "reply_room",
  };
  bot.onMessage(async (ctx) => {
    if (!ctx.parsedCommand) return;
    const actionType = COMMAND_TO_ACTION[ctx.parsedCommand.command];
    if (!actionType) return;
    await responder.respond(actionType, ctx.botId, ctx.event, ctx.args, ctx.event.origin.ruleId);
  });

  await subscribe(
    mqtt,
    sharedSubscription("bot-workers", SUBSCRIPTION_PATTERNS.allEvents),
    MQTT_QOS.event,
  );

  let processing = 0;
  mqtt.on("message", (_topic, payload) => {
    void (async () => {
      let envelope: EventEnvelope;
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
        // 1) SDK handlers (tracking, dynamic responders).
        await bot.processEvent(envelope);
        // 2) Rule engine (DB-driven rules).
        const matched = await ruleEngine.processEvent(envelope);
        // 3) Persist an event log entry for admin observability.
        if (matched.length > 0 || envelope.eventType === "message.created") {
          await db.botEventLog
            .create({
              data: {
                botId: botRow.id,
                eventType: envelope.eventType,
                eventId: envelope.eventId,
                payload: JSON.parse(JSON.stringify(envelope)) as object,
                matchedRuleIds: matched,
              },
            })
            .catch(() => undefined);
        }
      } catch (error) {
        log.error("Event processing failed", {
          eventId: envelope.eventId,
          eventType: envelope.eventType,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        processing--;
      }
    })();
  });

  // ---- Scheduler ----
  const scheduler = new BotScheduler(db, transport, log.child({ component: "scheduler" }));

  ruleEngine.start();
  scheduler.start();
  log.info("bot-worker ready", { botId: botRow.id });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`Received ${signal}, shutting down gracefully...`);
    try {
      scheduler.stop();
      ruleEngine.stop();
      const deadline = Date.now() + 10_000;
      while (processing > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
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
