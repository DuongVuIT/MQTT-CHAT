import { describe, expect, it, beforeEach } from "vitest";
import { useChatStore } from "./chat-store";
import type { ApiConversation, ApiMessage } from "../lib/api";

/**
 * Regression tests for the client-side message state machine:
 * optimistic add → reconcile by clientMessageId → timeout → failed → retry.
 * Guarantees: no message stays "pending" forever, retries are idempotent,
 * and no duplicate bubbles are created.
 */

const sampleMessage = (id: string, cmid: string): ApiMessage => ({
  id,
  clientMessageId: cmid,
  conversationId: "conv-general",
  senderId: "duong",
  senderType: "USER",
  senderName: "duong",
  sequence: 1,
  type: "TEXT",
  content: "hello",
  replyToId: null,
  metadata: null,
  reactions: [],
  createdAt: new Date().toISOString(),
  editedAt: null,
  deletedAt: null,
});

describe("chat-store message lifecycle", () => {
  beforeEach(() => {
    useChatStore.setState({
      pendingMessages: [],
      messagesByConversation: {},
    });
  });

  it("optimistic pending is added then reconciled (removed) by clientMessageId", () => {
    const s = useChatStore.getState();
    s.addPending({
      clientMessageId: "cmid-1",
      conversationId: "conv-general",
      content: "hello",
      replyToId: null,
      status: "pending",
    });
    expect(useChatStore.getState().pendingMessages).toHaveLength(1);

    // Canonical event arrives → resolve by clientMessageId.
    useChatStore.getState().resolvePending("cmid-1");
    expect(useChatStore.getState().pendingMessages).toHaveLength(0);
  });

  it("resolvePending with unknown id is a no-op (no crash)", () => {
    useChatStore.getState().resolvePending("does-not-exist");
    expect(useChatStore.getState().pendingMessages).toHaveLength(0);
  });

  it("markPendingFailed transitions pending → failed (never stuck Sending)", () => {
    useChatStore.getState().addPending({
      clientMessageId: "cmid-2",
      conversationId: "conv-general",
      content: "hi",
      replyToId: null,
      status: "pending",
    });
    useChatStore.getState().markPendingFailed("cmid-2");
    const [p] = useChatStore.getState().pendingMessages;
    expect(p!.status).toBe("failed");
  });

  it("retryPending returns failed → pending so it can be re-published", () => {
    useChatStore.getState().addPending({
      clientMessageId: "cmid-3",
      conversationId: "conv-general",
      content: "retry me",
      replyToId: null,
      status: "failed",
    });
    useChatStore.getState().retryPending("cmid-3");
    const [p] = useChatStore.getState().pendingMessages;
    expect(p!.status).toBe("pending");
  });

  it("canonical message upsert does not create duplicate bubbles", () => {
    const s = useChatStore.getState();
    s.upsertMessage(sampleMessage("m1", "cmid-x"));
    s.upsertMessage(sampleMessage("m1", "cmid-x")); // duplicate delivery (QoS1)
    const list = useChatStore.getState().messagesByConversation["conv-general"];
    expect(list!).toHaveLength(1);
  });

  it("upsert keeps messages sorted by sequence regardless of arrival order", () => {
    const s = useChatStore.getState();
    s.upsertMessage({ ...sampleMessage("m2", "c2"), sequence: 2 });
    s.upsertMessage({ ...sampleMessage("m1", "c1"), sequence: 1 });
    const list = useChatStore.getState().messagesByConversation["conv-general"];
    expect(list!.map((m) => m.sequence)).toEqual([1, 2]);
  });
});

