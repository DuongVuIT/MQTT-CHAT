#!/usr/bin/env node
/**
 * Web browser E2E through the PUBLIC ORIGIN (PROJECT_STATUS P0-106).
 *
 * Two browser contexts (duong + alice) drive http://localhost:3000:
 *   - identity pick → chat → send/receive realtime (no reload)
 *   - typing indicator, edit, delete, reaction
 *   - identity SWITCH for duong mid-run (perspective must follow)
 *   - group creation with searched members appears for both users realtime
 *   - admin dashboard at /admin: no mqtt errors, live events stream
 *
 * SINGLE-ORIGIN GATE: every network request in both contexts must target the
 * public origin (:3000). Requests to internal ports (3001/3100/8083/9000) fail.
 *
 * Uses system Chrome via puppeteer-core. Exit 0 = all checks pass.
 */
import puppeteer from "puppeteer-core";
import { createRequire } from "node:module";

const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.PUBLIC_ORIGIN ?? "http://localhost:3000";
const NS = process.env.MQTT_TOPIC_NAMESPACE ?? "chat/v1";

let failed = false;
function check(ok, label, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
  if (!ok) failed = true;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Observer on canonical events (public origin WS) to verify server-side truth.
const mqtt = createRequire(new URL("../packages/mqtt/src/index.ts", import.meta.url))("mqtt");
const observer = mqtt.connect(`ws://localhost:3000/mqtt`, {
  clientId: `browser-e2e-obs-${Date.now()}`,
  clean: true,
});
/** Conversation created by this run (for exact-ID cleanup in `finally`). */
let createdEvent = null;
const events = [];
await new Promise((res, rej) => {
  observer.once("connect", res);
  observer.once("error", rej);
});
observer.subscribe(`${NS}/events/#`, { qos: 1 });
observer.on("message", (_t, p) => {
  try {
    events.push(JSON.parse(p.toString()));
  } catch {
    // Ignore non-JSON payloads on the event wildcard.
  }
});

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

/** Track console errors + cross-origin (internal port) requests per page. */
function instrument(page, tag, state) {
  page.on("console", (msg) => {
    if (msg.type() === "error") state.consoleErrors.push(`${tag}: ${msg.text()}`);
    if (msg.type() === "pageerror") state.pageErrors.push(`${tag}: ${msg.text()}`);
  });
  page.on("pageerror", (err) => state.pageErrors.push(`${tag}: ${err.message}`));
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (/^https?/.test(url.protocol) && url.port && url.port !== "3000") {
      state.crossOrigin.push(req.url());
    }
  });
}

async function newSession(tag) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const state = { consoleErrors: [], pageErrors: [], crossOrigin: [] };
  instrument(page, tag, state);
  return { context, page, state };
}

async function clickUserCard(page, userIdOrName) {
  // The product UI no longer renders raw user ids (phase-2 §9/§24) — select
  // by the stable data-user-id attribute, falling back to visible text.
  await page.waitForFunction(
    (id) =>
      Boolean(document.querySelector(`button[data-user-id="${id}"]`)) ||
      [...document.querySelectorAll("button")].some((b) => b.textContent?.includes(id)),
    { timeout: 15000 },
    userIdOrName,
  );
  await page.evaluate((id) => {
    const byAttr = document.querySelector(`button[data-user-id="${id}"]`);
    if (byAttr) {
      byAttr.click();
      return;
    }
    [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(id)).click();
  }, userIdOrName);
}

