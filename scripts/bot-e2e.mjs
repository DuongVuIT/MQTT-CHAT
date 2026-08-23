/**
 * Bot E2E verification (manual/dev tooling).
 * Covers: built-in commands (/help /status /users /stats), rule
 * enable/disable via admin API, loop protection (bot replies never trigger
 * further bot replies).
 *
 * Run from repo root:  node scripts/bot-e2e.mjs
 */
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const mqtt = createRequire(new URL("../packages/mqtt/src/index.ts", import.meta.url))("mqtt");

const API = process.env.API_URL ?? "http://localhost:3001";
const MQTT_URL = process.env.MQTT_URL ?? "mqtt://localhost:1883";

const conversations = await fetch(`${API}/conversations`).then((r) => r.json());
const list = Array.isArray(conversations)
  ? conversations
  : (conversations.conversations ?? conversations.data ?? conversations.items);
const general = list.find((c) => c.title === "General") ?? list[0];

const client = mqtt.connect(MQTT_URL, { clientId: `duong:bote2e-${Date.now()}`, clean: true });
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
    /* ignore */
  }
});

function publishCommand(topic, envelope) {
  return new Promise((res, rej) =>
    client.publish(topic, JSON.stringify(envelope), { qos: 1 }, (err) => (err ? rej(err) : res())),
  );
}

async function sendAsUser(content) {
  const cmid = randomUUID();
  await publishCommand("chat/v1/commands/message/send", {
    requestId: randomUUID(),
    commandType: "message.send",
    version: 1,
    timestamp: new Date().toISOString(),
    actor: { userId: "duong", deviceId: "bote2e" },
    clientMessageId: cmid,
    data: {
      conversationId: general.id,
      clientMessageId: cmid,
      type: "TEXT",
      content,
      replyToId: null,
      metadata: null,
    },
  });
  return cmid;
}

let failures = 0;
async function check(label, fn) {
  try {
    await fn();
    console.log(`PASS ${label}`);
  } catch (error) {
    failures++;
    console.log(`FAIL ${label}: ${error.message}`);
  }
}

// ---- Built-in commands ----
for (const cmd of ["/help", "/status", "/users", "/stats"]) {
  await check(`bot command ${cmd}`, async () => {
    const before = received.length;
    await sendAsUser(cmd);
    const start = Date.now();
    while (Date.now() - start < 20_000) {
      const reply = received
        .slice(before)
        .find((e) => e.eventType === "message.created" && e.origin?.type === "bot");
      if (reply && typeof reply.data?.content === "string" && reply.data.content.length > 0) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error("no bot reply");
  });
}

// ---- Loop protection: exactly ONE bot reply per user command ----
await check("loop protection: single bot reply per command", async () => {
  const before = received.length;
  await sendAsUser("/ping");
  await new Promise((r) => setTimeout(r, 8_000));
  const replies = received
    .slice(before)
    .filter((e) => e.eventType === "message.created" && e.origin?.type === "bot");
  if (replies.length !== 1) {
    throw new Error(`expected exactly 1 bot reply, got ${replies.length}`);
  }
});

// ---- Rule enable/disable via admin API ----
const { bots } = await fetch(`${API}/bots`).then((r) => r.json());
const systemBot = bots.find((b) => b.name.toLowerCase().includes("system")) ?? bots[0];
if (!systemBot) {
  console.log("SKIP rules toggle: no bot found");
} else {
  const { rules } = await fetch(`${API}/bots/${systemBot.id}/rules`).then((r) => r.json());
  const pingRule =
    rules.find(
      (r) =>
        JSON.stringify(r.trigger).toLowerCase().includes("ping") ||
        r.name.toLowerCase().includes("ping"),
    ) ?? rules[0];
  if (!pingRule) {
    console.log("SKIP rules toggle: no rule found");
  } else {
    // Disable (rule engine caches rules for 5s — wait out the refresh window)
    await fetch(`${API}/bots/${systemBot.id}/rules/${pingRule.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    }).then((r) => r.json());
    await new Promise((r) => setTimeout(r, 6_000));

    await check("rule disabled: no bot reply to trigger", async () => {
      const before = received.length;
      await sendAsUser("/ping");
      await new Promise((r) => setTimeout(r, 7_000));
      const replies = received
        .slice(before)
        .filter((e) => e.eventType === "message.created" && e.origin?.type === "bot");
      if (replies.length !== 0) throw new Error(`bot still replied ${replies.length}x`);
    });

    // Re-enable (same cache-refresh consideration)
    await fetch(`${API}/bots/${systemBot.id}/rules/${pingRule.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    }).then((r) => r.json());
    await new Promise((r) => setTimeout(r, 6_000));

    await check("rule re-enabled: bot replies again", async () => {
      const before = received.length;
      await sendAsUser("/ping");
      const start = Date.now();
      while (Date.now() - start < 20_000) {
        const reply = received
          .slice(before)
          .find((e) => e.eventType === "message.created" && e.origin?.type === "bot");
        if (reply) return;
        await new Promise((r) => setTimeout(r, 200));
      }
      throw new Error("no bot reply after re-enable");
    });
  }
}

// ---- Bot logs recorded ----
await check("bot logs recorded", async () => {
  const logs = await fetch(`${API}/bots/${systemBot?.id ?? ""}/logs`).then((r) => r.json());
  const total =
    (logs.events?.length ?? 0) + (logs.commands?.length ?? 0) + (logs.executions?.length ?? 0);
  if (total === 0) throw new Error("all log tables empty");
});

client.end(true);
console.log(failures === 0 ? "BOT-E2E DONE: ALL PASS" : `BOT-E2E DONE: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
