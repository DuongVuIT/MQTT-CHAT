/**
 * End-to-end smoke test (manual/dev tooling).
 * Flow A: user command -> chat-worker -> DB -> canonical event -> subscriber.
 * Flow G: bot command -> bot response through chat-worker.
 *
 * Run from repo root:  node scripts/smoke.mjs
 * (mqtt resolves from the workspace; API must be running on :3001.)
 */
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

// Resolve `mqtt` through the workspace package that declares it (pnpm strict layout).
const mqtt = createRequire(new URL("../packages/mqtt/src/index.ts", import.meta.url))("mqtt");

const API = process.env.API_URL ?? "http://localhost:3001";
const MQTT_URL = process.env.MQTT_URL ?? "mqtt://localhost:1883";

const conversations = await fetch(`${API}/conversations`).then((r) => r.json());
const list = Array.isArray(conversations)
  ? conversations
  : (conversations.conversations ?? conversations.data ?? conversations.items);
if (!list?.length) {
  console.error("FAIL: no conversations found");
  process.exit(1);
}
const general = list.find((c) => c.title === "General") ?? list[0];
console.log("conversation:", general.id, general.title);

const client = mqtt.connect(MQTT_URL, { clientId: `duong:smoke-${Date.now()}`, clean: true });
await new Promise((res, rej) => {
  client.once("connect", res);
  client.once("error", rej);
});
console.log("mqtt connected");

const received = [];
client.subscribe("chat/v1/events/#", { qos: 1 });
client.on("message", (_topic, payload) => {
  try {
    received.push(JSON.parse(payload.toString()));
  } catch {
    /* ignore non-json */
  }
});

function publishCommand(topic, envelope) {
  return new Promise((res, rej) =>
    client.publish(topic, JSON.stringify(envelope), { qos: 1 }, (err) => (err ? rej(err) : res())),
  );
}

async function waitFor(pred, label, timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = received.find(pred);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`TIMEOUT waiting for ${label}`);
}

// ---- Flow A: plain message ----
const cmid = randomUUID();
await publishCommand("chat/v1/commands/message/send", {
  requestId: randomUUID(),
  commandType: "message.send",
  version: 1,
  timestamp: new Date().toISOString(),
  actor: { userId: "duong", deviceId: "smoke" },
  clientMessageId: cmid,
  data: {
    conversationId: general.id,
    clientMessageId: cmid,
    type: "TEXT",
    content: "hello from smoke",
    replyToId: null,
    metadata: null,
  },
});
const created = await waitFor(
  (e) => e.eventType === "message.created" && e.data?.clientMessageId === cmid,
  "message.created",
);
console.log("PASS flow A: message.created sequence =", created.data.sequence);

// ---- Dedup check: same clientMessageId again ----
await publishCommand("chat/v1/commands/message/send", {
  requestId: randomUUID(),
  commandType: "message.send",
  version: 1,
  timestamp: new Date().toISOString(),
  actor: { userId: "duong", deviceId: "smoke" },
  clientMessageId: cmid,
  data: {
    conversationId: general.id,
    clientMessageId: cmid,
    type: "TEXT",
    content: "hello from smoke",
    replyToId: null,
    metadata: null,
  },
});
await new Promise((r) => setTimeout(r, 2500));
const dupes = received.filter(
  (e) => e.eventType === "message.created" && e.data?.clientMessageId === cmid,
);
console.log(
  dupes.length === 1 ? "PASS dedup: single canonical event" : `WARN dedup: ${dupes.length} events`,
);

// ---- Flow G: bot /ping ----
const pingCmid = randomUUID();
await publishCommand("chat/v1/commands/message/send", {
  requestId: randomUUID(),
  commandType: "message.send",
  version: 1,
  timestamp: new Date().toISOString(),
  actor: { userId: "duong", deviceId: "smoke" },
  clientMessageId: pingCmid,
  data: {
    conversationId: general.id,
    clientMessageId: pingCmid,
    type: "TEXT",
    content: "/ping",
    replyToId: null,
    metadata: null,
  },
});
const pong = await waitFor(
  (e) =>
    e.eventType === "message.created" &&
    e.origin?.type === "bot" &&
    typeof e.data?.content === "string" &&
    e.data.content.toLowerCase().includes("pong"),
  "bot pong",
  20_000,
);
console.log("PASS flow G: bot replied:", pong.data.content);

// ---- History via HTTP ----
const history = await fetch(`${API}/conversations/${general.id}/messages?limit=50`).then((r) =>
  r.json(),
);
const items = history.messages ?? history.data ?? history.items ?? history;
const hasSmoke = JSON.stringify(items).includes("hello from smoke");
const hasPong = JSON.stringify(items).includes(pong.data.content.slice(0, 10));
console.log(hasSmoke && hasPong ? "PASS history: messages persisted & queryable" : "FAIL history");

// Regression: reused DIRECT conversation MUST include members (Sidebar reads
// c.members — a payload without it crashed the whole chat page).
const reuse = await fetch(`${API}/conversations`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ type: "DIRECT", createdBy: "duong", memberIds: ["duong", "bob"] }),
}).then((r) => r.json());
const membersOk =
  Array.isArray(reuse.conversation?.members) && reuse.conversation.members.length >= 2;
console.log(
  membersOk
    ? "PASS contract: reused conversation includes members"
    : "FAIL contract: reused conversation missing members",
);

client.end(true);
console.log("SMOKE DONE");
process.exit(membersOk ? 0 : 1);
