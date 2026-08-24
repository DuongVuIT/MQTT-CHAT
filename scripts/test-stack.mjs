#!/usr/bin/env node
/**
 * Isolated E2E stack orchestrator (PROJECT_STATUS §31).
 *
 *   dev  stack : api :3001 + workers → DATABASE mqtt_chat,      REDIS db 0
 *   test stack : api :3011 + workers → DATABASE mqtt_chat_test, REDIS db 1
 *
 * `pnpm test:e2e` runs the suites against the ISOLATED test stack so
 * automated runs never pollute development data. MQTT stays shared (the bus
 * is ephemeral); all durable state (Postgres/Redis) is separated.
 *
 * Usage:
 *   node scripts/test-stack.mjs            # boot test stack → run suites → teardown
 *   node scripts/test-stack.mjs --keep     # keep the test stack running after
 */
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const ROOT = new URL("..", import.meta.url).pathname;

// ---- Env immunity (#42): an operator shell often carries development
// credentials (DATABASE_URL/REDIS_URL from a sourced .env). The isolated
// stack must NEVER inherit them — every child gets explicit values below,
// so drop any inherited connection state before spawning anything.
for (const inherited of ["DATABASE_URL", "REDIS_URL", "MQTT_TOPIC_NAMESPACE"]) {
  delete process.env[inherited];
}

const TEST_DB =
  process.env.TEST_DATABASE_URL ??
  "postgresql://mqtt:mqtt@localhost:5432/mqtt_chat_test?schema=public";
const TEST_API_PORT = process.env.TEST_API_PORT ?? "3011";
const TEST_API = `http://localhost:${TEST_API_PORT}/api`;
const TEST_REDIS = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/1";
/** Topic-subtree fence: E2E traffic never mixes with a live dev broker. */
const TEST_NS = process.env.TEST_MQTT_NAMESPACE ?? "chat/v1-e2e";

// ---- Safety guard (#42): refuse configurations that would test against the
// DEVELOPMENT database. The whole point of the isolated stack is that
// automated suites can NEVER pollute (or be polluted by) dev data.
{
  const dbPath = (() => {
    try {
      return new URL(TEST_DB).pathname.replace(/^\//, "");
    } catch {
      return TEST_DB;
    }
  })();
  if (/mqtt_chat(\?|$|\/$)/.test(dbPath) && !dbPath.startsWith("mqtt_chat_test")) {
    console.error(
      `[test-stack] REFUSING to start: TEST_DATABASE_URL points at the development database (${dbPath}).\n` +
        `             Use the isolated mqtt_chat_test DB or override TEST_DATABASE_URL explicitly.`,
    );
    process.exit(1);
  }
  if (!TEST_DB.includes("mqtt_chat_test") && process.env.ALLOW_UNSAFE_TEST_DB !== "1") {
    console.error(
      `[test-stack] REFUSING to start: TEST_DATABASE_URL does not look like an isolated test DB (${dbPath}).\n` +
        `             Set ALLOW_UNSAFE_TEST_DB=1 only if you REALLY know what you are doing.`,
    );
    process.exit(1);
  }
}

const children = [];
/** Resolved when a service logs its readiness marker (workers → MQTT wired). */
const readyPromises = new Map();
let shuttingDown = false;

function run(cmd, args, { env = {}, readyMarker = null } = {}) {
  // detached:true makes each child a PROCESS-GROUP leader so teardown can
  // kill the whole tree. Historical bug (#25): killing only the direct
  // child left `pnpm → tsx watch` GRANDCHILDREN alive, silently holding
  // broker subscriptions hours later.
  const child = spawn(cmd, args, {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env },
    detached: true,
  });
  // Group leader: teardown may signal its whole process group. Suite
  // processes (spawned below WITHOUT detached) share OUR group and must
  // never be group-signalled — that would kill this orchestrator too.
  child.__groupLeader = true;
  if (readyMarker) {
    let out = "";
    readyPromises.set(
      readyMarker,
      new Promise((resolve, reject) => {
        const onData = (d) => {
          out += d.toString();
          process.stdout.write(d);
          if (out.includes(readyMarker)) {
            resolve();
            child.stdout.off("data", onData);
            child.stderr.off("data", onData);
          }
        };
        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        child.on("exit", (code) => reject(new Error(`${readyMarker}: exited ${code}`)));
      }),
    );
  } else {
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
  }
  children.push(child);
  return child;
}

