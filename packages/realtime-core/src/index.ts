/**
 * @mqtt-chat/realtime-core — platform-agnostic realtime client shared by
 * web and mobile. Contains NO DOM / React Native APIs: only the `mqtt`
 * package (which works over TCP in Node and WebSocket in browsers/RN).
 *
 * Responsibilities:
 * - connect with clean session + reconnect handling
 * - subscribe to canonical flat event topics (message/reaction/receipt/
 *   typing/presence) + per-user targeted events
 * - publish commands (send/edit/delete/react/read/typing/presence)
 * - typed event dispatch via a single handler registry
 */
import mqtt, { type MqttClient } from "mqtt";
import { COMMAND_TOPICS, EVENT_TOPICS, userEventsWildcardTopic } from "@mqtt-chat/mqtt-contracts";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "offline";

export interface RealtimeIdentity {
  userId: string;
  deviceId: string;
}

/** Minimal shape of a canonical event envelope (validated upstream by contracts). */
export interface RealtimeEvent {
  eventId?: string;
  eventType: string;
  version?: number;
  timestamp?: string;
  actor?: { userId: string; deviceId?: string };
  origin?: { type: string };
  data?: Record<string, unknown>;
}

export interface ChatRealtimeClientOptions {
  /** e.g. ws://localhost:8083 (web), mqtt://localhost:1883 or ws://10.0.2.2:8083 (Android emulator). */
  url: string;
  identity: RealtimeIdentity;
  onStatus?: (status: ConnectionStatus) => void;
  onEvent?: (event: RealtimeEvent) => void;
}

const EVENT_WILDCARDS = [
  `${EVENT_TOPICS.messageCreated}/#`,
  `${EVENT_TOPICS.messageEdited}/#`,
  `${EVENT_TOPICS.messageDeleted}/#`,
  `${EVENT_TOPICS.reactionAdded}/#`,
  `${EVENT_TOPICS.reactionRemoved}/#`,
  `${EVENT_TOPICS.typingStarted}/#`,
  `${EVENT_TOPICS.typingStopped}/#`,
  `${EVENT_TOPICS.presenceOnline}/#`,
  `${EVENT_TOPICS.presenceOffline}/#`,
];

export class ChatRealtimeClient {
  private client: MqttClient | null = null;
  private readonly opts: ChatRealtimeClientOptions;
  private subscribedConversations = new Set<string>();
  private userEventsSubscribed = false;

  constructor(opts: ChatRealtimeClientOptions) {
    this.opts = opts;
  }

  get status(): ConnectionStatus {
    if (!this.client) return "offline";
    if (this.client.connected) return "connected";
    if (this.client.reconnecting) return "reconnecting";
    return "connecting";
  }

  connect(): Promise<void> {
    const { url, identity, onStatus } = this.opts;
    onStatus?.("connecting");
    return new Promise((resolve, reject) => {
      const client = mqtt.connect(url, {
        clientId: `${identity.userId}:${identity.deviceId}:${Date.now()}`,
        clean: true,
        keepalive: 30,
        reconnectPeriod: 2000,
        connectTimeout: 10_000,
      });
      this.client = client;

      client.on("connect", () => {
        onStatus?.("connected");
        // (Re)subscribe everything we are supposed to be listening to.
        for (const pattern of EVENT_WILDCARDS) client.subscribe(pattern, { qos: 1 });
        {
          // conversation-scoped fan-out is covered by flat wildcards above;
          // per-user targeted topics need an explicit subscribe:
          if (!this.userEventsSubscribed) {
            client.subscribe(userEventsWildcardTopic(identity.userId), { qos: 1 });
            this.userEventsSubscribed = true;
          }
        }
        resolve();
      });
      client.on("reconnect", () => onStatus?.("reconnecting"));
      client.on("close", () => onStatus?.("offline"));
      client.on("error", (err) => {
        if (!client.connected) reject(err);
      });
      client.on("message", (_topic, payload) => {
        try {
          const parsed = JSON.parse(payload.toString()) as RealtimeEvent;
          if (parsed && typeof parsed.eventType === "string") {
            this.opts.onEvent?.(parsed);
          }
        } catch {
          /* ignore malformed payloads */
        }
      });
    });
  }

  subscribeConversation(_conversationId: string): void {
    // Flat per-event-type wildcards already cover all conversations.
    // Tracked for API compatibility and future per-conversation ACLs.
    this.subscribedConversations.add(_conversationId);
  }

  private publish(topic: string, commandType: string, data: unknown): Promise<void> {
    const { identity } = this.opts;
    const envelope = {
      requestId: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      commandType,
      version: 1,
      timestamp: new Date().toISOString(),
      actor: { userId: identity.userId, deviceId: identity.deviceId },
      ...(data as Record<string, unknown>),
    };
    return new Promise((resolve, reject) => {
      if (!this.client?.connected) {
        reject(new Error("MQTT not connected"));
        return;
      }
      this.client.publish(topic, JSON.stringify(envelope), { qos: 1 }, (err) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  sendMessage(input: {
    conversationId: string;
    clientMessageId: string;
    type: string;
    content: string;
    replyToId: string | null;
    metadata: unknown;
  }): Promise<void> {
    return this.publish(COMMAND_TOPICS.messageSend, "message.send", input);
  }

  editMessage(input: { messageId: string; content: string }): Promise<void> {
    return this.publish(COMMAND_TOPICS.messageEdit, "message.edit", input);
  }

  deleteMessage(messageId: string): Promise<void> {
    return this.publish(COMMAND_TOPICS.messageDelete, "message.delete", { messageId });
  }

  addReaction(input: { messageId: string; emoji: string }): Promise<void> {
    return this.publish(COMMAND_TOPICS.reactionAdd, "reaction.add", input);
  }

  removeReaction(input: { messageId: string; emoji: string }): Promise<void> {
    return this.publish(COMMAND_TOPICS.reactionRemove, "reaction.remove", input);
  }

  markRead(conversationId: string, lastReadSequence: number): Promise<void> {
    return this.publish(COMMAND_TOPICS.receiptRead, "receipt.read", {
      conversationId,
      lastReadSequence,
    });
  }

  setTyping(conversationId: string, isTyping: boolean): Promise<void> {
    return this.publish(COMMAND_TOPICS.typingSet, "typing.set", { conversationId, isTyping });
  }

  disconnect(): void {
    this.client?.end(true);
    this.client = null;
    this.subscribedConversations.clear();
    this.userEventsSubscribed = false;
  }
}
