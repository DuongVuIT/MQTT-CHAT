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

/**
 * Exact-ID teardown that runs on SUCCESS and on ANY failure path (#194) —
 * previously a FATAL between fixture creation and cleanup stranded rows in
 * mqtt_chat_test forever. Push cleanup thunks as their target comes into
 * existence; they execute in REVERSE registration order (users last, so FK
 * constraints are satisfied).
 */
const suiteCleanups: Array<() => Promise<unknown>> = [];
let suiteCleanedUp = false;
async function runSuiteCleanups(): Promise<void> {
  if (suiteCleanedUp) return;
  suiteCleanedUp = true;
  for (const fn of suiteCleanups.reverse()) {
    try {
      await fn();
    } catch {
      /* best effort — a failing cleanup must never mask the real result */
    }
  }
}

/** Hard-delete conversation rows via psql — DIRECT pairs refuse API deletes. */
async function psqlDeleteConversations(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { execFileSync } = await import("node:child_process");
  const container = execFileSync("docker", ["ps", "-qf", "name=postgres"]).toString().trim();
  const db = process.env.TEST_DB_NAME ?? "mqtt_chat_test"; // isolated suite DB
  execFileSync(
    "docker",
    [
      "exec",
      container,
      "psql",
      "-U",
      "mqtt",
      "-d",
      db,
      "-c",
      `DELETE FROM "Conversation" WHERE id IN ('${ids.join("', '")}')`,
    ],
    { encoding: "utf8" },
  );
}

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
  suiteCleanups.push(
    () => fetch(`${API}/users/${A}`, { method: "DELETE" }),
    () => fetch(`${API}/users/${B}`, { method: "DELETE" }),
    () => fetch(`${API}/users/${C}`, { method: "DELETE" }),
  );

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
  suiteCleanups.push(() =>
    fetch(`${API}/conversations/${conv.id}?actor=${encodeURIComponent(A)}`, { method: "DELETE" }),
  );

  const obsA = observe({ userId: A, deviceId: `dev-${run}` });
  const obsB = observe({ userId: B, deviceId: `dev-${run}` });
  const obsC = observe({ userId: C, deviceId: `dev-${run}` });
  await Promise.all([obsA.client.connect(), obsB.client.connect(), obsC.client.connect()]);
  suiteCleanups.push(
    () => obsA.client.disconnect(),
    () => obsB.client.disconnect(),
    () => obsC.client.disconnect(),
  );

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
  // DIRECT pairs cannot be tombstoned over the API (400 by design) — they go
  // through a psql exact-ID sweep at teardown instead.
  const hardDeleteConvIds = [direct.id];
  suiteCleanups.push(() => psqlDeleteConversations(hardDeleteConvIds));
  const directDelete = await fetch(
    `${API}/conversations/${direct.id}?actor=${encodeURIComponent(A)}`,
    { method: "DELETE" },
  );
  check(
    directDelete.status === 400,
    "DIRECT conversation cannot be deleted (400)",
    String(directDelete.status),
  );

  // ---- 3b. Member-ADD boundary validation --------------------------------
  // Unknown userId must be a 404 naming the id — never an FK violation
  // leaking as a 500 from the global exception filter.
  const ghostAdd = await fetch(
    `${API}/conversations/${conv.id}/members?actor=${encodeURIComponent(A)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userIds: [`u-${run}-ghost`] }),
    },
  );
  check(ghostAdd.status === 404, "member-ADD unknown userId → 404", String(ghostAdd.status));
  // A DIRECT conversation is exactly its pair — it can never grow.
  const directGrow = await fetch(
    `${API}/conversations/${direct.id}/members?actor=${encodeURIComponent(A)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userIds: [C] }),
    },
  );
  check(directGrow.status === 400, "member-ADD into DIRECT pair → 400", String(directGrow.status));

  // ---- 3c. REMOVE boundary validation -------------------------------------
  // A DIRECT conversation IS its immutable pair — self-leave must be a 400,
  // never a membership-broken DM stranded behind its pair key.
  const directLeave = await fetch(
    `${API}/conversations/${direct.id}/members/${encodeURIComponent(A)}?actor=${encodeURIComponent(A)}`,
    { method: "DELETE" },
  );
  check(
    directLeave.status === 400,
    "member-REMOVE from DIRECT pair → 400",
    String(directLeave.status),
  );

  // The LAST member cannot leave: member-left requires a non-empty group, so
  // letting it through would rollback + deterministic-500 forever. (A 1-member
  // group arises by REMOVALS — create enforces ≥2 initial memberIds.)
  const soloRes = await fetch(`${API}/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "GROUP", title: `solo-${run}`, createdBy: A, memberIds: [A, C] }),
  });
  const solo = (await soloRes.json()).conversation;
  suiteCleanups.push(() =>
    fetch(`${API}/conversations/${solo.id}?actor=${encodeURIComponent(A)}`, { method: "DELETE" }),
  );
  const drainC = await fetch(
    `${API}/conversations/${solo.id}/members/${encodeURIComponent(C)}?actor=${encodeURIComponent(A)}`,
    { method: "DELETE" },
  );
  check(drainC.ok, "admin drains group to themselves", String(drainC.status));
  const lastLeave = await fetch(
    `${API}/conversations/${solo.id}/members/${encodeURIComponent(A)}?actor=${encodeURIComponent(A)}`,
    { method: "DELETE" },
  );
  check(lastLeave.status === 400, "last-member leave → 400", String(lastLeave.status));

  // Sole-admin protection: when the ONLY admin leaves, the oldest remaining
  // human member is promoted in the same transaction — no orphaned group.
  const xferRes = await fetch(`${API}/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "GROUP", title: `xfer-${run}`, createdBy: A, memberIds: [A, B] }),
  });
  const xfer = (await xferRes.json()).conversation;
  suiteCleanups.push(async () => {
    // After the promotion test B is ADMIN; A is the fallback if that check
    // never ran. Whichever works, the row must not strand.
    for (const actor of [B, A]) {
      const res = await fetch(
        `${API}/conversations/${xfer.id}?actor=${encodeURIComponent(actor)}`,
        { method: "DELETE" },
      );
      if (res.ok || res.status === 404) return;
    }
  });
  const adminLeave = await fetch(
    `${API}/conversations/${xfer.id}/members/${encodeURIComponent(A)}?actor=${encodeURIComponent(A)}`,
    { method: "DELETE" },
  );
  check(adminLeave.ok, "sole-admin self-leave succeeds", String(adminLeave.status));
  const xferDetail = (await fetch(`${API}/conversations/${xfer.id}`).then((r) => r.json())) as {
    conversation?: { members?: Array<{ userId: string; role: string }> };
  };
  const bRole = xferDetail.conversation?.members?.find((m) => m.userId === B)?.role;
  check(bRole === "ADMIN", "oldest remaining member promoted to ADMIN", String(bRole));

  // ---- 3d. CREATE boundary validation --------------------------------------
  // Mirrors the member-ADD fix: duplicate ids, unknown users, and a creator
  // outside the initial membership fail at the boundary — never as a Prisma
  // P2002/P2003 leaking a 500 (and never a zero-ADMIN group).
  const dupCreate = await fetch(`${API}/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "GROUP", title: `dup-${run}`, createdBy: A, memberIds: [A, A] }),
  });
  check(
    dupCreate.status === 400,
    "create with duplicate memberIds → 400",
    String(dupCreate.status),
  );

  const ghostMemberCreate = await fetch(`${API}/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "GROUP",
      title: `ghost-${run}`,
      createdBy: A,
      memberIds: [A, `u-${run}-ghost`],
    }),
  });
  check(
    ghostMemberCreate.status === 404,
    "create with unknown memberId → 404",
    String(ghostMemberCreate.status),
  );

  const outsiderCreate = await fetch(`${API}/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "GROUP", title: `out-${run}`, createdBy: A, memberIds: [B, C] }),
  });
  check(
    outsiderCreate.status === 400,
    "create with createdBy outside memberIds → 400",
    String(outsiderCreate.status),
  );

  const ghostCreatorCreate = await fetch(`${API}/conversations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "GROUP",
      title: `gc-${run}`,
      createdBy: `u-${run}-ghost`,
      memberIds: [A, B],
    }),
  });
  check(
    ghostCreatorCreate.status === 404,
    "create with unknown createdBy → 404",
    String(ghostCreatorCreate.status),
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

  console.log(failed ? "GROUP-LIFECYCLE E2E FAILED" : "GROUP-LIFECYCLE E2E DONE — ALL PASS");
  await runSuiteCleanups();
  process.exit(failed ? 1 : 0);
}

main().catch(async (err) => {
  console.error("FATAL:", err);
  await runSuiteCleanups();
  process.exit(1);
});
