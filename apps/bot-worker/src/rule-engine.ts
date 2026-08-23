import type { Prisma, PrismaClient } from "@mqtt-chat/database";
import {
  evaluateConditions,
  parseRuleDefinition,
  resolvePath,
  type Action,
  type RuleDefinition,
} from "@mqtt-chat/bot-rules";
import type { EventEnvelope } from "@mqtt-chat/mqtt-contracts";
import { botEventsTopic } from "@mqtt-chat/mqtt-contracts";
import type { Logger } from "@mqtt-chat/logger";
import type { BotStateRepository } from "@mqtt-chat/redis";
import type { MqttClient } from "@mqtt-chat/mqtt";
import type { MqttBotTransport } from "./transport";

/**
 * DB-driven rule engine: trigger → conditions → actions.
 * Rules are loaded from PostgreSQL (validated with the bot-rules schema),
 * cached in memory and refreshed periodically so admin edits take effect.
 *
 * Loop protection: bot-originated events are ignored unless the bot's
 * settings explicitly allow them; per-rule/user cooldowns prevent storms.
 */

const RULES_REFRESH_MS = 5_000;
const DEFAULT_COOLDOWN_SECONDS = 2;

interface LoadedRule {
  id: string;
  name: string;
  priority: number;
  definition: RuleDefinition;
}

