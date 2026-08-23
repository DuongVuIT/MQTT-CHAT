#!/usr/bin/env node
/**
 * Two-client E2E listener: acts as `duong` over MQTT while a browser session
 * acts as `alice`. Subscribes to canonical events and asserts the full action
 * matrix: message.created / edited / deleted / reaction.added / typing / receipt.
 *
 * Usage: node scripts/two-client-listener.mjs <timeoutSeconds>
 * Exit 0 = all expected events observed; exit 1 = missing events.
 */
import { createRequire } from "node:module";

const mqtt = createRequire(new URL("../packages/mqtt/src/index.ts", import.meta.url))("mqtt");
// Mirrors SUBSCRIPTION_PATTERNS.allEvents from @mqtt-chat/mqtt-contracts.
const ALL_EVENTS = "chat/v1/events/#";
// Receipts are delivered on per-user topics (chat/v1/users/{id}/events/...),
// which allEvents does NOT cover — subscribe to duong's user-events too.
const USER_EVENTS = "chat/v1/users/duong/events/#";

const timeoutMs = Number(process.argv[2] ?? 120) * 1000;
const seen = new Set();
const EXPECTED = [
  "message.created",
  "message.edited",
  "message.deleted",
  "reaction.added",
  "typing.started",
  "receipt.read",
];

const client = mqtt.connect("mqtt://localhost:1883", {
  // Nonce suffix: duplicate clientIds cause EMQX takeover loops when more
  // than one listener instance is alive.
  clientId: `duong:web-e2e-listener:${process.pid}:${Date.now()}`,
  clean: true,
});
client.on("connect", () => {
  client.subscribe(ALL_EVENTS, { qos: 1 });
  client.subscribe(USER_EVENTS, { qos: 1 });
  console.log("LISTENER-READY");
});
client.on("message", (_topic, payload) => {
  try {
    const ev = JSON.parse(payload.toString());
    if (ev?.eventType) {
      seen.add(ev.eventType);
      console.log(`EVENT ${ev.eventType}`);
    }
  } catch {
    /* ignore */
  }
});

const timer = setInterval(() => {
  const missing = EXPECTED.filter((e) => !seen.has(e));
  if (missing.length === 0) {
    console.log("ALL-EVENTS-RECEIVED");
    finish(0);
  }
}, 1000);

setTimeout(() => {
  const missing = EXPECTED.filter((e) => !seen.has(e));
  console.error(missing.length ? `MISSING: ${missing.join(",")}` : "unexpected-timeout");
  finish(1);
}, timeoutMs);

function finish(code) {
  clearInterval(timer);
  client.end(true);
  process.exit(code);
}