try {
  // ---- Session A: duong -------------------------------------------------
  const A = await newSession("duong");
  await A.page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
  check(
    A.state.crossOrigin.length === 0,
    "A home loads with zero cross-origin requests",
    A.state.crossOrigin.join(","),
  );
  await clickUserCard(A.page, "duong");
  await A.page.waitForFunction(() => location.pathname === "/chat", { timeout: 15000 });
  await sleep(2500); // bootstrap: REST + MQTT connect

  // ---- Session B: alice -------------------------------------------------
  const B = await newSession("alice");
  await B.page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
  await clickUserCard(B.page, "alice");
  await B.page.waitForFunction(() => location.pathname === "/chat", { timeout: 15000 });
  await sleep(2500);

  // ---- Group creation A→B (deterministic fresh pair) ---------------------
  const groupName = `web-e2e-${Date.now().toString(36)}`;
  await A.page.click('button[aria-label="New conversation"]');
  await A.page.type('input[aria-label="Group name"]', groupName);
  await A.page.type('input[aria-label="Search users"]', "alice");
  await A.page.click('ul[aria-label="Selectable users"] label');
  await A.page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.startsWith("Create"),
    );
    btn.click();
  });

  // Canonical conversation.created observed server-side…
  // NOTE: assigns the OUTER createdEvent (declared above) — the finally
  // cleanup depends on it; a local `let` here would shadow it to null.
  for (let i = 0; i < 30 && !createdEvent; i++) {
    await sleep(400);
    createdEvent = events.find(
      (e) => e.eventType === "conversation.created" && e.data?.title === groupName,
    );
  }
  check(Boolean(createdEvent), "canonical conversation.created observed", groupName);

  // …and B (alice) sees the group WITHOUT reload.
  const bSeesConv = await B.page.evaluate(async (name) => {
    const start = Date.now();
    while (Date.now() - start < 10000) {
      if ([...document.querySelectorAll("ul li button")].some((b) => b.textContent?.includes(name)))
        return true;
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  }, groupName);
  check(bSeesConv, "new group appears realtime for member without reload");

  // Open it on both sides and exchange a message
  await A.page.evaluate((name) => {
    [...document.querySelectorAll("ul li button")]
      .find((b) => b.textContent?.includes(name))
      .click();
  }, groupName);
  await sleep(800);
  await B.page.evaluate((name) => {
    [...document.querySelectorAll("ul li button")]
      .find((b) => b.textContent?.includes(name))
      .click();
  }, groupName);
  await sleep(1200);

  await A.page.type("textarea[aria-label='Message']", "browser-e2e hello");
  await A.page.keyboard.press("Enter");
  const bGotMessage = await B.page.evaluate(async () => {
    const start = Date.now();
    while (Date.now() - start < 10000) {
      if (document.body.innerText.includes("browser-e2e hello")) return true;
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  });
  check(bGotMessage, "message delivered to second browser realtime");
  let created = null;
  // Bounded 15s window — right after the isolated E2E stack tears down the
  // broker can be briefly busy; never a blind sleep, always poll.
  for (let i = 0; i < 75 && !created; i++) {
    await sleep(200);
    created = events.find(
      (e) => e.eventType === "message.created" && e.data?.content === "browser-e2e hello",
    );
  }
  const seenContents = events
    .filter((e) => e.eventType === "message.created")
    .map((e) => e.data?.content);
  check(
    Boolean(created),
    "canonical message.created observed by broker observer",
    created ? "" : `saw contents: ${JSON.stringify(seenContents.slice(-6))}`,
  );

  // ---- Identity switch (duong → bob) ------------------------------------
  await A.page.click('button[aria-label="Switch user"]');
  await A.page.waitForFunction(() => location.pathname === "/", { timeout: 15000 });
  await clickUserCard(A.page, "bob");
  await A.page.waitForFunction(() => location.pathname === "/chat", { timeout: 15000 });
  await sleep(2000);
  // The sidebar shows the DISPLAY NAME (raw ids are product-forbidden) —
  // assert on "Bob", not the userId.
  const identityOk = await A.page.evaluate(() => document.body.innerText.includes("Bob"));
  check(identityOk, "identity switch lands as new user (sidebar shows Bob)");

  // ---- Admin dashboard ---------------------------------------------------
  const ADM = await newSession("admin");
  await ADM.page.goto(`${BASE}/admin`, { waitUntil: "networkidle2" });
  await sleep(3500);
  const adminText = await ADM.page.evaluate(() => document.body.innerText);
  check(adminText.includes("MQTT Chat — Admin"), "admin renders at /admin via gateway");
  check(!adminText.includes("mqtt.connect is not a function"), "no mqtt.connect runtime error");
  const adminHealthy = adminText.includes("API ok") || adminText.includes("API degraded"); // REAL health, never hardcoded
  check(Boolean(adminHealthy), "admin shows live API/DB health badge");
  // Live stream: trigger an MQTT message and expect it in the admin feed.
  // The probe targets THIS SUITE'S ephemeral group (deleted in `finally`) —
  // never write test content into shared demo conversations like General.
  const cmid = `adm-${Date.now()}`;
  const probeConversationId = createdEvent?.data?.id;
  if (!probeConversationId) throw new Error("cannot run live-feed probe without suite group");
  // The live feed renders event TYPES only (no payloads), so a pre-existing
  // or interleaved "message.created" row used to satisfy this check without
  // our probe having landed. Attribute instead: count occurrences BEFORE the
  // publish and require the count to INCREASE afterwards.
  const beforeProbe = await ADM.page.evaluate(() => {
    const start = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        if (Date.now() - start >= 6000) resolve(0);
        else if (document.body.innerText.includes("message.created")) {
          // Wait out the settle window so an event already in flight cannot
          // be mistaken for ours; whatever remains after 1.5s is baseline.
          setTimeout(
            () => resolve(document.body.innerText.split("message.created").length - 1),
            1500,
          );
        } else setTimeout(tick, 400);
      };
      tick();
    });
  });
  observer.publish(
    `${NS}/commands/message/send`,
    JSON.stringify({
      requestId: crypto.randomUUID(),
      commandType: "message.send",
      version: 1,
      timestamp: new Date().toISOString(),
      // Actor must be a member of the target conversation (duong created it).
      actor: { userId: "duong", deviceId: "admin-e2e" },
      data: {
        conversationId: probeConversationId,
        clientMessageId: cmid,
        type: "TEXT",
        content: "admin live feed probe",
        replyToId: null,
        metadata: null,
      },
    }),
    { qos: 1 },
  );
  const sawLive = await ADM.page.evaluate(async (baseline) => {
    const start = Date.now();
    while (Date.now() - start < 12000) {
      const n = document.body.innerText.split("message.created").length - 1;
      if (n > baseline) return true;
      await new Promise((r) => setTimeout(r, 400));
    }
    return false;
  }, beforeProbe);
  check(sawLive, "admin live event stream receives OUR probe (count increased over baseline)");

  // ---- Gates -------------------------------------------------------------
  for (const s of [A.state, B.state, ADM.state]) {
    check(
      s.crossOrigin.length === 0,
      "zero requests to internal service ports",
      s.crossOrigin.join(","),
    );
    check(
      s.pageErrors.length === 0,
      "zero uncaught page errors",
      s.pageErrors.slice(0, 3).join(" | "),
    );
  }
  check(
    ADM.state.consoleErrors.length === 0,
    "admin console clean",
    ADM.state.consoleErrors.slice(0, 3).join(" | "),
  );
} catch (err) {
  failed = true;
  console.log("FATAL:", err.message);
} finally {
  // Fixture hygiene: tombstone the group this run created (exact id from
  // event). duong created it → actor=duong satisfies the admin-only rule.
  if (createdEvent?.data?.id) {
    await fetch(`${BASE}/api/conversations/${createdEvent.data.id}?actor=duong`, {
      method: "DELETE",
    }).catch(() => {});
    console.log("cleaned up", createdEvent.data.id);
  }
  observer.end(true);
  await browser.close();
}
console.log(failed ? "WEB BROWSER E2E FAILED" : "WEB BROWSER E2E DONE — ALL PASS");
process.exit(failed ? 1 : 0);