export class RuleEngine {
  private rules = new Map<string, LoadedRule[]>(); // botId → rules
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: PrismaClient,
    private readonly transport: MqttBotTransport,
    private readonly state: BotStateRepository,
    private readonly log: Logger,
  ) {}

  start(): void {
    void this.refresh();
    this.refreshTimer = setInterval(() => void this.refresh(), RULES_REFRESH_MS);
    this.log.info("Rule engine started");
  }

  stop(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.log.info("Rule engine stopped");
  }

  async refresh(): Promise<void> {
    try {
      const bots = await this.db.bot.findMany({
        where: { enabled: true },
        include: { rules: { where: { enabled: true }, orderBy: [{ priority: "asc" }] } },
      });
      const next = new Map<string, LoadedRule[]>();
      // Bot settings are cached per-process too — invalidate alongside rules
      // so admin edits (allowBotMessages, commandPrefix) take effect.
      this.botSettingsCache.clear();
      for (const bot of bots) {
        const rules: LoadedRule[] = [];
        for (const rule of bot.rules) {
          try {
            const definition = parseRuleDefinition({
              trigger: rule.trigger,
              conditions: rule.conditions,
              actions: rule.actions,
            });
            rules.push({ id: rule.id, name: rule.name, priority: rule.priority, definition });
          } catch (error) {
            // Invalid stored rule JSON — log loudly, skip (never crash).
            this.log.error("Invalid rule definition skipped", {
              ruleId: rule.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        next.set(bot.id, rules);
      }
      this.rules = next;
    } catch (error) {
      this.log.error("Rule refresh failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Process an event against all enabled bots' rules.
   * Returns matched rule ids (for logging/observability).
   */
  async processEvent(envelope: EventEnvelope): Promise<string[]> {
    const matched: string[] = [];

    for (const [botId, rules] of this.rules) {
      const bot = await this.getBotSettings(botId);
      if (!bot) continue;

      // Loop protection: ignore bot-originated events by default.
      if (envelope.origin.type === "bot" && !bot.allowBotMessages) continue;

      // Command trigger matching.
      let commandMatch: { command: string; args: string[] } | null = null;
      const content =
        envelope.eventType === "message.created" &&
        typeof envelope.data === "object" &&
        envelope.data !== null
          ? String((envelope.data as { content?: unknown }).content ?? "")
          : "";

      for (const rule of rules) {
        const trigger = rule.definition.trigger;
        if ("command" in trigger) {
          if (envelope.eventType !== "message.created" || !content.startsWith("/")) continue;
          if (!commandMatch) {
            const parts = content.trim().slice(1).split(/\s+/);
            const [cmd = "", ...args] = parts;
            commandMatch = { command: cmd.toLowerCase(), args };
          }
          if (commandMatch.command !== trigger.command.toLowerCase()) continue;
        } else if (trigger.event !== envelope.eventType) {
          continue;
        }

        // Build evaluation context including session state.
        const senderId =
          envelope.actor?.userId ??
          (typeof envelope.data === "object" && envelope.data !== null
            ? String((envelope.data as { senderId?: unknown }).senderId ?? "")
            : "");
        const sessionState =
          (await this.state.getState<Record<string, unknown>>(
            botId,
            `${envelope.conversationId ?? "global"}:${senderId || "system"}:session`,
          )) ?? {};

        const context: Record<string, unknown> = {
          eventType: envelope.eventType,
          conversationId: envelope.conversationId,
          actor: envelope.actor,
          origin: envelope.origin,
          data: envelope.data,
          state: sessionState,
        };

        if (!evaluateConditions(rule.definition.conditions, context)) continue;

        // Cooldown guard per bot/rule/user.
        const cooldownKey = senderId || "system";
        const allowed = await this.state.tryAcquireCooldown(
          botId,
          rule.id,
          cooldownKey,
          DEFAULT_COOLDOWN_SECONDS,
        );
        if (!allowed) {
          this.log.debug("rule skipped (cooldown)", { ruleId: rule.id, userId: cooldownKey });
          continue;
        }

        matched.push(rule.id);
        await this.executeActions(botId, rule, envelope, context);
      }
    }

    return matched;
  }

  private botSettingsCache = new Map<
    string,
    { allowBotMessages: boolean; commandPrefix: string }
  >();

  private async getBotSettings(botId: string) {
    const cached = this.botSettingsCache.get(botId);
    if (cached) return cached;
    const bot = await this.db.bot.findUnique({ where: { id: botId } });
    if (!bot || !bot.enabled) return null;
    const settings = (bot.settings ?? {}) as Record<string, unknown>;
    const value = {
      allowBotMessages: settings["allowBotMessages"] === true,
      commandPrefix:
        typeof settings["commandPrefix"] === "string" ? settings["commandPrefix"] : "/",
    };
    this.botSettingsCache.set(botId, value);
    return value;
  }

  private async executeActions(
    botId: string,
    rule: LoadedRule,
    envelope: EventEnvelope,
    context: Record<string, unknown>,
  ): Promise<void> {
    for (const action of rule.definition.actions) {
      try {
        await this.executeAction(botId, rule.id, envelope, action, context);
      } catch (error) {
        await this.logExecution(botId, rule.id, action.type, "FAILED", envelope, undefined, error);
        this.log.error("Action execution failed", {
          botId,
          ruleId: rule.id,
          actionType: action.type,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async executeAction(
    botId: string,
    ruleId: string,
    envelope: EventEnvelope,
    action: Action,
    context: Record<string, unknown>,
  ): Promise<void> {
    const conversationId = envelope.conversationId ?? "";
    const render = (template: string): string =>
      template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => {
        const value = resolvePath(context, path);
        return value === undefined || value === null ? "" : String(value);
      });

    switch (action.type) {
      case "reply":
      case "send_message": {
        if (!action.content) break;
        await this.transport.sendBotCommand({
          conversationId,
          content: render(action.content),
          replyToId:
            action.type === "reply" && typeof envelope.data === "object" && envelope.data !== null
              ? ((envelope.data as { messageId?: string }).messageId ?? null)
              : null,
          correlationId: envelope.correlationId,
          causationId: envelope.eventId,
          ruleId,
        });
        break;
      }
      case "add_reaction": {
        if (!action.emoji) break;
        const messageId =
          typeof envelope.data === "object" && envelope.data !== null
            ? (envelope.data as { messageId?: string }).messageId
            : undefined;
        if (!messageId) break;
        await this.transport.addReaction({
          conversationId,
          messageId,
          emoji: action.emoji,
          correlationId: envelope.correlationId,
          causationId: envelope.eventId,
          ruleId,
        });
        break;
      }
      case "set_state": {
        if (!action.key) break;
        const scopeKey = this.sessionScope(envelope, context);
        const current = (await this.state.getState<Record<string, unknown>>(botId, scopeKey)) ?? {};
        current[action.key] = action.value ?? null;
        await this.state.setState(botId, scopeKey, current);
        break;
      }
      case "delete_state": {
        if (!action.key) break;
        const scopeKey = this.sessionScope(envelope, context);
        const current = (await this.state.getState<Record<string, unknown>>(botId, scopeKey)) ?? {};
        const { [action.key]: _removed, ...rest } = current;
        await this.state.setState(botId, scopeKey, rest);
        break;
      }
      case "increment_counter": {
        const field = action.field ?? "default";
        await this.state.incrementCounter(botId, this.sessionScope(envelope, context), field);
        break;
      }
      case "delay": {
        const ms = Math.min(action.ms ?? 1000, 60_000);
        await new Promise((resolve) => setTimeout(resolve, ms));
        break;
      }
      case "schedule": {
        const runAtMs = action.runAtMs ?? 5000;
        const jobPayload = JSON.parse(
          JSON.stringify({
            ruleId,
            actions: [{ ...action, type: "reply", runAtMs: undefined }],
            conversationId,
            causationId: envelope.eventId,
          }),
        ) as Prisma.InputJsonValue;
        await this.db.botScheduledJob.create({
          data: {
            botId,
            runAt: new Date(Date.now() + runAtMs),
            payload: jobPayload,
          },
        });
        break;
      }
      case "publish_event": {
        // Non-canonical observability channel scoped to the bot.
        if (!action.payload) break;
        const topic = botEventsTopic(botId);
        const { publishJson } = await import("@mqtt-chat/mqtt");
        const client = this.transportClient;
        if (client) {
          await publishJson(client, topic, action.payload, 0);
        }
        break;
      }
      case "http_request": {
        if (!action.url) break;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), action.timeoutMs ?? 10_000);
        try {
          const response = await fetch(action.url, {
            method: action.method ?? "GET",
            signal: controller.signal,
          });
          await this.logExecution(botId, ruleId, action.type, "SUCCESS", envelope, {
            status: response.status,
          });
        } finally {
          clearTimeout(timeout);
        }
        break;
      }
      default:
        // reply_status / reply_users / reply_stats / reply_room are handled
        // by the dynamic responder (see dynamic-responder.ts).
        break;
    }

    if (
      action.type !== "http_request" &&
      ![
        "set_state",
        "delete_state",
        "increment_counter",
        "delay",
        "schedule",
        "publish_event",
      ].includes(action.type)
    ) {
      await this.logExecution(botId, ruleId, action.type, "SUCCESS", envelope);
    }
  }

  private transportClient: MqttClient | null = null;
  setTransportClient(client: MqttClient): void {
    this.transportClient = client;
  }

  private sessionScope(envelope: EventEnvelope, context: Record<string, unknown>): string {
    const senderId =
      (context["actor"] as { userId?: string } | undefined)?.userId ??
      (typeof envelope.data === "object" && envelope.data !== null
        ? String((envelope.data as { senderId?: unknown }).senderId ?? "system")
        : "system");
    return `${envelope.conversationId ?? "global"}:${senderId}:session`;
  }

  private async logExecution(
    botId: string,
    ruleId: string | null,
    actionType: string,
    status: "SUCCESS" | "FAILED" | "SKIPPED",
    envelope: EventEnvelope,
    output?: unknown,
    error?: unknown,
  ): Promise<void> {
    await this.db.botExecutionLog
      .create({
        data: {
          botId,
          ruleId,
          actionType,
          status,
          output: output === undefined ? undefined : (output as object),
          error: error instanceof Error ? error.message : error ? String(error) : null,
          correlationId: envelope.correlationId,
          causationId: envelope.eventId,
        },
      })
      .catch(() => undefined);
  }
}
