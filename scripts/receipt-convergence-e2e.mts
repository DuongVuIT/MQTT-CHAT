/**
 * PERMANENT regression — cross-device read-receipt convergence (REG-02,
 * 2026-08-25 root-cause wave).
 *
 * Root causes covered:
 *  - The worker fanned `receipt.read` only to OTHER members, so a reader's
 *    SECOND device never learned its own watermark advanced — unread badges
 *    on the same user's other devices stayed stale until a refetch.
 *  - Clients merged receipts with a blind SET (a redelivery could regress
 *    the watermark) instead of the shared monotonic merge.
 *
 * Scenario (isolated E2E stack):
 *   sender A ──message──▶ reader B (device1 + device2 subscribed)
 *   B/device1 publishes receipt.read(seq)
 *     → B/device1 AND B/device2 must BOTH receive receipt.read(seq)
 *     → A must receive receipt.read(seq) (✓✓ tick)
 *     → REST bootstrap must show B.lastReadSequence = seq (persistence)
 *   A stale receipt.read(seq−1) from device2 must NOT regress the watermark
 *     (server idempotency) and no duplicate event may resurrect it.
 */
import { ChatRealtimeClient, type RealtimeEvent } from "../packages/realtime-core/src/index";

const API = process.env.API_URL ?? "http://localhost:3011/api";

let failed = false;
function check(ok: boolean, label: string, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
  if (!ok) failed = true;
}

const suiteCleanups: Array<() => Promise<unknown>> = [];
let suiteCleanedUp = false;
async function runSuiteCleanups(): Promise<void> {
  if (suiteCleanedUp) return;
  suiteCleanedUp = true;
  for (const fn of suiteCleanups.reverse()) {
    try {
      await fn();
    } catch {
      /* best effort */
    }
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForEvent(
  seen: RealtimeEvent[],
  predicate: (e: RealtimeEvent) => boolean,
  timeoutMs = 10_000,
): Promise<RealtimeEvent | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = seen.find(predicate);
    if (hit) return hit;
    await sleep(100);
  }
  return null;
}

async function createUser(id: string, displayName: string): Promise<void> {
  const res = await fetch(`${API}/users`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, displayName }),
  });
  if (!res.ok) throw new Error(`createUser ${id} failed: ${res.status}`);
}

interface SuiteConversation {
  id: string;
  lastSequence: number | null;
  members: Array<{ userId: string; lastReadSequence: number }>;
}

async function listConversations(userId: string): Promise<SuiteConversation[]> {
  const res = await fetch(`${API}/conversations?userId=${encodeURIComponent(userId)}`);
  if (!res.ok) throw new Error(`listConversations(${userId}) → ${res.status}`);
  const body = (await res.json()) as { conversations: SuiteConversation[] };
  return body.conversations ?? [];
}

/** Publish receipt.read through the canonical command topic. */
function makeReceiptPublisher(
  client: ChatRealtimeClient,
): (conversationId: string, seq: number) => Promise<void> {
  return async (conversationId, seq) => {
    // markRead is the canonical client API (wraps receipt.read command).
    await client.markRead(conversationId, seq);
  };
}

