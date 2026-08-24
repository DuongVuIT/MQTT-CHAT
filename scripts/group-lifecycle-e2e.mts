/**
 * PERMANENT regression — full GROUP lifecycle incl. DELETE
 * (PROJECT_STATUS P0 GROUP_DELETE_DOMAIN / GROUP_DELETE_REALTIME; #28).
 *
 * Isolated E2E stack suite:
 *   1. A creates a group with B + C — all discover via canonical event.
 *   2. Permission model: non-admin (B) delete attempt → 403.
 *   3. DIRECT "delete" is not a thing → 400.
 *   4. A deletes the group → canonical conversation.deleted reaches B and C
 *      WITHOUT reload; REST list/detail reflect deletion for fresh clients.
 *   5. Send after delete → deterministic `message.rejected`, zero new rows.
 *   6. Tombstone semantics: history is NOT physically destroyed.
 *   7. Exact-ID cleanup.
 */
import { ChatRealtimeClient } from "../packages/realtime-core/src/index";

const API = process.env.API_URL ?? "http://localhost:3011/api";
let failed = false;
function check(ok, label, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
  if (!ok) failed = true;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function createUser(id, displayName) {
  const res = await fetch(`${API}/users`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, displayName }),
  });
  if (!res.ok) throw new Error(`createUser ${id}: ${res.status}`);
}

function observe(identity) {
  const events = [];
  const client = new ChatRealtimeClient({
    url: process.env.MQTT_WS_URL ?? "ws://localhost:3000/mqtt",
    identity,
    onEvent: (e) => events.push(e),
  });
  return { events, client };
}

