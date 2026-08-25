import { beforeEach, describe, expect, it } from "vitest";
import type { EventEnvelope } from "@mqtt-chat/mqtt-contracts";
import type { ApiConversation } from "@/lib/api";
import { applyCanonicalReadReceipt } from "@/lib/canonical-events";
import { useChatStore } from "@/store/chat-store";

const conversation: ApiConversation = {
  id: "conv-read",
  type: "DIRECT",
  title: null,
  memberCount: 2,
  lastSequence: 9,
  lastMessagePreview: "hello",
  lastMessageAt: "2026-08-25T00:00:00.000Z",
  members: [
    { userId: "duong", role: "MEMBER", lastReadSequence: 2 },
    { userId: "alice", role: "MEMBER", lastReadSequence: 2 },
  ],
};

function readEvent(sequence: number): EventEnvelope {
  return {
    eventId: `event-${sequence}`,
    eventType: "receipt.read",
    version: 1,
    timestamp: "2026-08-25T00:00:00.000Z",
    origin: { type: "user", id: "duong" },
    actor: { userId: "duong", deviceId: "other-tab" },
    conversationId: conversation.id,
    data: {
      conversationId: conversation.id,
      userId: "duong",
      lastReadSequence: sequence,
    },
  };
}

describe("web canonical receipt routing", () => {
  beforeEach(() => {
    useChatStore.setState({
      identity: { userId: "duong", deviceId: "this-tab" },
      conversations: [conversation],
    });
  });

  it("applies a self-user receipt emitted by another device", () => {
    applyCanonicalReadReceipt(readEvent(8));

    const ownMember = useChatStore
      .getState()
      .conversations[0]?.members.find((member) => member.userId === "duong");
    expect(ownMember?.lastReadSequence).toBe(8);
  });

  it("does not regress the watermark on an out-of-order self receipt", () => {
    applyCanonicalReadReceipt(readEvent(8));
    applyCanonicalReadReceipt(readEvent(4));

    const ownMember = useChatStore
      .getState()
      .conversations[0]?.members.find((member) => member.userId === "duong");
    expect(ownMember?.lastReadSequence).toBe(8);
  });
});
