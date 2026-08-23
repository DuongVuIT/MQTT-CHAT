/**
 * Media upload E2E — SINGLE ORIGIN flow.
 *   POST /api/uploads (multipart) → durable storageKey
 *   GET  /api/media?key=<key>     → streams bytes back with correct Content-Type
 * Run from repo root:  node scripts/upload-e2e.mjs
 */
const API = process.env.API_URL ?? "http://localhost:3001/api";

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

// 1) Same-origin multipart upload through the API (no presigned URL involved).
const form = new FormData();
form.append("conversationId", general.id);
form.append("file", new Blob([PNG], { type: "image/png" }), "upload-e2e.png");
const uploaded = await fetch(`${API}/uploads`, { method: "POST", body: form });
const uploadBody = await uploaded.json();
if (!uploaded.ok || !uploadBody.key) {
  console.log("FAIL upload:", JSON.stringify(uploadBody));
  process.exit(1);
}
const key = uploadBody.key;
console.log("PASS upload, key =", key);

// 2) Public media path streams the object back byte-perfect.
const mediaRes = await fetch(`${API.replace(/\/api$/, "")}/media?key=${encodeURIComponent(key)}`);
if (!mediaRes.ok) {
  console.log(`FAIL media GET: ${mediaRes.status}`);
  process.exit(1);
}
if (mediaRes.headers.get("content-type") !== "image/png") {
  console.log(`FAIL content-type: ${mediaRes.headers.get("content-type")}`);
  process.exit(1);
}
const bytes = Buffer.from(await mediaRes.arrayBuffer());
console.log(
  bytes.equals(PNG)
    ? "PASS media stream (content-type image/png, byte round-trip)"
    : "FAIL media bytes differ",
);
if (!bytes.equals(PNG)) process.exit(1);

// 3) Negative checks: invalid key shape → 404; unsupported type → rejected.
const negativeMedia = await fetch(
  `${API.replace(/\/api$/, "")}/media?key=${encodeURIComponent("../../etc/passwd")}`,
);
console.log(
  negativeMedia.status === 404 || negativeMedia.status === 400
    ? "PASS negative: traversal-shaped key rejected"
    : `FAIL negative key accepted: ${negativeMedia.status}`,
);

const badForm = new FormData();
badForm.append("conversationId", general.id);
badForm.append("file", new Blob([Buffer.from("hello")], { type: "text/plain" }), "note.txt");
const badType = await fetch(`${API}/uploads`, { method: "POST", body: badForm });
console.log(
  badType.status === 400
    ? "PASS negative: unsupported content type rejected"
    : `FAIL unsupported type accepted: ${badType.status}`,
);

process.exit(0);
