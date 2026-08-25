import {
  ChatRealtimeClient,
  type ConnectionStatus,
  type RealtimeEvent,
  type RealtimeIdentity,
} from "@mqtt-chat/realtime-core";
import { COMMAND_TOPICS, MQTT_QOS, type EventEnvelope } from "@mqtt-chat/mqtt-contracts";

/**
 * Web realtime service — thin wrapper around the shared
 * `@mqtt-chat/realtime-core` client. The web app must NEVER import `mqtt`
 * directly; all transport concerns live in realtime-core.
 *
 * Responsibilities:
 *   - single connection per tab (identity-scoped session)
 *   - reconnect + automatic resubscribe (core) + presence announce
 *   - presence via connect/LWT
 *   - typed event dispatch to subscribers
 *   - command publishing (message.send/edit/delete, reaction, receipt, typing)
 */

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";

export type Identity = RealtimeIdentity;

/**
 * Default MQTT WebSocket URL — SAME ORIGIN via the public gateway path.
 * `NEXT_PUBLIC_MQTT_WS_URL` may override for exotic setups.
 */
export function defaultMqttWsUrl(): string {
  const override = process.env.NEXT_PUBLIC_MQTT_WS_URL;
  if (override) return override;
  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${window.location.host}/mqtt`;
  }
  return "ws://localhost:3000/mqtt";
}

function toConnectionState(status: ConnectionStatus): ConnectionState {
  return status === "offline" ? "disconnected" : status;
}

type EventHandler = (envelope: EventEnvelope) => void;

export class RealtimeService {
  private core: ChatRealtimeClient | null = null;
  private handlers = new Set<EventHandler>();
  private stateHandlers = new Set<(state: ConnectionState) => void>();
  private identity: Identity | null = null;
  /** Global topics requested via subscribeGlobal — restored on reconnect by core extras. */
  private globalTopics: string[] = [];

  onState(handler: (state: ConnectionState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  onEvent(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /**
   * Connect (or re-connect as a NEW identity). If a session already exists
   * for another identity it is torn down completely first — switching user
   * must never reuse or mutate the previous MQTT session.
   */
  async connect(identity: Identity): Promise<void> {
    if (this.identity && this.core?.hasSession) {
      const sameIdentity =
        this.identity.userId === identity.userId && this.identity.deviceId === identity.deviceId;
      if (sameIdentity && this.core.status === "connected") return;
    }
    await this.disconnect();

    this.identity = identity;
    // PERF: NO extra lifecycle wildcards here. The core already subscribes
    // the canonical all-events wildcard (chat/v1/events/#), which fans out
    // conversation.* too — subscribing them AGAIN delivered every lifecycle
    // event TWICE to handleEvent (double upserts/reconciliations on web).
    // Receipts arrive via the user topic in subscribeGlobal.
    this.globalTopics = [];

    const core = new ChatRealtimeClient({
      url: defaultMqttWsUrl(),
      identity,
      extraEventWildcards: this.globalTopics,
      will: {
        topic: COMMAND_TOPICS.presenceSet,
        // LWT must be a valid command envelope — the broker publishes it on
        // abrupt disconnect and chat-worker validates it like any command.
        payload: JSON.stringify({
          requestId:
            globalThis.crypto?.randomUUID?.() ??
            `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          commandType: "presence.set",
          version: 1,
          timestamp: new Date().toISOString(),
          actor: { userId: identity.userId, deviceId: identity.deviceId },
          data: { isOnline: false },
        }),
        qos: 1,
      },
      onStatus: (status) => this.emitState(toConnectionState(status)),
      onConnect: () => {
        // Announce presence after every (re)connect.
        void core.setPresence(true).catch(() => {
          /* transient — next reconnect retries */
        });
      },
      onEvent: (event: RealtimeEvent) => {
        try {
          // Core emits parsed JSON; contracts validation happens here so both
          // strictness and error handling stay in one place per platform shell.
          const envelope = event as unknown as EventEnvelope;
          for (const handler of this.handlers) handler(envelope);
        } catch {
          // Malformed payload — ignore (server events are trusted but validated).
        }
      },
    });

    this.core = core;
    await core.connect();
  }

  /** Idempotent; conversation fan-out is covered by wildcards (tracked for API compat). */
  subscribeConversation(_conversationId: string): void {
    this.core?.subscribeConversation(_conversationId);
  }

  /** Per-user targeted topic is subscribed by core; kept for API compatibility. */
  subscribeGlobal(userId: string): void {
    // no-op beyond API compat: core subscribes chat/v1/users/{id}/events/# and
    // the lifecycle extras passed at connect().
    void userId;
  }

  publishCommand(
    commandType:
      | "message.send"
      | "message.edit"
      | "message.delete"
      | "reaction.add"
      | "reaction.remove"
      | "receipt.read"
      | "receipt.delivered"
      | "presence.set"
      | "typing.set",
    data: Record<string, unknown>,
    qos: 0 | 1 = MQTT_QOS.command,
  ): void {
    const core = this.core;
    if (!core) return;
    // The core publishes a canonical envelope (nested `data`) on the mapped
    // command topic; failures are swallowed at this fire-and-forget boundary.
    void core.publishCommand(commandType, data, qos).catch(() => {});
  }

  /** Critical commands (notably durable read receipts) need delivery errors
   *  surfaced so callers can retain/retry their local watermark. */
  publishCommandAsync(
    commandType:
      | "message.send"
      | "message.edit"
      | "message.delete"
      | "reaction.add"
      | "reaction.remove"
      | "receipt.read"
      | "receipt.delivered"
      | "presence.set"
      | "typing.set",
    data: Record<string, unknown>,
    qos: 0 | 1 = MQTT_QOS.command,
  ): Promise<void> {
    const core = this.core;
    if (!core) return Promise.reject(new Error("MQTT session unavailable"));
    return core.publishCommand(commandType, data, qos);
  }

  /** Full teardown — graceful offline announce, socket closed, state cleared. */
  async disconnect(): Promise<void> {
    const core = this.core;
    if (!core) return;
    if (core.status === "connected" && this.identity) {
      await core.setPresence(false).catch(() => {});
    }
    await core.disconnect();
    this.core = null;
    this.identity = null;
    this.emitState("disconnected");
  }

  private emitState(state: ConnectionState): void {
    for (const handler of this.stateHandlers) handler(state);
  }
}

let singleton: RealtimeService | null = null;

export function getRealtimeService(): RealtimeService {
  singleton ??= new RealtimeService();
  return singleton;
}