async function ensureTestDatabase() {
  // Idempotent CREATE DATABASE via the postgres container.
  const psql = spawn(
    "docker",
    [
      "exec",
      "mqtt-chat-postgres",
      "psql",
      "-U",
      "mqtt",
      "-d",
      "postgres",
      "-c",
      "CREATE DATABASE mqtt_chat_test",
    ],
    { stdio: "pipe" },
  );
  await new Promise((resolve) => {
    let out = "";
    psql.stderr.on("data", (d) => (out += d));
    psql.on("close", () => resolve(out.includes("already exists") || out === ""));
  });
}

async function migrateAndSeed() {
  console.log("[test-stack] migrating + seeding mqtt_chat_test…");
  if (process.env.DEBUG_STACK_ENV === "1") {
    console.error(`[debug-mms] pre-spawn TEST_DB=${JSON.stringify(TEST_DB)}`);
  }
  run("pnpm", ["--filter", "@mqtt-chat/database", "exec", "prisma", "migrate", "deploy"], {
    env: { DATABASE_URL: TEST_DB },
  });
  await waitFor(children[children.length - 1], "prisma migrate");
  run("pnpm", ["--filter", "@mqtt-chat/database", "exec", "tsx", "src/seed.ts"], {
    env: { DATABASE_URL: TEST_DB },
  });
  await waitFor(children[children.length - 1], "seed");
}

function waitFor(child, label) {
  return new Promise((resolve, reject) => {
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${label} exited ${code}`)),
    );
  });
}

async function startTestServices() {
  console.log(
    `[test-stack] starting isolated services (api :${TEST_API_PORT}, redis db 1, ns ${TEST_NS})…`,
  );
  const sharedEnv = {
    DATABASE_URL: TEST_DB,
    REDIS_URL: TEST_REDIS,
    MQTT_TOPIC_NAMESPACE: TEST_NS,
  };
  // Workers must be FULLY subscribed to the broker before suites publish —
  // otherwise the first commands race the subscriptions and time out.
  run("pnpm", ["--filter", "@mqtt-chat/api", "exec", "tsx", "src/main.ts"], {
    env: { ...sharedEnv, PORT: TEST_API_PORT },
  });
  run("pnpm", ["--filter", "@mqtt-chat/chat-worker", "dev"], {
    env: sharedEnv,
    readyMarker: "chat-worker ready",
  });
  run("pnpm", ["--filter", "@mqtt-chat/bot-worker", "dev"], {
    env: sharedEnv,
    readyMarker: "bot-worker ready",
  });
  run("pnpm", ["--filter", "@mqtt-chat/notification-worker", "dev"], {
    env: sharedEnv,
    readyMarker: "notification-worker",
  });
}

async function waitUntilWorkersReady(timeoutMs = 45_000) {
  const result = await Promise.race([
    Promise.allSettled([...readyPromises.values()]).then(() => "ready"),
    delay(timeoutMs).then(() => "timeout"),
  ]);
  if (result === "timeout") {
    throw new Error(`workers not ready within ${timeoutMs}ms`);
  }
}

async function waitUntilHealthy(timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${TEST_API}/health`);
      if (res.ok) {
        const body = await res.json();
        if (body.database === "up") return;
      }
    } catch {
      /* not up yet */
    }
    await delay(500);
  }
  throw new Error(`test API on :${TEST_API_PORT} never became healthy`);
}

export async function withTestStack(fn) {
  try {
    await ensureTestDatabase();
    await migrateAndSeed();
    await startTestServices();
    await waitUntilHealthy();
    await waitUntilWorkersReady();
    console.log(`[test-stack] ready → ${TEST_API}`);
    await fn(TEST_API);
  } finally {
    if (!process.argv.includes("--keep")) await teardown();
    else console.log(`[test-stack] kept running (${TEST_API}); kill manually when done.`);
  }
}

