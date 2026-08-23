import {
  COMMAND_SCHEMAS,
  parseCommandEnvelope,
  sharedSubscription,
  SUBSCRIPTION_PATTERNS,
  MQTT_QOS,
  type CommandEnvelope,
  type CommandType,
} from "@mqtt-chat/mqtt-contracts";
import { subscribe } from "@mqtt-chat/mqtt";
import type { MqttClient } from "@mqtt-chat/mqtt";
import type { WorkerContext } from "./context";
import { handleMessageSend, handleMessageEdit, handleMessageDelete } from "./handlers/messages";
import { handleReactionAdd, handleReactionRemove } from "./handlers/reactions";
import { handleReceiptRead, handleReceiptDelivered } from "./handlers/receipts";
import { handlePresenceSet } from "./handlers/presence";
import { handleTypingSet } from "./handlers/typing";
import { handleBotSend } from "./handlers/bot-send";

/**
 * Chat worker — the authority for chat realtime.
 *
 * command → validate → dedup → business rules → DB transaction →
 * canonical state → outbox event → MQTT event.
 *
 * Uses a shared subscription so multiple instances scale horizontally.
 */

type Handler = (ctx: WorkerContext, envelope: CommandEnvelope) => Promise<void>;

const HANDLERS: Record<CommandType, Handler> = {
  "message.send": (ctx, env) => handleMessageSend(ctx, env as never),
  "message.edit": (ctx, env) => handleMessageEdit(ctx, env as never),
  "message.delete": (ctx, env) => handleMessageDelete(ctx, env as never),
  "reaction.add": (ctx, env) => handleReactionAdd(ctx, env as never),
  "reaction.remove": (ctx, env) => handleReactionRemove(ctx, env as never),
  "receipt.read": (ctx, env) => handleReceiptRead(ctx, env as never),
  "receipt.delivered": (ctx, env) => handleReceiptDelivered(ctx, env as never),
  "presence.set": (ctx, env) => handlePresenceSet(ctx, env as never),
  "typing.set": (ctx, env) => handleTypingSet(ctx, env as never),
  "bot.send": (ctx, env) => handleBotSend(ctx, env as never),
};

export class ChatWorker {
  private processing = 0;
  private stopped = false;

  constructor(
    private readonly ctx: WorkerContext,
    private readonly mqtt: MqttClient,
    private readonly group: string,
  ) {}

  async start(): Promise<void> {
    const pattern = sharedSubscription(this.group, SUBSCRIPTION_PATTERNS.allCommands);
    await subscribe(this.mqtt, pattern, MQTT_QOS.command);

    this.mqtt.on("message", (topic, payload) => {
      if (!topic.includes("/commands/")) return;
      // Fire-and-forget with error containment; QoS1 redelivery covers crashes.
      void this.process(topic, payload).catch((error: unknown) => {
        this.ctx.log.error("Command processing failed", {
          topic,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });

    this.ctx.log.info("ChatWorker started", { subscription: pattern });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    // Wait for in-flight handlers to finish (bounded).
    const deadline = Date.now() + 10_000;
    while (this.processing > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    this.ctx.log.info("ChatWorker stopped");
  }

  private async process(_topic: string, payload: Buffer): Promise<void> {
    if (this.stopped) return;
    let envelope: CommandEnvelope;
    try {
      envelope = parseCommandEnvelope(payload);
    } catch (error) {
      // Poison payload: log clearly, do not crash.
      this.ctx.log.error("Invalid command payload dropped", {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const schema = COMMAND_SCHEMAS[envelope.commandType as CommandType];
    if (!schema) {
      this.ctx.log.warn("Unknown commandType dropped", { commandType: envelope.commandType });
      return;
    }

    const parsed = schema.safeParse(envelope.data);
    if (!parsed.success) {
      this.ctx.log.warn("Command payload failed schema validation", {
        commandType: envelope.commandType,
        requestId: envelope.requestId,
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      });
      return;
    }

    const handler = HANDLERS[envelope.commandType as CommandType];
    if (!handler) return; // guarded by COMMAND_SCHEMAS check above
    this.processing++;
    try {
      await handler(this.ctx, { ...envelope, data: parsed.data });
    } finally {
      this.processing--;
    }
  }
}