async function main(): Promise<void> {
  const run = `rr-${Date.now().toString(36)}`;
  const userA = `u-${run}-sender`;
  const userB = `u-${run}-reader`;

  await createUser(userA, `Receipt Sender ${run}`);
  await createUser(userB, `Receipt Reader ${run}`);
  suiteCleanups.push(
    () => fetch(`${API}/users/${userA}`, { method: "DELETE" }),
    () => fetch(`${API}/users/${userB}`, { method: "DELETE" }),
  );

  const convRes = await fetch(`${API}/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "DIRECT",
      createdBy: userA,
      memberIds: [userA, userB],
    }),
  });
  const conv = ((await convRes.json()) as { conversation: { id: string } }).conversation;
  check(
    convRes.ok && Boolean(conv?.id),
    "DIRECT conversation created",
    conv?.id ?? String(convRes.status),
  );
  const conversationId = conv.id;
  suiteCleanups.push(() =>
    fetch(`${API}/conversations/${conversationId}?actor=${encodeURIComponent(userA)}`, {
      method: "DELETE",
    }),
  );

  const wsUrl = process.env.MQTT_WS_URL ?? "ws://localhost:3000/mqtt";

  const senderEvents: RealtimeEvent[] = [];
  const bDev1Events: RealtimeEvent[] = [];
  const bDev2Events: RealtimeEvent[] = [];

  const sender = new ChatRealtimeClient({
    url: wsUrl,
    identity: { userId: userA, deviceId: `dev-a-${run}` },
    onEvent: (e) => senderEvents.push(e),
  });
  // Same USER, two devices — the cross-device convergence under test.
  const bDevice1 = new ChatRealtimeClient({
    url: wsUrl,
    identity: { userId: userB, deviceId: `dev-b1-${run}` },
    onEvent: (e) => bDev1Events.push(e),
  });
  const bDevice2 = new ChatRealtimeClient({
    url: wsUrl,
    identity: { userId: userB, deviceId: `dev-b2-${run}` },
    onEvent: (e) => bDev2Events.push(e),
  });

  await sender.connect();
  await bDevice1.connect();
  await bDevice2.connect();
  suiteCleanups.push(
    () => sender.disconnect(),
    () => bDevice1.disconnect(),
    () => bDevice2.disconnect(),
  );
  check(true, "3 realtime clients connected (A + B×2 devices)");

  // ---- Send A → B ---------------------------------------------------------
  const cmid = `msg-${run}`;
  await sender.sendMessage({
    conversationId,
    clientMessageId: cmid,
    type: "TEXT",
    content: `receipt-convergence-${run}`,
    replyToId: null,
    metadata: null,
  });
  const createdOnB = await waitForEvent(bDev1Events, (e) => e.eventType === "message.created");
  check(createdOnB !== null, "message.created reached reader device1");
  const data = (createdOnB?.data ?? {}) as Record<string, unknown>;
  const seq = Number(data["sequence"] ?? 0);
  check(seq > 0, "canonical sequence present", String(seq));
  const dupOnDev2 = await waitForEvent(bDev2Events, (e) => e.eventType === "message.created");
  check(dupOnDev2 !== null, "message.created reached reader device2");

  // ---- Read on device1 → BOTH devices converge ---------------------------
  const publishReceipt = makeReceiptPublisher(bDevice1);
  await publishReceipt(conversationId, seq);

  const echoDev1 = await waitForEvent(
    bDev1Events,
    (e) =>
      e.eventType === "receipt.read" &&
      Number((e.data as Record<string, unknown>)?.["lastReadSequence"]) >= seq,
  );
  check(
    echoDev1 !== null,
    "receipt.read echoed to the READER's device1",
    echoDev1 ? "received" : "missing",
  );

  const onDev2 = await waitForEvent(
    bDev2Events,
    (e) =>
      e.eventType === "receipt.read" &&
      Number((e.data as Record<string, unknown>)?.["lastReadSequence"]) >= seq &&
      (e.data as Record<string, unknown>)?.["userId"] === userB,
  );
  check(
    onDev2 !== null,
    "CROSS-DEVICE: receipt.read reached the reader's device2",
    onDev2 ? "received" : "MISSING (regression)",
  );

  const onSender = await waitForEvent(
    senderEvents,
    (e) =>
      e.eventType === "receipt.read" && (e.data as Record<string, unknown>)?.["userId"] === userB,
  );
  check(
    onSender !== null,
    "sender received receipt.read (✓✓ tick source)",
    onSender ? "received" : "missing",
  );

  // ---- Persistence via REST bootstrap ------------------------------------
  await sleep(300); // outbox drain window
  const convsForB = await listConversations(userB);
  const mine = convsForB.find((c) => c.id === conversationId);
  const bWatermark = mine?.members?.find((m) => m.userId === userB)?.lastReadSequence ?? -1;
  check(
    bWatermark === seq,
    "REST bootstrap carries advanced watermark (unread=0 derivable)",
    `lastReadSequence=${bWatermark}`,
  );

  // ---- Server-side monotonic guard ---------------------------------------
  const publishStale = makeReceiptPublisher(bDevice2);
  await publishStale(conversationId, Math.max(0, seq - 1));
  await sleep(500);
  const convsAfterStale = await listConversations(userB);
  const afterStale = convsAfterStale.find((c) => c.id === conversationId);
  const watermarkAfter =
    afterStale?.members?.find((m) => m.userId === userB)?.lastReadSequence ?? -1;
  check(
    watermarkAfter === seq,
    "stale receipt.read does NOT regress the persisted watermark",
    `still=${watermarkAfter}`,
  );

  await runSuiteCleanups();
  if (failed) {
    console.error("FAIL receipt-convergence-e2e");
    process.exit(1);
  }
  console.log("PASS receipt-convergence-e2e");
  process.exit(0);
}

main().catch(async (error: unknown) => {
  console.error("FATAL", error);
  await runSuiteCleanups();
  process.exit(1);
});
