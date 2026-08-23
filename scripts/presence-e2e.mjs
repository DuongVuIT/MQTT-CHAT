/**
 * Multi-device presence + LWT E2E assertion.
 *
 * 1. Device A connects (duong:presA) with an MQTT will → presence.set offline.
 * 2. Device B connects (duong:presB) the same way.
 * 3. /presence must report ONLINE with connectionCount=2.
 * 4. A's socket is destroyed abruptly → LWT fires → count drops to 1,
 *    user MUST remain ONLINE (no false-offline regression).
 * 5. B is destroyed too → last connection gone → user OFFLINE.
 *
 * Run from repo root:  node scripts/presence-e2e.mjs
 * Requires: API :3001, EMQX :1883, chat-worker running.
 */
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const mqtt = createRequire(new URL("../packages/mqtt/src/index.ts", import.meta.url))("mqtt");

const API = process.env.API_URL ?? "http://localhost:3001";
const MQTT_URL = process.env.MQTT_URL ?? "mqtt://localhost:1883";
const USER = process.env.PRESENCE_USER ?? "duong";

function connectDevice(deviceId) {
  const willEnvelope = {
    requestId: randomUUID(),
    commandType: "presence.set",
    version: 1,
    timestamp: new Date().toISOString(),
    actor: { userId: USER, deviceId },
    data: { isOnline: false },
  };
  return new Promise((res, rej) => {
    const client = mqtt.connect(MQTT_URL, {
      clientId: `${USER}:${deviceId}-${Date.now()}`,
      clean: true,
      keepalive: 30,
      will: {
        topic: "chat/v1/commands/presence/set",
        payload: JSON.stringify(willEnvelope),
        qos: 1,
        retain: false,
      },
    });
    client.once("connect", () => res(client));
    client.once("error", rej);
  });
}

function publishPresence(client, deviceId, isOnline) {
  return new Promise((res, rej) =>
    client.publish(
      "chat/v1/commands/presence/set",
      JSON.stringify({
        requestId: randomUUID(),
        commandType: "presence.set",
        version: 1,
        timestamp: new Date().toISOString(),
        actor: { userId: USER, deviceId },
        data: { isOnline },
      }),
      { qos: 1 },
      (err) => (err ? rej(err) : res()),
    ),
  );
}

async function fetchPresence() {
  const res = await fetch(`${API}/presence?userIds=${USER}`).then((r) => r.json());
  return res.presence?.[USER] ?? { online: false, connectionCount: 0 };
}

async function waitFor(pred, label, timeoutMs = 15_000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await fetchPresence();
    if (pred(last)) return last;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`TIMEOUT waiting for ${label}; last=${JSON.stringify(last)}`);
}

// Baseline may be non-zero if other real sessions (e.g. an open browser tab)
// are connected — all assertions below are relative to this baseline.
const baseline = (await fetchPresence()).connectionCount;
console.log("baseline connectionCount =", baseline);

const a = await connectDevice("presA");
await publishPresence(a, "presA", true);
const b = await connectDevice("presB");
await publishPresence(b, "presB", true);

const twoDevices = await waitFor(
  (p) => p.online && p.connectionCount === baseline + 2,
  `two-device ONLINE (connectionCount=${baseline + 2})`,
);
console.log(`PASS multi-device: online=true connections=${twoDevices.connectionCount}`);

// Abrupt socket destroy on A → MQTT LWT must fire (no DISCONNECT sent).
a.stream.destroy();
const oneDevice = await waitFor(
  (p) => p.online && p.connectionCount === baseline + 1,
  "exactly one test connection removed after abrupt close (no false offline)",
);
console.log(`PASS no-false-offline: online=true connections=${oneDevice.connectionCount}`);

// Last test device lost → back to baseline.
b.stream.destroy();
const restored = await waitFor(
  (p) => p.connectionCount === baseline,
  "connectionCount restored to baseline after last test device lost (LWT/lease)",
  25_000,
);
console.log(
  `PASS lwt-cleanup: connections=${restored.connectionCount} (baseline=${baseline}, ` +
    `${baseline === 0 ? "user OFFLINE" : "other sessions still online"})`,
);

if (baseline === 0) {
  const p = await fetchPresence();
  if (p.online) throw new Error("FAIL: user reported ONLINE with zero connections");
  console.log("PASS offline: online=false with zero connections");
}

console.log("PRESENCE E2E DONE — ALL PASS");
process.exit(0);
