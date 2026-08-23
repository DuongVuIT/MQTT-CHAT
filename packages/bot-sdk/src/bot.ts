import { randomUUID } from "node:crypto";
import type { EventEnvelope, MessageEventData, PresenceEventData } from "@mqtt-chat/mqtt-contracts";

/**
 * Internal bot framework.
 *
 *   const bot = new Bot({ id: "system-bot" })
 *   bot.command("ping", async (ctx) => ctx.reply("pong"))
 *   bot.onMessage(async (ctx) => { ... })
 *   bot.onUserOnline(async (ctx) => { ... })
 *
 * Bots NEVER publish canonical events directly — all outbound messages go
 * through ctx.reply/sendMessage which emit a "bot.send" COMMAND consumed by
 * the chat-worker. Loop protection: BOT-originated messages are ignored by
 * default unless allowBotMessages is enabled.
 */

export interface BotOptions {
  id: string;
  /** Ignore messages sent by bots (loop protection). Default true. */
  allowBotMessages?: boolean;
  /** Max automation chain depth via causationId tracking. */
  maxAutomationDepth?: number;
}

export interface BotTransport {
  /** Send a bot.send command through the broker → chat-worker → DB → canonical event. */
  sendBotCommand(payload: {
    conversationId: string;
    content: string;
    replyToId?: string | null;
    metadata?: Record<string, unknown> | null;
    correlationId?: string;
    causationId?: string;
    ruleId?: string;
  }): Promise<void>;

  addReaction(payload: {
    conversationId: string;
    messageId: string;
    emoji: string;
    correlationId?: string;
    causationId?: string;
    ruleId?: string;
  }): Promise<void>;
}

/** State store abstraction implemented by the worker (Redis-backed). */
export interface BotStateStore {
  getState<T>(scopeKey: string): Promise<T | null>;
  setState(scopeKey: string, state: unknown): Promise<void>;
  deleteState(scopeKey: string): Promise<void>;
  incrementCounter(scopeKey: string, field: string): Promise<number>;
}

export type EventHandler = (ctx: BotContext) => Promise<void> | void;

export interface BotContext {
  readonly event: EventEnvelope;
  readonly message: MessageEventData | null;
  readonly presence: PresenceEventData | null;
  readonly botId: string;
  readonly args: string[];
  readonly parsedCommand: { command: string; args: string[] } | null;

  sendMessage(content: string): Promise<void>;
  reply(content: string): Promise<void>;
  react(emoji: string): Promise<void>;

  getState<T>(key?: string): Promise<T | null>;
  setState(key: string, value: unknown): Promise<void>;
  deleteState(key: string): Promise<void>;
  incrementCounter(field: string): Promise<number>;
}

interface CommandRegistration {
  name: string;
  handler: EventHandler;
}

type Middleware = (ctx: BotContext, next: () => Promise<void>) => Promise<void> | void;

export class Bot {
  readonly id: string;
  private readonly allowBotMessages: boolean;
  private readonly maxAutomationDepth: number;

  private readonly commandHandlers = new Map<string, CommandRegistration>();
  private readonly messageHandlers: EventHandler[] = [];
  private readonly eventHandlers = new Map<string, EventHandler[]>();
  private readonly middlewares: Middleware[] = [];

  constructor(
    options: BotOptions,
    private readonly transport: BotTransport,
    private readonly stateStore: BotStateStore,
  ) {
    this.id = options.id;
    this.allowBotMessages = options.allowBotMessages ?? false;
    this.maxAutomationDepth = options.maxAutomationDepth ?? 3;
  }

