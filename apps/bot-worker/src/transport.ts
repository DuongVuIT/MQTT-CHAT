import { randomUUID } from "node:crypto";
import {
  buildCommandEnvelope,
  COMMAND_TOPICS,
  MQTT_QOS,
  type BotSendCommand,
  type AddReactionCommand,
} from "@mqtt-chat/mqtt-contracts";
import { publishJson, type MqttClient } from "@mqtt-chat/mqtt";
import type { BotTransport } from "@mqtt-chat/bot-sdk";
import type { Logger } from "@mqtt-chat/logger";

/**
 * MQTT transport for the bot — bots send COMMANDS (bot.send / reaction.add),
 * never canonical events. The chat-worker remains the single authority.
 */
export class MqttBotTransport implements BotTransport {
  constructor(
    private readonly mqtt: MqttClient,
    private readonly botId: string,
    private readonly log: Logger,
  ) {}

  async sendBotCommand(payload: {
    conversationId: string;
    content: string;
    replyToId?: string | null;
    metadata?: Record<string, unknown> | null;
    correlationId?: string;
    causationId?: string;
    ruleId?: string;
  }): Promise<void> {
    const data: BotSendCommand = {
      conversationId: payload.conversationId,
      clientMessageId: randomUUID(), // idempotency key generated per attempt
      botId: this.botId,
      type: "TEXT",
      content: payload.content,
      replyToId: payload.replyToId ?? null,
      metadata: payload.metadata ?? null,
      ...(payload.correlationId ? { correlationId: payload.correlationId } : {}),
      ...(payload.causationId ? { causationId: payload.causationId } : {}),
      ...(payload.ruleId ? { ruleId: payload.ruleId } : {}),
    };
    const envelope = buildCommandEnvelope<BotSendCommand>({
      commandType: "bot.send",
      actor: { botId: this.botId },
      data,
      correlationId: payload.correlationId,
      causationId: payload.causationId,
    });
    await publishJson(this.mqtt, COMMAND_TOPICS.botSend, envelope, MQTT_QOS.command);
    this.log.debug("bot.send command published", {
      conversationId: payload.conversationId,
      ruleId: payload.ruleId,
    });
  }

  async addReaction(payload: {
    conversationId: string;
    messageId: string;
    emoji: string;
    correlationId?: string;
    causationId?: string;
    ruleId?: string;
  }): Promise<void> {
    const data: AddReactionCommand = {
      messageId: payload.messageId,
      conversationId: payload.conversationId,
      emoji: payload.emoji,
    };
    // Reactions are attributed to the bot's user identity row.
    const envelope = buildCommandEnvelope<AddReactionCommand>({
      commandType: "reaction.add",
      actor: { userId: this.botId, botId: this.botId },
      data,
      correlationId: payload.correlationId,
      causationId: payload.causationId,
    });
    await publishJson(this.mqtt, COMMAND_TOPICS.reactionAdd, envelope, MQTT_QOS.command);
  }
}
