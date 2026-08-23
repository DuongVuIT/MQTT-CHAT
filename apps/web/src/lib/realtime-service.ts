import mqtt, { type MqttClient } from "mqtt";
import {
  buildCommandEnvelope,
  COMMAND_TOPICS,
  EVENT_TOPICS,
  MQTT_QOS,
  parseEventEnvelope,
  userEventsWildcardTopic,
  type EventEnvelope,
} from "@mqtt-chat/mqtt-contracts";

/**
 * Realtime service — the ONLY place the web app touches MQTT.
 *
 * Responsibilities:
 *   - single connection per tab (userId:deviceId clientId)
 *   - reconnect + automatic resubscribe
 *   - presence via connect/LWT
 *   - typed event dispatch to subscribers
 *   - command publishing (message.send/edit/delete, reaction, receipt, typing)
 */

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";

export interface Identity {
  userId: string;
  deviceId: string;
}

type EventHandler = (envelope: EventEnvelope) => void;

export class RealtimeService {
  private client: MqttClient | null = null;
  private handlers = new Set<EventHandler>();
  private stateHandlers = new Set<(state: ConnectionState) => void>();
  private subscribedTopics = new Set<string>();
  private identity: Identity | null = null;

  onState(handler: (state: ConnectionState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  onEvent(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async connect(identity: Identity): Promise<void> {
    if (this.client?.connected) return;
    this.identity = identity;

    const wsUrl = process.env.NEXT_PUBLIC_MQTT_WS_URL ?? "ws://localhost:8083/mqtt";
    // MQTT clientIds must be UNIQUE PER CONNECTION. A bare `userId:deviceId`
    // collides whenever the same identity is open twice (two tabs, a zombie
    // session + a fresh one): EMQX takeover kicks the old connection, its
    // auto-reconnect kicks the new one back — an endless presence
    // online/offline flap. The logical deviceId stays in the actor envelope
    // for presence accounting; only the broker clientId gains a nonce.
    const clientId = `${identity.userId}:${identity.deviceId}:${Date.now()}`;

    const client = mqtt.connect(wsUrl, {
      clientId,
      clean: true,
      keepalive: 30,
      reconnectPeriod: 2000,
      connectTimeout: 10_000,
      will: {
        topic: COMMAND_TOPICS.presenceSet,
        // LWT must be a valid command envelope — the broker publishes it on
        // abrupt disconnect and chat-worker validates it like any command.
        payload: JSON.stringify({
          requestId: crypto.randomUUID(),
          commandType: "presence.set",
          version: 1,
          timestamp: new Date().toISOString(),
          actor: { userId: identity.userId, deviceId: identity.deviceId },
          data: { isOnline: false },
        }),
        qos: 1 as const,
        retain: false,
      },
    });

    this.client = client;

    client.on("connect", () => {
      this.emitState("connected");
      // Re-subscribe everything after (re)connect.
      for (const topic of this.subscribedTopics) {
        client.subscribe(topic, { qos: 1 });
      }
      // Announce presence.
      this.publishCommand("presence.set", { isOnline: true }, MQTT_QOS.command);
    });

    client.on("reconnect", () => {
      this.emitState("reconnecting");
    });
    client.on("close", () => {
      if (!client.connected) this.emitState("disconnected");
    });
    client.on("error", () => {
      this.emitState("disconnected");
    });

    client.on("message", (_topic, payload) => {
      try {
        const envelope = parseEventEnvelope(payload);
        for (const handler of this.handlers) handler(envelope);
      } catch {
        // Malformed payload — ignore (server events are trusted but validated).
      }
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("MQTT connect timeout"));
      }, 15_000);
      client.once("connect", () => {
        clearTimeout(timeout);
        resolve();
      });
      client.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * Subscribe to the conversation-scoped event streams. Canonical events are
   * published on flat per-event-type topics (see EVENT_TOPICS), so clients use
   * `/#` wildcards and route by the conversationId carried in each envelope.
   * Idempotent.
   */
  subscribeConversation(_conversationId: string): void {
    if (!this.client) return;
    const topics = [
      `${EVENT_TOPICS.messageCreated}/#`,
      `${EVENT_TOPICS.messageEdited}/#`,
      `${EVENT_TOPICS.messageDeleted}/#`,
      `${EVENT_TOPICS.reactionAdded}/#`,
      `${EVENT_TOPICS.reactionRemoved}/#`,
    ];
    for (const topic of topics) {
      if (!this.subscribedTopics.has(topic)) {
        this.subscribedTopics.add(topic);
        this.client.subscribe(topic, { qos: 1 });
      }
    }
  }

  /** Global topics: own receipts + all presence/typing + conversation lifecycle. */
  subscribeGlobal(userId: string): void {
    if (!this.client) return;
    const topics = [
      `${EVENT_TOPICS.presenceOnline}/#`,
      `${EVENT_TOPICS.presenceOffline}/#`,
      `${EVENT_TOPICS.typingStarted}/#`,
      `${EVENT_TOPICS.typingStopped}/#`,
      // Conversation lifecycle (created/updated/member changes) — flat topics.
      `${EVENT_TOPICS.conversationCreated}/#`,
      `${EVENT_TOPICS.conversationUpdated}/#`,
      `${EVENT_TOPICS.conversationMemberJoined}/#`,
      `${EVENT_TOPICS.conversationMemberLeft}/#`,
      // Receipts are delivered on per-user topics (chat/v1/users/{id}/events/...).
      userEventsWildcardTopic(userId),
    ];
    for (const topic of topics) {
      if (!this.subscribedTopics.has(topic)) {
        this.subscribedTopics.add(topic);
        this.client.subscribe(topic, { qos: 1 });
      }
    }
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
    if (!this.client || !this.identity) return;
    const envelope = buildCommandEnvelope({
      commandType,
      actor: { userId: this.identity.userId, deviceId: this.identity.deviceId },
      data: data as never,
    });
    const topic =
      COMMAND_TOPICS[commandType as keyof typeof COMMAND_TOPICS] ?? COMMAND_TOPICS.messageSend;
    this.client.publish(topic, JSON.stringify(envelope), { qos });
  }

  disconnect(): void {
    if (!this.client) return;
    // Graceful offline announcement before closing.
    if (this.identity) {
      this.publishCommand("presence.set", { isOnline: false }, MQTT_QOS.command);
    }
    this.subscribedTopics.clear();
    this.client.end(true);
    this.client = null;
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