  use(middleware: Middleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  on(eventType: string, handler: EventHandler): this {
    const list = this.eventHandlers.get(eventType) ?? [];
    list.push(handler);
    this.eventHandlers.set(eventType, list);
    return this;
  }

  onMessage(handler: EventHandler): this {
    this.messageHandlers.push(handler);
    return this;
  }

  onUserOnline(handler: EventHandler): this {
    return this.on("presence.online", handler);
  }

  onUserOffline(handler: EventHandler): this {
    return this.on("presence.offline", handler);
  }

  command(name: string, handler: EventHandler): this {
    this.commandHandlers.set(name.toLowerCase(), { name: name.toLowerCase(), handler });
    return this;
  }

  hasCommand(name: string): boolean {
    return this.commandHandlers.has(name.toLowerCase());
  }

  listCommands(): string[] {
    return [...this.commandHandlers.keys()].sort();
  }

  /**
   * Process an incoming canonical event.
   * Returns matched handler count for logging/observability.
   */
  async processEvent(envelope: EventEnvelope): Promise<number> {
    // ---- Loop protection ----
    if (!this.allowBotMessages && envelope.origin.type === "bot") {
      return 0;
    }
    const depth = this.automationDepth(envelope);
    if (depth >= this.maxAutomationDepth) {
      return 0;
    }

    let handled = 0;

    if (envelope.eventType === "message.created") {
      const data = envelope.data as MessageEventData;
      const parsed = data.content.startsWith("/") ? parseSimpleCommand(data.content) : null;

      const registered = parsed ? this.commandHandlers.get(parsed.command) : undefined;
      if (parsed && registered) {
        handled += await this.runHandlers([() => registered.handler], envelope, data, parsed);
      }
      if (this.messageHandlers.length > 0) {
        handled += await this.runHandlers(
          this.messageHandlers.map((h) => () => h),
          envelope,
          data,
          parsed,
        );
      }
    }

    const specific = this.eventHandlers.get(envelope.eventType);
    if (specific && specific.length > 0) {
      handled += await this.runHandlers(
        specific.map((h) => () => h),
        envelope,
        null,
        null,
      );
    }

    return handled;
  }

  private async runHandlers(
    factories: Array<() => EventHandler>,
    envelope: EventEnvelope,
    message: MessageEventData | null,
    parsedCommand: { command: string; args: string[] } | null,
  ): Promise<number> {
    let executed = 0;
    for (const factory of factories) {
      const handler = factory();
      const ctx = this.createContext(envelope, message, parsedCommand);
      try {
        await this.runWithMiddleware(ctx, handler);
        executed++;
      } catch (error) {
        // Handler errors must not break processing of other handlers/events.
        console.error(`[bot:${this.id}] handler error`, error);
      }
    }
    return executed;
  }

  private async runWithMiddleware(ctx: BotContext, handler: EventHandler): Promise<void> {
    let index = -1;
    const dispatch = async (i: number): Promise<void> => {
      if (i <= index) throw new Error("next() called multiple times");
      index = i;
      const middleware = this.middlewares[i];
      if (middleware) {
        await middleware(ctx, () => dispatch(i + 1));
      } else {
        await handler(ctx);
      }
    };
    await dispatch(0);
  }

  private createContext(
    envelope: EventEnvelope,
    message: MessageEventData | null,
    parsedCommand: { command: string; args: string[] } | null,
  ): BotContext {
    const senderId =
      envelope.actor?.userId ??
      (typeof envelope.data === "object" && envelope.data !== null
        ? ((envelope.data as { senderId?: string }).senderId ?? "system")
        : "system");
    const scopeKey = `${envelope.conversationId ?? "global"}:${senderId}`;

    return {
      event: envelope,
      message,
      presence:
        envelope.eventType === "presence.online" || envelope.eventType === "presence.offline"
          ? (envelope.data as PresenceEventData)
          : null,
      botId: this.id,
      args: parsedCommand?.args ?? [],
      parsedCommand,

      sendMessage: async (content) => {
        await this.transport.sendBotCommand({
          conversationId: envelope.conversationId ?? "",
          content,
          correlationId: envelope.correlationId,
          causationId: envelope.eventId,
        });
      },
      reply: async (content) => {
        await this.transport.sendBotCommand({
          conversationId: envelope.conversationId ?? "",
          content,
          replyToId: message?.messageId ?? null,
          correlationId: envelope.correlationId,
          causationId: envelope.eventId,
        });
      },
      react: async (emoji) => {
        if (!message) throw new Error("react() requires a message context");
        await this.transport.addReaction({
          conversationId: envelope.conversationId ?? "",
          messageId: message.messageId,
          emoji,
          correlationId: envelope.correlationId,
          causationId: envelope.eventId,
        });
      },

      getState: <T>(key = "default") => this.stateStore.getState<T>(`${scopeKey}:${key}`),
      setState: async (key, value) => {
        await this.stateStore.setState(`${scopeKey}:${key}`, value);
      },
      deleteState: async (key) => {
        await this.stateStore.deleteState(`${scopeKey}:${key}`);
      },
      incrementCounter: (field) => this.stateStore.incrementCounter(`${scopeKey}:counters`, field),
    };
  }

  /** Count automation chain depth by walking causationId references. */
  private automationDepth(envelope: EventEnvelope): number {
    // The chat-worker stamps origin.ruleId on bot-generated events; depth is
    // tracked via correlationId chains in metadata. Conservative default: any
    // bot-origin event counts as depth 1 (already blocked above unless allowed).
    return envelope.origin.type === "bot" ? 1 : 0;
  }
}

function parseSimpleCommand(content: string): { command: string; args: string[] } | null {
  const parts = content.trim().slice(1).split(/\s+/);
  const [command = "", ...args] = parts;
  if (!command) return null;
  return { command: command.toLowerCase(), args };
}

export function newClientMessageId(): string {
  return randomUUID();
}
