/**
 * PERMANENT regression — media MIME normalization + reply lifecycle
 * (PROJECT_STATUS P0 MEDIA_MIME_NORMALIZATION / JPG_UPLOAD_MOBILE /
 * REPLY_SEND / REPLY_ACK / REPLY_RECONCILIATION; repair-log #26, #27).
 *
 * Isolated E2E stack suite (scripts/test-stack.mjs, tsx):
 *   1. MEDIA: upload real fixture bytes — PNG, JPEG, and the iOS alias
 *      `image/jpg` — the API must NORMALIZE the alias and accept it;
 *      unsupported types (heic) are rejected deterministically 4xx.
 *      Uploaded JPG bytes round-trip byte-perfect through /media.
 *   2. REPLY: base message → canonical ack; REPLY with valid target →
 *      canonical ack preserving replyToId; history carries the relation.
 *   3. REPLY TARGET VALIDATION: invalid target → authority emits canonical
 *      `message.rejected` → deterministic failure (no 10s timeout wait).
 *   4. Cleanup: exact IDs deleted; DB left with zero suite rows.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ChatRealtimeClient, type RealtimeEvent } from "../packages/realtime-core/src/index";

const API = process.env.API_URL ?? "http://localhost:3011/api";
const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));

let failed = false;
function check(ok: boolean, label: string, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
  if (!ok) failed = true;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function createUser(id: string, displayName: string): Promise<void> {
  const res = await fetch(`${API}/users`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, displayName }),
  });
  if (!res.ok) throw new Error(`createUser ${id} failed: ${res.status}`);
}

async function main(): Promise<void> {
  const run = `mr-${Date.now().toString(36)}`;
  const userA = `u-${run}-a`;
  const userB = `u-${run}-b`;
  await createUser(userA, `Media Reply A ${run}`);
  await createUser(userB, `Media Reply B ${run}`);

  const convRes = await fetch(`${API}/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "GROUP",
      title: `media-reply-${run}`,
      createdBy: userA,
      memberIds: [userA, userB],
    }),
  });
  const conv = ((await convRes.json()) as { conversation: { id: string } }).conversation;
  check(convRes.ok && Boolean(conv?.id), "group created", conv?.id ?? String(convRes.status));
  const conversationId = conv.id;

  // ---- 1. MEDIA MIME ------------------------------------------------------
  /** Upload a REAL fixture file with the given declared MIME. */
  async function upload(
    name: string,
    type: string,
    fixture: string,
  ): Promise<{ status: number; body: { key?: string; filename?: string; mimeType?: string } }> {
    const form = new FormData();
    form.append("conversationId", conversationId);
    const bytes = readFileSync(FIXTURES + fixture);
    form.append("file", new Blob([bytes], { type }), name);
    const res = await fetch(`${API}/uploads`, { method: "POST", body: form });
    return { status: res.status, body: (await res.json()) as Record<string, string> };
  }

  const png = await upload("pixel.png", "image/png", "pixel.png");
  check(
    png.status === 201 && png.body.mimeType === "image/png",
    "PNG accepted",
    String(png.status),
  );

  const jpeg = await upload("pixel.jpg", "image/jpeg", "pixel.jpg");
  check(
    jpeg.status === 201 && jpeg.body.mimeType === "image/jpeg",
    "image/jpeg accepted",
    String(jpeg.status),
  );

  // THE regression (#26): iOS reports JPEG as image/jpg. Must be normalized,
  // accepted, and persisted under the CANONICAL type — never rejected.
  const jpgAlias = await upload("photo.jpg", "image/jpg", "pixel.jpg");
  check(
    jpgAlias.status === 201 && jpgAlias.body.mimeType === "image/jpeg",
    "image/jpg ALIAS normalized → accepted as image/jpeg",
    `${jpgAlias.status} ${String(jpgAlias.body.mimeType)}`,
  );

  const heic = await upload("photo.heic", "image/heic", "pixel.jpg");
  check(
    heic.status >= 400 && heic.status < 500,
    "HEIC deterministically rejected",
    String(heic.status),
  );

  // Alias-uploaded bytes round-trip through the media stream.
  if (jpgAlias.body.key) {
    const mediaRes = await fetch(`${API}/media?key=${encodeURIComponent(jpgAlias.body.key)}`);
    const bytes = Buffer.from(await mediaRes.arrayBuffer());
    check(
      mediaRes.ok && bytes.equals(readFileSync(FIXTURES + "pixel.jpg")),
      "JPG bytes round-trip intact",
      `${mediaRes.status} ${bytes.length}b`,
    );
    check(
      String(mediaRes.headers.get("content-type")).startsWith("image/jpeg"),
      "media content-type canonical",
      String(mediaRes.headers.get("content-type")),
    );
  }

  // ---- 2. REPLY LIFECYCLE -------------------------------------------------
  const events: RealtimeEvent[] = [];
  let ackedRejected: RealtimeEvent | null = null;
  const sender = new ChatRealtimeClient({
    url: process.env.MQTT_WS_URL ?? "ws://localhost:3000/mqtt",
    identity: { userId: userA, deviceId: `e2e-${run}` },
    onEvent: (e) => {
      events.push(e);
      if (e.eventType === "message.rejected") ackedRejected = e;
    },
  });
  await sender.connect();

  const baseCmid = `base-${run}`;
  await sender.sendMessage({
    conversationId,
    clientMessageId: baseCmid,
    type: "TEXT",
    content: `reply-base-${run}`,
    replyToId: null,
    metadata: null,
  });
  let baseAck: RealtimeEvent | null = null;
  for (let i = 0; i < 50 && !baseAck; i++) {
    await sleep(200);
    baseAck =
      events.find(
        (e) => e.eventType === "message.created" && e.data?.["clientMessageId"] === baseCmid,
      ) ?? null;
  }
  check(Boolean(baseAck), "base message canonical acked");
  const baseId = String(baseAck?.data?.["messageId"] ?? "");

  const replyCmid = `reply-${run}`;
  await sender.sendMessage({
    conversationId,
    clientMessageId: replyCmid,
    type: "TEXT",
    content: `reply-child-${run}`,
    replyToId: baseId,
    metadata: null,
  });
  let replyAck: RealtimeEvent | null = null;
  for (let i = 0; i < 50 && !replyAck; i++) {
    await sleep(200);
    replyAck =
      events.find(
        (e) => e.eventType === "message.created" && e.data?.["clientMessageId"] === replyCmid,
      ) ?? null;
  }
  check(Boolean(replyAck), "REPLY canonical acked (never stuck Sending)");
  check(replyAck?.data?.["replyToId"] === baseId, "canonical event preserves replyToId");

  // History carries the relation (reload-safe).
  const history = (await fetch(`${API}/conversations/${conversationId}/messages`).then((r) =>
    r.json(),
  )) as {
    messages: Array<{ clientMessageId: string; replyToId: string | null }>;
  };
  const childRow = history.messages.find((m) => m.clientMessageId === replyCmid);
  check(childRow?.replyToId === baseId, "history preserves reply relation after reload");

  // ---- 3. INVALID TARGET → DETERMINISTIC FAILURE --------------------------
  const badCmid = `badreply-${run}`;
  await sender.sendMessage({
    conversationId,
    clientMessageId: badCmid,
    type: "TEXT",
    content: "bad reply target",
    replyToId: "msg-does-not-exist",
    metadata: null,
  });
  const started = Date.now();
  for (let i = 0; i < 50 && !ackedRejected; i++) {
    await sleep(100);
  }
  const rejectLatencyMs = Date.now() - started;
  check(
    Boolean(ackedRejected) &&
      (ackedRejected as RealtimeEvent | null)?.data?.["clientMessageId"] === badCmid,
    "invalid target → canonical message.rejected received",
    `${rejectLatencyMs}ms`,
  );
  check(
    rejectLatencyMs < 5_000,
    "rejection is FAST (deterministic, not a timeout)",
    `${rejectLatencyMs}ms`,
  );
  check(
    !events.some(
      (e) => e.eventType === "message.created" && e.data?.["clientMessageId"] === badCmid,
    ),
    "rejected message never created",
  );

  await sender.disconnect();

  // ---- 4. Cleanup exact IDs ----------------------------------------------
  await fetch(`${API}/conversations/${conversationId}?actor=${encodeURIComponent(userA)}`, {
    method: "DELETE",
  });
  await fetch(`${API}/users/${userA}`, { method: "DELETE" });
  await fetch(`${API}/users/${userB}`, { method: "DELETE" });

  console.log(failed ? "MEDIA-REPLY E2E FAILED" : "MEDIA-REPLY E2E DONE — ALL PASS");
  process.exit(failed ? 1 : 0);
}

void main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
