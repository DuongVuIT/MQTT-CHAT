/**
 * Notification-worker delivery E2E assertion.
 *
 * Flow: offline recipient + message.send command
 *   → chat-worker → DB → canonical message.created
 *   → notification-worker (shared subscription)
 *   → provider.send + Redis delivery audit (notify:delivered:{recipient}:{messageId}).
 *
 * Asserts the delivery audit key appears for the expected offline recipient.
 *
 * Run from repo root:  node scripts/notification-e2e.mjs
 * Requires: API :3001, EMQX :1883, Redis :6379, notification-worker running.
 */
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const workspaceRequire = new URL("../packages/redis/src/index.ts", import.meta.url);
const { Redis } = (() => {
  // Resolve ioredis through the workspace package that declares it (pnpm strict layout).
  const ioredis = createRequire(workspaceRequire)("ioredis");
  return { Redis: ioredis.Redis ?? ioredis.default ?? ioredis };
})();

const API = process.env.API_URL ?? "http://localhost:3001";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

// Recipient must be OFFLINE (no MQTT connection) for a push to fire.
const RECIPIENT = process.env.NOTIFY_RECIPIENT ?? "john";
const SENDER = "duong";

const conversations = await fetch(`${API}/conversations`).then((r) => r.json());
const list = Array.isArray(conversations)
  ? conversations
  : (conversations.conversations ?? conversations.data ?? conversations.items);
if (!list?.length) {
  console.error("FAIL: no conversations found");
  process.exit(1);
}
// Prefer a conversation that includes both sender and recipient.
const general =
  list.find(
    (c) =>
      (c.members ?? []).some((m) => m.userId === SENDER) &&
      (c.members ?? []).some((m) => m.userId === RECIPIENT),
  ) ?? list[0];
console.log("conversation:", general.id, general.title);

// Sanity: recipient must be offline right now.
const presenceRes = await fetch(`${API}/presence?userIds=${RECIPIENT}`).then((r) => r.json());
const info = presenceRes.presence?.[RECIPIENT];
if (info?.online) {
  console.error(
    `FAIL precondition: ${RECIPIENT} is ONLINE (connectionCount=${info.connectionCount}) — ` +
      `notification-worker only pushes to offline recipients`,
  );
  process.exit(1);
}
console.log(`precondition OK: ${RECIPIENT} offline`);

const mqtt = createRequire(new URL("../packages/mqtt/src/index.ts", import.meta.url))("mqtt");
const client = mqtt.connect(process.env.MQTT_URL ?? "mqtt://localhost:1883", {
  clientId: `${SENDER}:notify-e2e-${Date.now()}`,
  clean: true,
});
await new Promise((res, rej) => {
  client.once("connect", res);
  client.once("error", rej);
});

const received = [];
client.subscribe("chat/v1/events/#", { qos: 1 });
client.on("message", (_topic, payload) => {
  try {
    received.push(JSON.parse(payload.toString()));
  } catch {
    /* ignore non-json */
  }
});

const preview = `notify-e2e-${randomUUID().slice(0, 8)}`;
const cmid = randomUUID();
await new Promise((res, rej) =>
  client.publish(
    "chat/v1/commands/message/send",
    JSON.stringify({
      requestId: randomUUID(),
      commandType: "message.send",
      version: 1,
      timestamp: new Date().toISOString(),
      actor: { userId: SENDER, deviceId: "notify-e2e" },
      clientMessageId: cmid,
      data: {
        conversationId: general.id,
        clientMessageId: cmid,
        type: "TEXT",
        content: preview,
        replyToId: null,
        metadata: null,
      },
    }),
    { qos: 1 },
    (err) => (err ? rej(err) : res()),
  ),
);

async function waitFor(pred, label, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = received.find(pred);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`TIMEOUT waiting for ${label}`);
}

const created = await waitFor(
  (e) => e.eventType === "message.created" && e.data?.clientMessageId === cmid,
  "message.created",
);
const messageId = String(created.data.messageId);
console.log("canonical message.created received, messageId =", messageId);

// Poll Redis for the delivery audit key written by notification-worker.
const redis = new Redis(REDIS_URL, { lazyConnect: true });
await redis.connect();
const auditKey = `notify:delivered:${RECIPIENT}:${messageId}`;

let delivered = null;
const deadline = Date.now() + 15_000;
while (Date.now() < deadline && !delivered) {
  const raw = await redis.get(auditKey);
  if (raw) delivered = JSON.parse(raw);
  else await new Promise((r) => setTimeout(r, 500));
}

await redis.quit().catch(() => redis.disconnect());
client.end(true);

if (delivered && delivered.preview === preview && delivered.provider === "console") {
  console.log(
    `PASS notification: push delivered to offline ${RECIPIENT} via ${delivered.provider} (audit matched)`,
  );
  process.exit(0);
}
console.error(`FAIL notification: no delivery audit at ${auditKey} within timeout`);
process.exit(1);
