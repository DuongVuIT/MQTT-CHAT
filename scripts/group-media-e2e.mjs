/**
 * Regression E2E for P0-B (realtime group creation) and P0-C (image media).
 *
 * P0-B: POST /conversations must emit a canonical conversation.created event
 *       (transactional outbox → chat-worker relay → EMQX) that subscribers
 *       receive WITHOUT any page refresh.
 * P0-C: multipart upload via /api/uploads (same origin, no presigned URL) →
 *       IMAGE message with a durable storageKey → GET /media?key=… must
 *       stream the object with HTTP 200 + image/* content type.
 *
 * Run from repo root:  node scripts/group-media-e2e.mjs
 * (API on :3001, EMQX on :1883, MinIO per docker-compose must be running.)
 */
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

// Resolve `mqtt` through the workspace package that declares it (pnpm strict layout).
const mqtt = createRequire(new URL("../packages/mqtt/src/index.ts", import.meta.url))("mqtt");

const API = process.env.API_URL ?? "http://localhost:3001/api";
const MQTT_URL = process.env.MQTT_URL ?? "mqtt://localhost:1883";
const NS = process.env.MQTT_TOPIC_NAMESPACE ?? "chat/v1"; // env-fenced E2E namespace

let failed = false;
function check(ok, label, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
  if (!ok) failed = true;
}

// ---- Connect an observer client (simulates Alice's browser session) ----
const client = mqtt.connect(MQTT_URL, { clientId: `alice:e2e-${Date.now()}`, clean: true });
await new Promise((res, rej) => {
  client.once("connect", res);
  client.once("error", rej);
});
const received = [];
client.subscribe(`${NS}/events/#`, { qos: 1 });
client.on("message", (_topic, payload) => {
  try {
    received.push(JSON.parse(payload.toString()));
  } catch {
    /* ignore non-json */
  }
});

async function waitFor(pred, label, timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = received.find(pred);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`TIMEOUT waiting for ${label}`);
}

// ---- P0-B: group creation is realtime ----
const groupName = `e2e-group-${Date.now()}`;
const createRes = await fetch(`${API}/conversations`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    type: "GROUP",
    title: groupName,
    createdBy: "duong",
    memberIds: ["duong", "alice"],
  }),
});
const createBody = await createRes.json();
const conversation = createBody.conversation;
check(createRes.ok && conversation?.id, "group created via HTTP", conversation?.id);

const createdEvent = await waitFor(
  (e) => e.eventType === "conversation.created" && e.data?.id === conversation.id,
  "conversation.created event",
);
const eventValid =
  Array.isArray(createdEvent.data.members) &&
  createdEvent.data.members.some((m) => m.userId === "alice") &&
  createdEvent.data.title === groupName;
check(
  eventValid,
  "conversation.created received realtime with full contract",
  JSON.stringify(createdEvent.data.members),
);

// ---- P0-C: single-origin image upload + resolvable media URL ----
// 1x1 transparent PNG (real, decodable image bytes).
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

// Same-origin multipart upload — exactly what the browser Composer does.
const form = new FormData();
form.append("conversationId", conversation.id);
form.append("file", new Blob([png], { type: "image/png" }), "pixel.png");
const uploadRes = await fetch(`${API}/uploads`, { method: "POST", body: form });
const uploadBody = await uploadRes.json();
const { key } = uploadBody;
check(uploadRes.ok && typeof key === "string", "upload via /api/uploads", key);

// Send the IMAGE message with a durable storageKey (canonical client flow).
const cmid = randomUUID();
await new Promise((res, rej) =>
  client.publish(
    `${NS}/commands/message/send`,
    JSON.stringify({
      requestId: randomUUID(),
      commandType: "message.send",
      version: 1,
      timestamp: new Date().toISOString(),
      actor: { userId: "duong", deviceId: "e2e" },
      clientMessageId: cmid,
      data: {
        conversationId: conversation.id,
        clientMessageId: cmid,
        type: "IMAGE",
        content: "",
        replyToId: null,
        metadata: {
          storageKey: key,
          filename: "pixel.png",
          mimeType: "image/png",
          size: png.length,
        },
      },
    }),
    { qos: 1 },
    (err) => (err ? rej(err) : res()),
  ),
);
const msgEvent = await waitFor(
  (e) => e.eventType === "message.created" && e.data?.clientMessageId === cmid,
  "image message.created event",
);
check(
  msgEvent.data.type === "IMAGE" && msgEvent.data.metadata?.storageKey === key,
  "canonical event preserves IMAGE type + storageKey",
);

// The URL a client resolves: <origin>/media?key=… — served by the API at
// /api/media directly, and by the public gateway's /media rewrite in dev
// (the gateway-level path is proven separately by upload-e2e against :3000).
const PUBLIC_MEDIA_BASE = process.env.PUBLIC_ORIGIN ?? `${API}/media`;
const mediaUrl = `${PUBLIC_MEDIA_BASE}?key=${encodeURIComponent(key)}`;
const objectRes = await fetch(mediaUrl);
const contentType = objectRes.headers.get("content-type") ?? "";
check(
  objectRes.status === 200 && contentType.startsWith("image/"),
  "media GET = 200 with image/* content-type",
  `${objectRes.status} ${contentType}`,
);
const bytes = Buffer.from(await objectRes.arrayBuffer());
check(bytes.equals(png), "media bytes round-trip intact");

// Invalid keys must be rejected (endpoint is not a bucket-wide URL minter).
const evilRes = await fetch(`${PUBLIC_MEDIA_BASE}?key=${encodeURIComponent("../../etc")}`);
check(
  evilRes.status === 404 || evilRes.status === 400,
  "invalid media key rejected",
  `status ${evilRes.status}`,
);

client.end(true);
console.log(failed ? "GROUP/MEDIA E2E FAILED" : "GROUP/MEDIA E2E DONE");
process.exit(failed ? 1 : 0);
