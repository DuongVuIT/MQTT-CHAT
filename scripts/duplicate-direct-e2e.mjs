/**
 * Regression E2E for the duplicate-DIRECT-conversation bug.
 *
 * Creates two RUNTIME users (no hardcoded demo identities), then fires
 * CONCURRENT create requests for the same direct pair — including both
 * orderings (A→B and B→A) — and asserts:
 *   1. every response resolves to the SAME conversation id;
 *   2. the DB contains exactly ONE direct conversation for the pair.
 *
 * Run from repo root:  node scripts/duplicate-direct-e2e.mjs
 * (API on :3001 must be running.)
 */
const API = process.env.API_URL ?? "http://localhost:3001";

let failed = false;
function check(ok, label, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
  if (!ok) failed = true;
}

const suffix = Date.now();
const userA = { id: `e2e-ua-${suffix}`, displayName: `E2E User A ${suffix}` };
const userB = { id: `e2e-ub-${suffix}`, displayName: `E2E User B ${suffix}` };

for (const u of [userA, userB]) {
  const res = await fetch(`${API}/users`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(u),
  });
  check(res.ok, `runtime user created ${u.id}`);
}

// 8 concurrent creates: 4× A→B ordering, 4× B→A ordering.
const bodies = [0, 1, 2, 3].flatMap(() => [
  { type: "DIRECT", createdBy: userA.id, memberIds: [userA.id, userB.id] },
  { type: "DIRECT", createdBy: userB.id, memberIds: [userB.id, userA.id] },
]);
const results = await Promise.all(
  bodies.map((body) =>
    fetch(`${API}/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(async (r) => ({ status: r.status, json: await r.json() })),
  ),
);

const allOk = results.every(
  (r) => (r.status === 200 || r.status === 201) && r.json?.conversation?.id,
);
check(allOk, "all 8 concurrent creates succeeded", results.map((r) => r.status).join(","));
const ids = new Set(results.map((r) => r.json.conversation.id));
check(ids.size === 1, "all responses share ONE conversation id", [...ids].join(","));
const anyReused = results.some((r) => r.json.reused === true);
check(anyReused, "at least one request reported reused=true");

// DB authority: exactly one DIRECT row for this pair (psql — scripts are not
// a workspace package, so workspace deps are not resolvable here).
const { execFileSync } = await import("node:child_process");
const container = execFileSync("docker", ["ps", "-qf", "name=postgres"]).toString().trim();
const pairKey = [userA.id, userB.id].sort().join(":");
const sql = `SELECT c.id, c."directPairKey" FROM "Conversation" c
JOIN "ConversationMember" m ON m."conversationId" = c.id
WHERE c.type = 'DIRECT' AND c."directPairKey" = '${pairKey}'
GROUP BY c.id, c."directPairKey" HAVING COUNT(*) = 2;`;
const out = execFileSync(
  "docker",
  ["exec", "-i", container, "psql", "-U", "mqtt", "-d", "mqtt_chat", "-t", "-A", "-c", sql],
  { encoding: "utf8" },
);
const rows = out
  .trim()
  .split("\n")
  .filter((l) => l.length > 0);
check(
  rows.length === 1,
  "DB has exactly ONE direct conversation for the pair",
  `found ${rows.length}`,
);
check(rows[0]?.endsWith(pairKey), "directPairKey persisted canonically", rows[0]);

console.log(failed ? "DUPLICATE-DIRECT E2E FAILED" : "DUPLICATE-DIRECT E2E DONE");
process.exit(failed ? 1 : 0);
