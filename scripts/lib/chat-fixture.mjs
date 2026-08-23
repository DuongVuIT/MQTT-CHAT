/**
 * Test fixture lifecycle for E2E suites.
 *
 * Guarantees (PROJECT_STATUS §32):
 *  - every entity is created with a run-scoped runtime id (`fx<runId>…`),
 *    never derived from demo identities or display names;
 *  - cleanup deletes EXACTLY the ids this fixture created — no
 *    `WHERE name LIKE 'E2E%'` sweeps on a shared database;
 *  - cleanup runs in `finally`, so failed assertions still clean up.
 */

const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * @typedef {{ id: string, displayName: string }} FixtureUser
 * @typedef {{ runId: string, users: FixtureUser[], conversationId: string | null, cleanup: () => Promise<void> }} ChatFixture
 */

/** @param {string} kind @param {string} [suffix] */
export function fixtureId(kind, suffix = "") {
  return `fx${RUN_ID}${kind}${suffix}`.slice(0, 64);
}

/**
 * Create a self-cleaning chat fixture.
 *
 * @param {string} api REST base (e.g. http://localhost:3011/api)
 * @param {{ users?: number, userIds?: string[], type?: "DIRECT"|"GROUP", title?: string }} [opts]
 * @returns {Promise<ChatFixture>}
 */
export async function createChatFixture(api, opts = {}) {
  const createdUsers = [];
  const n = opts.users ?? 0;

  for (let i = 0; i < n; i++) {
    const id = fixtureId(`u${i}`);
    await fetch(`${api}/users`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, displayName: `Fixture User ${i} (${RUN_ID})` }),
    }).then(async (r) => {
      if (!r.ok) throw new Error(`fixture user create failed: ${r.status}`);
      return r.json();
    });
    createdUsers.push(id);
  }

  let conversationId = null;
  if (opts.type) {
    const memberIds = [...createdUsers, ...(opts.userIds ?? [])];
    const res = await fetch(`${api}/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: opts.type,
        title: opts.title,
        createdBy: memberIds[0],
        memberIds,
      }),
    });
    const body = await res.json();
    if (!res.ok || !body.conversation?.id) {
      throw new Error(`fixture conversation create failed: ${res.status}`);
    }
    conversationId = body.conversation.id;
  }

  const conversationIds = conversationId ? [conversationId] : [];

  return {
    runId: RUN_ID,
    users: createdUsers.map((id) => ({ id, displayName: id })),
    conversationId,
    /** Delete exactly what this fixture created. Idempotent + best effort. */
    cleanup: async () => {
      for (const cid of conversationIds) {
        await fetch(`${api}/conversations/${cid}`, { method: "DELETE" }).catch(() => {});
      }
      for (const uid of createdUsers) {
        await fetch(`${api}/users/${encodeURIComponent(uid)}`, { method: "DELETE" }).catch(
          () => {},
        );
      }
    },
  };
}
