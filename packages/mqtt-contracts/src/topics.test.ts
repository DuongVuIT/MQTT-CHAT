import { describe, expect, it } from "vitest";
import { COMMAND_TOPICS, EVENT_TOPICS, userEventTopic, userEventsWildcardTopic } from "./topics";
import { eventEnvelopeSchema as EventEnvelopeSchema } from "./envelope";
import { sendMessageCommandSchema as SendMessageCommandSchema } from "./commands";

describe("topic constants", () => {
  it("exposes canonical command topics", () => {
    expect(COMMAND_TOPICS.messageSend).toBe("chat/v1/commands/message/send");
    expect(COMMAND_TOPICS.receiptRead).toBe("chat/v1/commands/receipt/read");
  });

  it("exposes canonical event topics", () => {
    expect(EVENT_TOPICS.messageCreated).toBe("chat/v1/events/message/created");
    expect(EVENT_TOPICS.presenceOnline).toBe("chat/v1/events/presence/online");
  });

  it("exposes canonical topic constants", () => {
    expect(COMMAND_TOPICS.messageSend).toBe("chat/v1/commands/message/send");
    expect(EVENT_TOPICS.messageCreated).toBe("chat/v1/events/message/created");
  });

  it("builds per-user event topics", () => {
    expect(userEventTopic("duong", "receipt/read")).toBe("chat/v1/users/duong/events/receipt/read");
    expect(userEventTopic("bob", "receipt/delivered")).toBe(
      "chat/v1/users/bob/events/receipt/delivered",
    );
  });

  it("client wildcard subscriptions match every published event topic (regression)", () => {
    // Regression: the web client previously subscribed to per-conversation
    // wildcard topics while chat-worker publishes on flat per-event-type
    // topics, so no events ever reached the UI. This locks both sides.
    const isCovered = (topic: string, patterns: string[]): boolean =>
      patterns.some((pattern) => {
        const prefix = pattern.replace(/\/#$/, "");
        return topic === prefix || topic.startsWith(`${prefix}/`);
      });

    // 1) Conversation-scoped events: chat-worker publishes on the flat
    //    per-event-type topic; the web client subscribes with "/#" wildcards.
    for (const key of [
      "messageCreated",
      "messageEdited",
      "messageDeleted",
      "reactionAdded",
      "reactionRemoved",
    ] as const) {
      expect(isCovered(EVENT_TOPICS[key], [`${EVENT_TOPICS[key]}/#`])).toBe(true);
    }

    // 2) Global ephemeral events: published on the flat topic itself and
    //    subscribed with a trailing "/#" wildcard.
    for (const key of [
      "typingStarted",
      "typingStopped",
      "presenceOnline",
      "presenceOffline",
    ] as const) {
      expect(isCovered(EVENT_TOPICS[key], [`${EVENT_TOPICS[key]}/#`])).toBe(true);
    }

    // 3) Per-user targeted events (receipts): covered by the user wildcard.
    expect(
      isCovered(userEventTopic("duong", "receipt/read"), [userEventsWildcardTopic("duong")]),
    ).toBe(true);
    expect(
      isCovered(userEventTopic("duong", "receipt/delivered"), [userEventsWildcardTopic("duong")]),
    ).toBe(true);
  });

  it("builds a per-user events wildcard that matches every per-user event topic", () => {
    const wildcard = userEventsWildcardTopic("duong");
    expect(wildcard).toBe("chat/v1/users/duong/events/#");
    // MQTT semantics: "a/b/#" matches the parent level itself and any child.
    const parent = wildcard.replace("/#", "");
    expect(parent).toBe("chat/v1/users/duong/events");
    expect(userEventTopic("duong", "receipt/read").startsWith(`${parent}/`)).toBe(true);
    expect(userEventTopic("duong", "receipt/delivered").startsWith(`${parent}/`)).toBe(true);
  });
});

describe("EventEnvelopeSchema", () => {
  const valid = {
    eventId: "evt-1",
    eventType: "message.created",
    version: 1,
    timestamp: new Date().toISOString(),
    actor: { userId: "duong", deviceId: "web-01" },
    conversationId: "conv-1",
    origin: { type: "user" },
    data: { messageId: "m1" },
  };

  it("accepts a valid envelope", () => {
    expect(() => EventEnvelopeSchema.parse(valid)).not.toThrow();
  });

  it("rejects missing eventType", () => {
    const { eventType: _eventType, ...rest } = valid;
    expect(EventEnvelopeSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects invalid origin type", () => {
    expect(EventEnvelopeSchema.safeParse({ ...valid, origin: { type: "alien" } }).success).toBe(
      false,
    );
  });
});

describe("SendMessageCommandSchema", () => {
  it("accepts a valid text message command", () => {
    expect(
      SendMessageCommandSchema.safeParse({
        conversationId: "conv-1",
        clientMessageId: "cmid-1",
        content: "hello",
        type: "TEXT",
        replyToId: null,
        metadata: null,
      }).success,
    ).toBe(true);
  });

  it("rejects empty content for TEXT type", () => {
    expect(
      SendMessageCommandSchema.safeParse({
        conversationId: "conv-1",
        clientMessageId: "cmid-1",
        content: "",
        type: "TEXT",
      }).success,
    ).toBe(false);
  });

  it("rejects missing clientMessageId (idempotency key)", () => {
    expect(
      SendMessageCommandSchema.safeParse({
        conversationId: "conv-1",
        content: "hi",
        type: "TEXT",
      }).success,
    ).toBe(false);
  });
});
