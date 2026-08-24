/**
 * @mqtt-chat/realtime-core — platform-agnostic realtime client shared by
 * web, admin and mobile. This is the ONLY layer allowed to import the `mqtt`
 * package on the client side; applications talk to ChatRealtimeClient.
 * Contains NO DOM / React Native APIs: only the `mqtt` package (which works
 * over TCP in Node and WebSocket in browsers/RN).
 *
 * Responsibilities:
 * - connect with clean session + reconnect handling (+ optional LWT will)
 * - subscribe to canonical flat event topics (message/reaction/receipt/
 *   typing/presence/conversation lifecycle) + per-user targeted events
 * - publish commands wrapped in canonical command envelopes
 * - typed event dispatch via a single handler registry
 */
import mqtt, { type MqttClient } from "mqtt";
import {
  COMMAND_TOPICS,
  MQTT_QOS,
  SUBSCRIPTION_PATTERNS,
  userEventsWildcardTopic,
} from "@mqtt-chat/mqtt-contracts";

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
  conversationId?: string;
  origin?: { type: string };
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Canonical message normalization — the ONE boundary between wire data and
// the UI message model, shared by web and mobile (§ message contract).
//
// Historical crash: the canonical message.created event did not carry
// `reactions`, and the mobile renderer read `item.reactions.length` on the
// raw event payload → "Cannot read property 'length' of undefined".
// Every UI Message MUST come from normalizeMessage() so invariants hold:
//   reactions: Array (never undefined)
//   metadata: object | null   replyToId/editedAt/deletedAt: string | null
//   senderName: string (falls back to senderId)
// ---------------------------------------------------------------------------

export type MessageSenderType = "USER" | "BOT" | "SYSTEM";
export type MessageType = "TEXT" | "IMAGE" | "VIDEO" | "FILE" | "VOICE" | "SYSTEM";