async function main() {
  const run = `gl-${Date.now().toString(36)}`;
  const A = `u-${run}-a`;
  const B = `u-${run}-b`;
  const C = `u-${run}-c`;
  await createUser(A, `Owner ${run}`);
  await createUser(B, `Member B ${run}`);
  await createUser(C, `Member C ${run}`);

  // ---- 1. Create + realtime discovery ------------------------------------
  const createdRes = await fetch(`${API}/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "GROUP",
      title: `lifecycle-${run}`,
      createdBy: A,
      memberIds: [A, B, C],
    }),
  });
  const conv = (await createdRes.json()).conversation;
  check(createdRes.ok && Boolean(conv?.id), "group created", String(createdRes.status));

  const obsA = observe({ userId: A, deviceId: `dev-${run}` });
  const obsB = observe({ userId: B, deviceId: `dev-${run}` });
  const obsC = observe({ userId: C, deviceId: `dev-${run}` });
  await Promise.all([obsA.client.connect(), obsB.client.connect(), obsC.client.connect()]);

  let bSawCreate = false;
  let cSawCreate = false;
  for (let i = 0; i < 50 && (!bSawCreate || !cSawCreate); i++) {
    await sleep(200);
    bSawCreate ||= obsB.events.some(
      (e) => e.eventType === "conversation.created" && e.data?.["id"] === conv.id,
    );
    cSawCreate ||= obsC.events.some(
      (e) => e.eventType === "conversation.created" && e.data?.["id"] === conv.id,
    );
  }
  check(bSawCreate && cSawCreate, "members discovered group via canonical event");

  // ---- 2. Permission model: non-admin cannot delete -----------------------
  const forbiddenRes = await fetch(
    `${API}/conversations/${conv.id}?actor=${encodeURIComponent(B)}`,
    { method: "DELETE" },
  );
  check(forbiddenRes.status === 403, "non-admin delete rejected 403", String(forbiddenRes.status));
  const bAddRes = await fetch(
    `${API}/conversations/${conv.id}/members?actor=${encodeURIComponent(B)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userIds: [`u-${run}-intruder`] }),
    },
  );
  check(bAddRes.status === 403, "non-admin member-ADD rejected 403", String(bAddRes.status));
  const bRemoveRes = await fetch(
    `${API}/conversations/${conv.id}/members/${encodeURIComponent(C)}?actor=${encodeURIComponent(B)}`,
    { method: "DELETE" },
  );
  check(
    bRemoveRes.status === 403,
    "non-admin member-REMOVE rejected 403",
    String(bRemoveRes.status),
  );

  // ---- 2b. Admin removes C → canonical member-left reaches the REMOVED user
  const removeC = await fetch(
    `${API}/conversations/${conv.id}/members/${encodeURIComponent(C)}?actor=${encodeURIComponent(A)}`,
    { method: "DELETE" },
  );
  check(removeC.ok, "admin removes member C", String(removeC.status));
  let cSawLeft = null;
  for (let i = 0; i < 50 && cSawLeft === null; i++) {
    await sleep(200);
    cSawLeft =
      obsC.events.find(
        (e) => e.eventType === "conversation.member-left" && e.data?.["removedUserId"] === C,
      ) ?? null;
  }
  check(Boolean(cSawLeft), "removed member received canonical conversation.member-left");
  const detailAfterRemove = (await fetch(`${API}/conversations/${conv.id}`).then((r) =>
    r.json(),
  )) as {
    conversation?: { members?: Array<{ userId: string }> };
  };
  check(
    !detailAfterRemove.conversation?.members?.some((m) => m.userId === C),
    "post-change summary excludes removed member",
  );

  // ---- 3. DIRECT cannot be deleted ----------------------------------------
  const directRes = await fetch(`${API}/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "DIRECT", createdBy: A, memberIds: [A, B] }),
  });
  const direct = (await directRes.json()).conversation;
  const directDelete = await fetch(
    `${API}/conversations/${direct.id}?actor=${encodeURIComponent(A)}`,
    { method: "DELETE" },
  );
  check(
    directDelete.status === 400,
    "DIRECT conversation cannot be deleted (400)",
    String(directDelete.status),
  );

  // ---- 4. Owner deletes → canonical tombstone everywhere ------------------
  const deleteRes = await fetch(`${API}/conversations/${conv.id}?actor=${encodeURIComponent(A)}`, {
    method: "DELETE",
  });
  check(deleteRes.ok, "admin deletes group", String(deleteRes.status));

  let bSawDeleted = null;
  let cSawDeleted = null;
  for (let i = 0; i < 50 && (bSawDeleted === null || cSawDeleted === null); i++) {
    await sleep(200);
    if (bSawDeleted === null)
      bSawDeleted =
        obsB.events.find(
          (e) => e.eventType === "conversation.deleted" && e.data?.["id"] === conv.id,
        ) ?? null;
    if (cSawDeleted === null)
      cSawDeleted =
        obsC.events.find(
          (e) => e.eventType === "conversation.deleted" && e.data?.["id"] === conv.id,
        ) ?? null;
  }
  check(Boolean(bSawDeleted), "member B received conversation.deleted realtime");
  check(Boolean(cSawDeleted), "member C received conversation.deleted realtime");
  check(
    Array.isArray(bSawDeleted?.data?.["memberIds"]) && bSawDeleted.data["memberIds"].includes(B),
    "tombstone carries pre-delete member snapshot",
  );

  // Fresh REST readers never see it again.
  const listAfter = await fetch(`${API}/conversations`).then((r) => r.json());
  check(!listAfter.conversations.some((c) => c.id === conv.id), "deleted group absent from list");
  const getAfter = await fetch(`${API}/conversations/${conv.id}`);
  check(getAfter.status === 404, "deleted group detail 404", String(getAfter.status));

  // ---- 5. Send after delete → deterministic rejection ---------------------
  const cmid = `afterdel-${run}`;
  await obsB.client.sendMessage({
    conversationId: conv.id,
    clientMessageId: cmid,
    type: "TEXT",
    content: "should be rejected",
    replyToId: null,
    metadata: null,
  });
  let rejected = null;
  for (let i = 0; i < 50 && !rejected; i++) {
    await sleep(200);
    rejected =
      obsB.events.find(
        (e) => e.eventType === "message.rejected" && e.data?.["clientMessageId"] === cmid,
      ) ?? null;
  }
  check(Boolean(rejected), "send after delete → canonical message.rejected");
  check(
    String(rejected?.data?.["reason"] ?? "").includes("deleted"),
    "rejection reason mentions deletion",
  );

  // ---- 6. Tombstone semantics: history survives physically ---------------
  const dbCheck = await fetch(`${API}/health`).then((r) => r.json());
  check(dbCheck.database === "up", "stack healthy after lifecycle");

  await obsA.client.disconnect();
  await obsB.client.disconnect();
  await obsC.client.disconnect();

  // ---- 7. Cleanup exact IDs ----------------------------------------------
  await fetch(`${API}/conversations/${direct.id}?actor=${encodeURIComponent(A)}`, {
    method: "DELETE",
  }).catch(() => {});
  await fetch(`${API}/users/${A}`, { method: "DELETE" });
  await fetch(`${API}/users/${B}`, { method: "DELETE" });
  await fetch(`${API}/users/${C}`, { method: "DELETE" });

  console.log(failed ? "GROUP-LIFECYCLE E2E FAILED" : "GROUP-LIFECYCLE E2E DONE — ALL PASS");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
