/**
 * Media upload E2E: presign → PUT to MinIO → complete.
 * Run from repo root:  node scripts/upload-e2e.mjs
 */
const API = process.env.API_URL ?? "http://localhost:3001";

const conversations = await fetch(`${API}/conversations`).then((r) => r.json());
const list = Array.isArray(conversations)
  ? conversations
  : (conversations.conversations ?? conversations.data ?? conversations.items);
const general = list.find((c) => c.title === "General") ?? list[0];

// Minimal valid PNG (1x1 transparent pixel).
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const presign = await fetch(`${API}/uploads/presign`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    conversationId: general.id,
    filename: "upload-e2e.png",
    contentType: "image/png",
    sizeBytes: PNG.length,
  }),
}).then((r) => r.json());

if (!presign.uploadUrl || !presign.key) {
  console.log("FAIL presign:", JSON.stringify(presign));
  process.exit(1);
}
console.log("PASS presign, key =", presign.key);

const put = await fetch(presign.uploadUrl, {
  method: "PUT",
  headers: { "content-type": "image/png" },
  body: PNG,
});
console.log(put.ok ? "PASS PUT to MinIO" : `FAIL PUT: ${put.status}`);
if (!put.ok) process.exit(1);

const complete = await fetch(`${API}/uploads/complete`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ conversationId: general.id, key: presign.key }),
});
const body = await complete.json();
console.log(
  complete.ok && body.ok
    ? "PASS complete (object verified in storage)"
    : `FAIL complete: ${complete.status} ${JSON.stringify(body)}`,
);

// Negative check: complete with a key that was never uploaded must fail.
const negative = await fetch(`${API}/uploads/complete`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    conversationId: general.id,
    key: "media/conv-general/never-uploaded.png",
  }),
});
console.log(
  negative.status === 404
    ? "PASS negative: unknown key rejected with 404"
    : `FAIL negative: ${negative.status}`,
);

process.exit(0);