/** The canonical UI message model — identical shape on web and mobile. */
export interface NormalizedMessage {
  id: string;
  clientMessageId: string;
  conversationId: string;
  senderId: string;
  senderType: MessageSenderType;
  senderName: string;
  sequence: number;
  type: MessageType;
  content: string;
  replyToId: string | null;
  metadata: Record<string, unknown> | null;
  reactions: Array<{ emoji: string; userId: string }>;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function asNullableIso(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// ---------------------------------------------------------------------------
// Canonical conversation normalization — same rationale as normalizeMessage:
// ONE boundary between wire data (HTTP list rows, conversation.created /
// member-joined / member-left / updated events) and the UI model, shared by
// web and mobile. Guarantees `members` is ALWAYS an array (historical crash
// class: conversation.members.find on incomplete payloads).
// ---------------------------------------------------------------------------

export interface NormalizedConversationMember {
  userId: string;
  role: string;
  lastReadSequence: number;
}

export interface NormalizedConversation {
  id: string;
  type: "DIRECT" | "GROUP";
  title: string | null;
  memberCount: number;
  lastSequence: number;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  members: NormalizedConversationMember[];
}

/**
 * Normalize ANY conversation-shaped payload into the canonical UI model.
 * Never throws; malformed members entries are dropped; missing arrays
 * become empty arrays.
 */
export function normalizeConversation(raw: unknown): NormalizedConversation {
  const source = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

  const members = Array.isArray(source["members"])
    ? (source["members"] as Array<Record<string, unknown>>)
        .filter((m): m is Record<string, unknown> => typeof m === "object" && m !== null)
        .map((m) => ({
          userId: asString(m["userId"], ""),
          role: asString(m["role"], "MEMBER"),
          lastReadSequence: Number.isFinite(Number(m["lastReadSequence"]))
            ? Number(m["lastReadSequence"])
            : 0,
        }))
        .filter((m) => m.userId.length > 0)
    : [];

  const type = source["type"] === "DIRECT" ? "DIRECT" : "GROUP";

  return {
    id: asString(source["id"], ""),
    type,
    title: asNullableIso(source["title"]),
    memberCount: Number.isFinite(Number(source["memberCount"]))
      ? Number(source["memberCount"])
      : members.length,
    lastSequence: Number.isFinite(Number(source["lastSequence"]))
      ? Number(source["lastSequence"])
      : 0,
    lastMessagePreview: asNullableIso(source["lastMessagePreview"]),
    lastMessageAt: asNullableIso(source["lastMessageAt"]),
    members,
  };
}

/**
 * Upsert ONE conversation entity into a list (identity = conversation id).
 * Preserves locally-known activity (preview/time/sequence) when the incoming
 * payload carries no message info (membership events), and never regresses
 * lastSequence. Returns a NEW list; duplicates collapse to ONE entity.
 */
export function upsertConversationInto(
  list: NormalizedConversation[],
  incoming: NormalizedConversation,
): NormalizedConversation[] {
  const existing = list.find((c) => c.id === incoming.id);
  const merged: NormalizedConversation = existing
    ? {
        ...incoming,
        lastMessagePreview: incoming.lastMessagePreview ?? existing.lastMessagePreview,
        lastMessageAt: incoming.lastMessageAt ?? existing.lastMessageAt,
        lastSequence: Math.max(existing.lastSequence, incoming.lastSequence),
      }
    : incoming;
  return existing ? list.map((c) => (c.id === incoming.id ? merged : c)) : [merged, ...list];
}

/**
 * Normalize ANY message-shaped payload (HTTP history row, canonical MQTT
 * event data, legacy persisted message, bot message) into the canonical UI
 * model. Never throws on malformed input — every field gets a safe value,
 * and contract drift stays visible in development via console.warn.
 */
export function normalizeMessage(raw: unknown): NormalizedMessage {
  const source = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

  const reactions = Array.isArray(source["reactions"])
    ? (source["reactions"] as Array<{ emoji: unknown; userId: unknown }>)
        .filter(
          (r): r is { emoji: string; userId: string } =>
            typeof r?.["emoji"] === "string" && typeof r?.["userId"] === "string",
        )
        .map((r) => ({ emoji: r.emoji, userId: r.userId }))
    : [];

  if (
    process.env.NODE_ENV !== "production" &&
    source["reactions"] === undefined &&
    "messageId" in source
  ) {
    // Contract drift beacon: producers should emit reactions per contract;
    // normalization keeps the UI alive but the gap must stay visible in dev.
    console.warn(
      "[normalizeMessage] payload missing `reactions` — normalized to []. Producer contract drift?",
    );
  }

  const senderId = asString(source["senderId"], "unknown");
  const senderType = (["USER", "BOT", "SYSTEM"] as const).includes(
    source["senderType"] as MessageSenderType,
  )
    ? (source["senderType"] as MessageSenderType)
    : "USER";
  const type = (["TEXT", "IMAGE", "VIDEO", "FILE", "VOICE", "SYSTEM"] as const).includes(
    source["type"] as MessageType,
  )
    ? (source["type"] as MessageType)
    : "TEXT";

  return {
    id: asString(source["id"] ?? source["messageId"], ""),
    clientMessageId: asString(source["clientMessageId"], ""),
    conversationId: asString(source["conversationId"], ""),
    senderId,
    senderType,
    senderName: asString(source["senderName"], senderId),
    sequence: Number.isFinite(Number(source["sequence"])) ? Number(source["sequence"]) : 0,
    type,
    content: typeof source["content"] === "string" ? source["content"] : "",
    replyToId: asNullableIso(source["replyToId"]),
    metadata:
      typeof source["metadata"] === "object" && source["metadata"] !== null
        ? (source["metadata"] as Record<string, unknown>)
        : null,
    reactions,
    createdAt: asString(source["createdAt"], new Date(0).toISOString()),
    editedAt: asNullableIso(source["editedAt"]),
    deletedAt: asNullableIso(source["deletedAt"]),
  };
}

/** MQTT LWT — published by the broker on abrupt disconnect. */
export interface RealtimeWill {
  topic: string;
  payload: string;
  qos?: 0 | 1;
}

export interface ChatRealtimeClientOptions {
  /**
   * Broker WebSocket URL. Browsers/RN pass a ws(s):// URL; Node may use mqtt://.
   * Single-origin deployments use `<ws|wss>://<public-host>/mqtt` (gateway-proxied).
   */
  url: string;
  identity: RealtimeIdentity;
  /** Extra flat wildcard topics to (re)subscribe on every connect (e.g. conversation lifecycle). */
  extraEventWildcards?: string[];
  /** Subscribe to this user's per-user targeted topic (`chat/v1/users/{id}/events/#`). Default true. */
  subscribeUserEvents?: boolean;
  /** Last Will — announced by the broker if the connection drops uncleanly. */
  will?: RealtimeWill;
  /** Called on every (re)connect after subscriptions are restored. */
  onConnect?: () => void;
  onStatus?: (status: ConnectionStatus) => void;
  onEvent?: (event: RealtimeEvent) => void;
}

/** Flat per-event-type fan-out is covered by the canonical all-events wildcard. */
const BASE_EVENT_WILDCARDS: readonly string[] = [SUBSCRIPTION_PATTERNS.allEvents];

/** Canonical commandType → topic mapping (dotted command types, not topic keys). */
const COMMAND_TYPE_TO_TOPIC: Record<string, string> = {
  "message.send": COMMAND_TOPICS.messageSend,
  "message.edit": COMMAND_TOPICS.messageEdit,
  "message.delete": COMMAND_TOPICS.messageDelete,
  "reaction.add": COMMAND_TOPICS.reactionAdd,
  "reaction.remove": COMMAND_TOPICS.reactionRemove,
  "receipt.read": COMMAND_TOPICS.receiptRead,
  "receipt.delivered": COMMAND_TOPICS.receiptDelivered,
  "presence.set": COMMAND_TOPICS.presenceSet,
  "typing.set": COMMAND_TOPICS.typingSet,
};

/**
 * Safe UUID: browsers/Node expose crypto.randomUUID; some React Native
 * runtimes (Hermes) do not — fall back to a random-string id.
 */
function safeUuid(): string {
  try {
    return (
      globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export class ChatRealtimeClient {
  private client: MqttClient | null = null;
  private readonly opts: ChatRealtimeClientOptions;
  private subscribedConversations = new Set<string>();

  constructor(opts: ChatRealtimeClientOptions) {
    this.opts = opts;
  }

  get status(): ConnectionStatus {
    if (!this.client) return "offline";
    if (this.client.connected) return "connected";
    if (this.client.reconnecting) return "reconnecting";
    return "connecting";
  }

  /** True while an MQTT session exists (even mid-reconnect). */
  get hasSession(): boolean {
    return this.client !== null;
  }

  connect(): Promise<void> {
    const { url, identity, onStatus, will } = this.opts;
    onStatus?.("connecting");
    // MQTT clientIds must be UNIQUE PER CONNECTION. A bare `userId:deviceId`
    // collides whenever the same identity is open twice (two tabs, zombie
    // session): EMQX takeover kicks the old connection, its auto-reconnect
    // kicks back — endless presence flap. The logical deviceId stays in the
    // actor envelope; only the broker clientId gains a nonce.
    const clientId = `${identity.userId}:${identity.deviceId}:${Date.now()}`;

    return new Promise((resolve, reject) => {
      const client = mqtt.connect(url, {
        clientId,
        clean: true,
        keepalive: 30,
        reconnectPeriod: 2000,
        connectTimeout: 10_000,
        ...(will ? { will: { ...will, qos: will.qos ?? 1, retain: false } } : {}),
      });
      this.client = client;

      let settled = false;

      const restoreSubscriptions = (): void => {
        for (const pattern of [...BASE_EVENT_WILDCARDS, ...(this.opts.extraEventWildcards ?? [])]) {
          client.subscribe(pattern, { qos: 1 });
        }
        if (this.opts.subscribeUserEvents !== false) {
          client.subscribe(userEventsWildcardTopic(identity.userId), { qos: 1 });
        }
      };

      client.on("connect", () => {
        restoreSubscriptions();
        this.opts.onConnect?.();
        onStatus?.("connected");
        if (!settled) {
          settled = true;
          resolve();
        }
      });
      client.on("reconnect", () => onStatus?.("reconnecting"));
      client.on("close", () => onStatus?.("offline"));
      client.on("error", (err) => {
        if (!settled && !client.connected) {
          settled = true;
          reject(err);
        }
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

  /** Track a conversation subscription. Flat wildcards already fan out all
   *  conversation events; kept for API compatibility and future ACLs. */
  subscribeConversation(conversationId: string): void {
    this.subscribedConversations.add(conversationId);
  }

  /**
   * Tear down the current session completely (socket closed, state cleared)
   * so a subsequent connect() builds a fresh session — required for identity
   * switching, never reuse a session across identities.
   */
  async disconnect(force = true): Promise<void> {
    const client = this.client;
    this.client = null;
    this.subscribedConversations.clear();
    if (!client) return;
    await new Promise<void>((resolve) => {
      client.end(force, {}, () => resolve());
    });
  }

  private async publish(
    commandType: string,
    commandTopic: string,
    data: unknown,
    qos: 0 | 1,
  ): Promise<void> {
    const client = this.client;
    const { identity } = this.opts;
    if (!client || !client.connected) {
      throw new Error("MQTT not connected");
    }
    // Canonical command envelope — `data` MUST be nested, never flattened.
    const envelope = {
      requestId: safeUuid(),
      commandType,
      version: 1,
      timestamp: new Date().toISOString(),
      actor: { userId: identity.userId, deviceId: identity.deviceId },
      data,
    };
    await new Promise<void>((resolve, reject) => {
      client.publish(commandTopic, JSON.stringify(envelope), { qos }, (err) =>
        err ? reject(err) : resolve(),
      );
    });
  }

  /** Generic canonical command publisher (presence, receipts, typing, …). */
  publishCommand(
    commandType: keyof typeof COMMAND_TYPE_TO_TOPIC,
    data: Record<string, unknown>,
    qos: 0 | 1 = MQTT_QOS.command,
  ): Promise<void> {
    const topic = COMMAND_TYPE_TO_TOPIC[commandType];
    if (!topic) throw new Error(`Unknown command type: ${String(commandType)}`);
    return this.publish(commandType, topic, data, qos);
  }

  sendMessage(input: {
    conversationId: string;
    clientMessageId: string;
    type: string;
    content: string;
    replyToId: string | null;
    metadata: unknown;
  }): Promise<void> {
    return this.publish("message.send", COMMAND_TOPICS.messageSend, input, MQTT_QOS.command);
  }

  editMessage(input: {
    messageId: string;
    conversationId: string;
    content: string;
  }): Promise<void> {
    return this.publish("message.edit", COMMAND_TOPICS.messageEdit, input, MQTT_QOS.command);
  }

  deleteMessage(input: { messageId: string; conversationId: string }): Promise<void> {
    return this.publish("message.delete", COMMAND_TOPICS.messageDelete, input, MQTT_QOS.command);
  }

  addReaction(input: { messageId: string; conversationId: string; emoji: string }): Promise<void> {
    return this.publish("reaction.add", COMMAND_TOPICS.reactionAdd, input, MQTT_QOS.command);
  }

  removeReaction(input: {
    messageId: string;
    conversationId: string;
    emoji: string;
  }): Promise<void> {
    return this.publish("reaction.remove", COMMAND_TOPICS.reactionRemove, input, MQTT_QOS.command);
  }

  markRead(conversationId: string, lastReadSequence: number): Promise<void> {
    return this.publish(
      "receipt.read",
      COMMAND_TOPICS.receiptRead,
      { conversationId, lastReadSequence },
      MQTT_QOS.command,
    );
  }

  markDelivered(conversationId: string, lastDeliveredSequence: number): Promise<void> {
    return this.publish(
      "receipt.delivered",
      COMMAND_TOPICS.receiptDelivered,
      { conversationId, lastDeliveredSequence },
      MQTT_QOS.command,
    );
  }

  setTyping(conversationId: string, isTyping: boolean): Promise<void> {
    return this.publish(
      "typing.set",
      COMMAND_TOPICS.typingSet,
      { conversationId, isTyping },
      MQTT_QOS.command,
    );
  }

  setPresence(isOnline: boolean): Promise<void> {
    return this.publish("presence.set", COMMAND_TOPICS.presenceSet, { isOnline }, MQTT_QOS.command);
  }
}