describe("conversation list realtime convergence (P0-A/P0-B)", () => {
  const baseConversation: ApiConversation = {
    id: "conv-general",
    type: "GROUP",
    title: "General",
    memberCount: 2,
    lastSequence: 5,
    lastMessagePreview: "old",
    lastMessageAt: "2026-01-01T00:00:00.000Z",
    members: [
      { userId: "duong", role: "ADMIN", lastReadSequence: 5 },
      { userId: "alice", role: "MEMBER", lastReadSequence: 5 },
    ],
  };

  beforeEach(() => {
    useChatStore.setState({ conversations: [baseConversation] });
  });

  it("applyMessageActivity advances lastSequence/preview/time (sequence convergence)", () => {
    useChatStore.getState().applyMessageActivity("conv-general", {
      sequence: 6,
      preview: "new message",
      at: "2026-01-02T00:00:00.000Z",
    });
    const conv = useChatStore.getState().conversations[0]!;
    expect(conv.lastSequence).toBe(6);
    expect(conv.lastMessagePreview).toBe("new message");
    expect(conv.lastMessageAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it("applyMessageActivity never regresses lastSequence (duplicate/out-of-order events)", () => {
    useChatStore.getState().applyMessageActivity("conv-general", {
      sequence: 6,
      preview: "newer",
      at: "2026-01-02T00:00:00.000Z",
    });
    // QoS1 duplicate or stale event with sequence 5 must not roll back state.
    useChatStore.getState().applyMessageActivity("conv-general", {
      sequence: 5,
      preview: "older",
      at: "2026-01-01T00:00:00.000Z",
    });
    const conv = useChatStore.getState().conversations[0]!;
    expect(conv.lastSequence).toBe(6);
    expect(conv.lastMessagePreview).toBe("newer");
  });

  it("upsertConversation inserts a canonical conversation.created payload", () => {
    const created: ApiConversation = {
      id: "conv-new",
      type: "GROUP",
      title: "Design",
      memberCount: 2,
      lastSequence: 0,
      lastMessagePreview: null,
      lastMessageAt: null,
      members: [
        { userId: "duong", role: "ADMIN", lastReadSequence: 0 },
        { userId: "alice", role: "MEMBER", lastReadSequence: 0 },
      ],
    };
    useChatStore.getState().upsertConversation(created);
    const conversations = useChatStore.getState().conversations;
    expect(conversations).toHaveLength(2);
    expect(conversations.find((c) => c.id === "conv-new")?.title).toBe("Design");
  });

  it("upsertConversation replaces an existing conversation (no duplicates)", () => {
    const updated: ApiConversation = { ...baseConversation, lastSequence: 9 };
    useChatStore.getState().upsertConversation(updated);
    const conversations = useChatStore.getState().conversations;
    expect(conversations).toHaveLength(1);
    expect(conversations[0]!.lastSequence).toBe(9);
  });
});

describe("malformed conversation payload regression (Bug #9)", () => {
  beforeEach(() => {
    useChatStore.setState({ conversations: [] });
  });

  it("applyReadReceipt does not crash when a conversation is missing members", () => {
    // Simulate a stale/incomplete API payload where `members` is absent.
    const incomplete = {
      id: "conv-broken",
      type: "DIRECT",
      title: null,
      memberCount: 2,
      lastSequence: 0,
      lastMessagePreview: null,
      lastMessageAt: null,
      members: undefined,
    } as unknown as ApiConversation;
    useChatStore.getState().setConversations([incomplete]);

    expect(() => {
      useChatStore.getState().applyReadReceipt("conv-broken", "alice", 5);
    }).not.toThrow();
    // Conversation survives untouched (no members to update).
    expect(useChatStore.getState().conversations).toHaveLength(1);
  });

  it("applyReadReceipt updates the watermark for well-formed conversations", () => {
    const complete: ApiConversation = {
      id: "conv-ok",
      type: "DIRECT",
      title: null,
      memberCount: 2,
      lastSequence: 3,
      lastMessagePreview: null,
      lastMessageAt: null,
      members: [
        { userId: "duong", role: "ADMIN", lastReadSequence: 1 },
        { userId: "alice", role: "MEMBER", lastReadSequence: 1 },
      ],
    };
    useChatStore.getState().setConversations([complete]);
    useChatStore.getState().applyReadReceipt("conv-ok", "alice", 3);
    const conv = useChatStore.getState().conversations[0]!;
    expect(conv.members.find((m) => m.userId === "alice")?.lastReadSequence).toBe(3);
    expect(conv.members.find((m) => m.userId === "duong")?.lastReadSequence).toBe(1);
  });

  it("applyReadReceipt for unknown conversation is a no-op (no crash)", () => {
    useChatStore.getState().setConversations([]);
    expect(() => {
      useChatStore.getState().applyReadReceipt("does-not-exist", "alice", 9);
    }).not.toThrow();
  });
});

describe("chat-store identity switch + normalized state", () => {
  beforeEach(() => {
    useChatStore.setState({
      identity: null,
      users: [],
      conversations: [],
      activeConversationId: null,
      messagesByConversation: {},
      pendingMessages: [],
      typingUsers: {},
      presence: {},
      hasMoreHistory: {},
      loadingHistory: false,
      error: null,
    });
  });

  const conv = (id: string, seq = 0): ApiConversation => ({
    id,
    type: "GROUP",
    title: id,
    memberCount: 2,
    lastSequence: seq,
    lastMessagePreview: null,
    lastMessageAt: null,
    members: [
      { userId: "duong", role: "ADMIN", lastReadSequence: 0 },
      { userId: "alice", role: "MEMBER", lastReadSequence: 0 },
    ],
  });

  it("resetTransient drops ALL identity-scoped state (no leak across identities)", () => {
    useChatStore.getState().setIdentity({ userId: "duong", deviceId: "web-1" });
    useChatStore.getState().setConversations([conv("c1", 3)]);
    useChatStore.getState().addPending({
      clientMessageId: "cmid-x",
      conversationId: "c1",
      content: "hi",
      replyToId: null,
      status: "queued",
    });
    useChatStore.getState().setTyping("c1", "alice", true);
    useChatStore.getState().setPresence("alice", true);

    useChatStore.getState().resetTransient();

    const s = useChatStore.getState();
    expect(s.conversations).toEqual([]);
    expect(s.pendingMessages).toEqual([]);
    expect(s.typingUsers).toEqual({});
    expect(s.presence).toEqual({});
    expect(s.activeConversationId).toBeNull();
    // identity itself is NOT cleared by resetTransient
    expect(s.identity).toEqual({ userId: "duong", deviceId: "web-1" });
  });

  it("upsertConversation NEVER duplicates an entity (ONE id = ONE conversation)", () => {
    useChatStore.getState().upsertConversation(conv("c1"));
    useChatStore.getState().upsertConversation(conv("c2"));
    // Same id arrives twice (REST + realtime event) — must stay ONE entity.
    useChatStore.getState().upsertConversation({ ...conv("c1"), title: "updated" });

    const list = useChatStore.getState().conversations;
    expect(list).toHaveLength(2);
    expect(list.filter((c) => c.id === "c1")).toHaveLength(1);
    expect(list.find((c) => c.id === "c1")?.title).toBe("updated");
  });

  it("queued pending survives resetPending-style flows and retries to pending", () => {
    useChatStore.getState().addPending({
      clientMessageId: "cmid-q",
      conversationId: "c1",
      content: "offline msg",
      replyToId: null,
      status: "queued",
    });
    useChatStore.getState().retryPending("cmid-q");
    expect(useChatStore.getState().pendingMessages[0]?.status).toBe("pending");
    useChatStore.getState().markPendingFailed("cmid-q");
    expect(useChatStore.getState().pendingMessages[0]?.status).toBe("failed");
    useChatStore.getState().resolvePending("cmid-q");
    expect(useChatStore.getState().pendingMessages).toHaveLength(0);
  });
});

describe("chat-store reaction contract defense", () => {
  it("toggleReaction on a malformed message without reactions array does not crash", () => {
    useChatStore.setState({ messagesByConversation: {}, pendingMessages: [] });
    const malformed = {
      ...sampleMessage("m-bad", "cmid-bad"),
      reactions: undefined as unknown as ApiMessage["reactions"],
    };
    useChatStore.getState().upsertMessage(malformed);
    expect(() => {
      useChatStore.getState().toggleReaction("m-bad", "👍", "duong");
    }).not.toThrow();
    // After the toggle the invariant is restored: reactions is a valid array.
    const stored = useChatStore
      .getState()
      .messagesByConversation["conv-general"]?.find((m) => m.id === "m-bad");
    expect(Array.isArray(stored?.reactions)).toBe(true);
    expect(stored?.reactions).toEqual([{ emoji: "👍", userId: "duong" }]);
  });

  it("history + realtime merge keeps ONE canonical message with valid reactions", () => {
    useChatStore.setState({ messagesByConversation: {}, pendingMessages: [] });
    const row = { ...sampleMessage("m1", "c1"), conversationId: "conv-x" };
    // HTTP history row (reactions present)
    useChatStore.getState().setMessages("conv-x", [row], false);
    // Same message re-arrives via realtime (QoS1 duplicate) — still ONE entity
    useChatStore
      .getState()
      .upsertMessage({ ...row, reactions: [{ emoji: "❤️", userId: "alice" }] });
    const list = useChatStore.getState().messagesByConversation["conv-x"] ?? [];
    expect(list).toHaveLength(1);
    expect(list[0]!.reactions).toEqual([{ emoji: "❤️", userId: "alice" }]);
  });
});
