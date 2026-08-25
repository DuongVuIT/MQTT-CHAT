import {
  MessageLifecycleStore,
  type PendingMessage,
} from "@app/features/messaging/message-lifecycle";
import type { ApiMessage } from "@app/lib/api";

const msg = (id: string, cmid: string, seq: number): ApiMessage => ({
  id,
  clientMessageId: cmid,
  conversationId: "conv-1",
  senderId: "duong",
  senderType: "USER",
  senderName: "duong",
  sequence: seq,
  type: "TEXT",
  content: "hello",
  replyToId: null,
  metadata: null,
  reactions: [],
  createdAt: new Date().toISOString(),
  editedAt: null,
  deletedAt: null,
});

describe("mobile message lifecycle", () => {
  const stores: MessageLifecycleStore[] = [];
  const makeStore = (
    send: (p: PendingMessage) => Promise<void>,
    timeoutMs?: number,
    isConnected?: () => boolean,
  ): MessageLifecycleStore => {
    const s = new MessageLifecycleStore(send, timeoutMs, isConnected);
    stores.push(s);
    return s;
  };
  afterEach(() => {
    for (const s of stores) s.dispose();
    stores.length = 0;
  });

  it("optimistic send → reconcile by clientMessageId removes pending", async () => {
    const sent: string[] = [];
    const store = makeStore(async (p) => {
      sent.push(p.clientMessageId);
    }, 50);
    await store.send({
      clientMessageId: "c1",
      conversationId: "conv-1",
      content: "hi",
      replyToId: null,
    });
    expect(store.getPending("conv-1")).toHaveLength(1);
    store.reconcile("c1", msg("m1", "c1", 1));
    expect(store.getPending("conv-1")).toHaveLength(0);
    expect(store.getMessages("conv-1")).toHaveLength(1);
    expect(sent).toEqual(["c1"]);
  });

  it("timeout marks pending failed (never stuck Sending)", async () => {
    jest.useFakeTimers();
    const store = makeStore(async () => {}, 50);
    await store.send({
      clientMessageId: "c2",
      conversationId: "conv-1",
      content: "hi",
      replyToId: null,
    });
    jest.advanceTimersByTime(60);
    expect(store.getPending("conv-1")[0]?.status).toBe("failed");
    jest.useRealTimers();
  });

  it("retry re-publishes the SAME clientMessageId", async () => {
    const sent: string[] = [];
    let fail = true;
    const store = makeStore(async (p) => {
      if (fail) throw new Error("publish failed");
      sent.push(p.clientMessageId);
    }, 5_000);
    await store.send({
      clientMessageId: "c3",
      conversationId: "conv-1",
      content: "hi",
      replyToId: null,
    });
    expect(store.getPending("conv-1")[0]?.status).toBe("failed");
    fail = false;
    await store.retry("c3");
    expect(sent).toEqual(["c3"]);
    expect(store.getPending("conv-1")[0]?.status).toBe("pending");
  });

  it("duplicate canonical events do not create duplicate bubbles", () => {
    const store = makeStore(async () => {});
    store.reconcile("cx", msg("m9", "cx", 3));
    store.reconcile("cx", msg("m9", "cx", 3));
    expect(store.getMessages("conv-1")).toHaveLength(1);
  });

  // Regression: MQTT disconnected send must QUEUE (never throw uncaught
  // "MQTT not connected", never immediately fail) and flush on reconnect.
  it("send while disconnected → queued; flushQueued publishes; reconcile clears", async () => {
    let connected = false;
    const sent: string[] = [];
    const store = makeStore(
      async (p) => {
        sent.push(p.clientMessageId);
      },
      5_000,
      () => connected,
    );
    await store.send({
      clientMessageId: "cq1",
      conversationId: "conv-1",
      content: "offline hi",
      replyToId: null,
    });
    expect(sent).toEqual([]); // nothing published while offline
    expect(store.getPending("conv-1")[0]?.status).toBe("queued");

    connected = true;
    await store.flushQueued();
    expect(sent).toEqual(["cq1"]); // published once on reconnect
    expect(store.getPending("conv-1")[0]?.status).toBe("pending");

    store.reconcile("cq1", msg("m10", "cq1", 7));
    expect(store.getPending("conv-1")).toHaveLength(0);
  });

  it("flush publish failure marks failed (retryable), no unhandled rejection", async () => {
    let connected = false;
    let fail = true;
    const store = makeStore(
      async () => {
        if (fail) throw new Error("publish failed");
      },
      5_000,
      () => connected,
    );
    await store.send({
      clientMessageId: "cq2",
      conversationId: "conv-1",
      content: "hi",
      replyToId: null,
    });
    connected = true;
    await store.flushQueued();
    expect(store.getPending("conv-1")[0]?.status).toBe("failed");
    fail = false;
    await store.retry("cq2");
    expect(store.getPending("conv-1")[0]?.status).toBe("pending");
  });

  it("queued message is bounded by the timeout (no forever-queued)", async () => {
    jest.useFakeTimers();
    const store = makeStore(
      async () => {},
      50,
      () => false,
    );
    await store.send({
      clientMessageId: "cq3",
      conversationId: "conv-1",
      content: "hi",
      replyToId: null,
    });
    jest.advanceTimersByTime(60);
    expect(store.getPending("conv-1")[0]?.status).toBe("failed");
    jest.useRealTimers();
  });
});