async function teardown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[test-stack] tearing down…");
  // Service children are process-GROUP leaders (spawn detached): signal the
  // whole group (-pid) so `pnpm → tsx watch` grandchildren die too — killing
  // only the direct child left zombie workers holding broker subscriptions
  // for hours (bug #25). Suite children share OUR group: signal them singly.
  const targets = children.reverse().filter((c) => c.exitCode === null && !c.killed);
  for (const child of targets) {
    try {
      if (child.__groupLeader && child.pid) process.kill(-child.pid, "SIGTERM");
      else child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
  // Give processes a moment, then force.
  await delay(1500);
  for (const child of targets) {
    if (child.exitCode !== null || child.killed) continue;
    try {
      if (child.__groupLeader && child.pid) process.kill(-child.pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

// Suites executed against the isolated stack, in order.
const SUITES = [
  "scripts/smoke.mjs",
  "scripts/bot-e2e.mjs",
  "scripts/presence-e2e.mjs",
  "scripts/duplicate-direct-e2e.mjs",
  "scripts/group-media-e2e.mjs",
  "scripts/notification-e2e.mjs",
  // TypeScript suite (shared client + the app's REAL conversation reducer):
  // Web→Mobile group discovery + immediate-send lifecycle.
  "scripts/web-mobile-discovery-e2e.mts",
  // TypeScript suite: media MIME normalization (image/jpg alias) + reply
  // lifecycle incl. deterministic message.rejected failure (#26, #27).
  "scripts/media-reply-e2e.mts",
  // Full GROUP lifecycle: create → permission model → admin tombstone delete
  // → canonical conversation.deleted to every member → post-delete rejects.
  "scripts/group-lifecycle-e2e.mts",
];

/** .mts suites are TypeScript — run them through tsx. */
function suiteCommand(suite) {
  return suite.endsWith(".mts")
    ? { cmd: "pnpm", args: ["exec", "tsx", suite] }
    : { cmd: "node", args: [suite] };
}

/** Per-suite watchdog (#194): a wedged suite must not hold the stack forever. */
const SUITE_TIMEOUT_MS = Number(process.env.TEST_SUITE_TIMEOUT_MS ?? 120_000);

// Only orchestrate when invoked directly (not imported for the fixture helper).
if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("test-stack.mjs")
) {
  // Ctrl-C / SIGTERM must run the SAME teardown as the normal path — the
  // service children are detached process-group leaders, so an abrupt exit
  // leaks the whole stack (bug #25 class). --keep intentionally persists.
  const onSignal = async (signal) => {
    console.log(`\n[test-stack] received ${signal}`);
    if (!process.argv.includes("--keep")) {
      await teardown();
      process.exit(130);
    }
    console.log("[test-stack] --keep: leaving the stack running.");
    process.exit(130);
  };
  process.on("SIGINT", () => void onSignal("SIGINT"));
  process.on("SIGTERM", () => void onSignal("SIGTERM"));

  withTestStack(async (api) => {
    let failed = false;
    for (const suite of SUITES) {
      console.log(`\n[test-stack] ▶ ${suite}`);
      const { cmd, args } = suiteCommand(suite);
      const child = spawn(cmd, args, {
        cwd: ROOT,
        stdio: "inherit",
        env: {
          ...process.env,
          API_URL: api,
          MQTT_TOPIC_NAMESPACE: TEST_NS,
          REDIS_URL: TEST_REDIS,
        },
      });
      children.push(child);
      const code = await new Promise((r) => {
        const timer = setTimeout(() => {
          console.log(`[test-stack] ⏱ ${suite} exceeded ${SUITE_TIMEOUT_MS}ms — killing suite`);
          child.kill("SIGKILL");
        }, SUITE_TIMEOUT_MS);
        child.on("exit", (c) => {
          clearTimeout(timer);
          r(c);
        });
      });
      if (code !== 0) {
        failed = true;
        console.log(`[test-stack] ✗ ${suite} FAILED (${code})`);
        break; // stop at first failure — later suites depend on a sane stack
      }
    }
    process.exitCode = failed ? 1 : 0;
  }).catch((err) => {
    console.error("[test-stack] FATAL:", err.message);
    process.exit(1);
  });
}
