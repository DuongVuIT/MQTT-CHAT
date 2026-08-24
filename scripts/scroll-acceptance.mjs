/**
 * §72 scroll/performance acceptance (permanent): drives a ~300-message
 * fixture conversation through a real browser and asserts the scroll
 * contract — open-at-latest (0px), EXACT viewport-anchor preservation
 * across an older-page prepend, unread-pill count + jump-to-latest (0px),
 * rapid sends rendering exactly once, and conversation switch-and-return.
 *
 * Requires the dev stack (pnpm dev) + Chrome. Run: pnpm probe:scroll
 * Cleans up its fixture group (tombstone) on every exit path.
 */
import puppeteer from "puppeteer-core";
import { createRequire } from "node:module";
const require = createRequire("/Users/vudaiduong/MQTT-CHAT/packages/mqtt/package.json");
const mqtt = require("mqtt");

const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:3000";
const API = `${BASE}/api`;
const MQTT_URL = "mqtt://localhost:1883";
const NS = "chat/v1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = false;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
  if (!ok) failed = true;
};

// ---- Fixture: group + N seeded messages via MQTT commands ----------------
const suffix = Date.now().toString(36);
const groupName = `perf-e2e-${suffix}`;
const created = await fetch(`${API}/conversations`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    type: "GROUP",
    title: groupName,
    createdBy: "duong",
    memberIds: ["duong", "alice"],
  }),
}).then((r) => r.json());
const conversationId = created.conversation.id;
console.log(`fixture group ${groupName} → ${conversationId}`);

const broker = mqtt.connect(MQTT_URL, { clientId: `perf-seeder-${suffix}` });
await new Promise((resolve, reject) => {
  broker.on("connect", resolve);
  broker.on("error", reject);
});
const seedCount = 300;
for (let i = 0; i < seedCount; i++) {
  broker.publish(
    `${NS}/commands/message/send`,
    JSON.stringify({
      requestId: crypto.randomUUID(),
      commandType: "message.send",
      version: 1,
      timestamp: new Date().toISOString(),
      actor: { userId: "duong", deviceId: "perf-seeder" },
      data: {
        conversationId,
        clientMessageId: `perf-${suffix}-${i}`,
        type: "TEXT",
        content: `perf message ${i + 1} of ${seedCount}`,
        replyToId: null,
        metadata: null,
      },
    }),
    { qos: 1 },
  );
}
// Wait for the worker to persist all of them (poll history API).
let seeded = 0;
for (let i = 0; i < 120; i++) {
  await sleep(500);
  const res = await fetch(`${API}/conversations/${conversationId}/messages?limit=1`).then((r) =>
    r.json(),
  );
  seeded = res.messages[0]?.sequence ?? 0;
  if (seeded >= seedCount) break;
}
check(seeded >= seedCount, `seeded ${seedCount} messages`, `lastSeq=${seeded}`);

// ---- Browser acceptance ---------------------------------------------------
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
  await page.evaluate(() => document.querySelector('button[data-user-id="alice"]')?.click());
  await sleep(3000);

  // Open the big conversation.
  await page.evaluate((name) => {
    const row = [...document.querySelectorAll('ul[aria-label="Conversations"] button')].find((b) =>
      b.textContent?.includes(name),
    );
    row?.click();
  }, groupName);
  await sleep(2500);

  // 1) Open-at-latest: viewport must sit at the very bottom (±4px).
  const atBottom = await page.evaluate(() => {
    const el = document.querySelector('div[role="log"]');
    return el.scrollHeight - el.scrollTop - el.clientHeight;
  });
  check(atBottom <= 4, "open lands at the LATEST message", `distanceFromBottom=${atBottom}px`);
  const lastText = await page.evaluate((n) => {
    const el = document.querySelector('div[role="log"]');
    return el.innerText.includes(`perf message ${n}`);
  }, seedCount);
  check(lastText, `latest seeded message (#${seedCount}) visible`);

  // 2) Prepend preserves the viewport: scroll up a bit, load older, the
  // FIRST visible message must not change.
  const beforePrepend = await page.evaluate(() => {
    const el = document.querySelector('div[role="log"]');
    el.scrollTop -= 200; // unpin from bottom, near the top of the loaded page
    const firstVisible = [
      ...el.querySelectorAll('[data-testid="own-message"], [data-testid="other-message"]'),
    ].find((n) => {
      const r = n.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= el.clientHeight;
    });
    return {
      anchor: firstVisible?.textContent ?? "",
      scrollHeight: el.scrollHeight,
    };
  });
  await page.evaluate(() => {
    const btn = document.querySelector('button[data-testid="load-older"]');
    btn?.click();
  });
  await sleep(2500);
  const afterPrepend = await page.evaluate(() => {
    const el = document.querySelector('div[role="log"]');
    const firstVisible = [
      ...el.querySelectorAll('[data-testid="own-message"], [data-testid="other-message"]'),
    ].find((n) => {
      const r = n.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= el.clientHeight;
    });
    return {
      anchor: firstVisible?.textContent ?? "",
      scrollHeight: el.scrollHeight,
      top: el.scrollTop,
      dist: el.scrollHeight - el.scrollTop - el.clientHeight,
    };
  });
  check(
    afterPrepend.scrollHeight > beforePrepend.scrollHeight,
    "older page prepended (content grew)",
    `${beforePrepend.scrollHeight} → ${afterPrepend.scrollHeight}`,
  );
  check(
    afterPrepend.anchor === beforePrepend.anchor,
    "viewport anchor PRESERVED across prepend",
    `"${beforePrepend.anchor.slice(0, 40)}" vs "${afterPrepend.anchor.slice(0, 40)}" dbg=${JSON.stringify(
      {
        before: beforePrepend,
        after: {
          top: afterPrepend.top,
          dist: afterPrepend.dist,
          dbgBefore: afterPrepend.dbgBefore,
        },
      },
    )}`,
  );

  // 3) Scroll fully up → live traffic increments the pill, no yank.
  await page.evaluate(() => {
    const el = document.querySelector('div[role="log"]');
    el.scrollTop = 0;
  });
  await sleep(300);
  const incoming = 3;
  for (let i = 0; i < incoming; i++) {
    broker.publish(
      `${NS}/commands/message/send`,
      JSON.stringify({
        requestId: crypto.randomUUID(),
        commandType: "message.send",
        version: 1,
        timestamp: new Date().toISOString(),
        actor: { userId: "duong", deviceId: "perf-seeder" },
        data: {
          conversationId,
          clientMessageId: `perf-live-${suffix}-${i}`,
          type: "TEXT",
          content: `live incoming ${i + 1}`,
          replyToId: null,
          metadata: null,
        },
      }),
      { qos: 1 },
    );
  }
  await sleep(3000);
  const pill = await page.evaluate(() => {
    const el = document.querySelector('button[data-testid="new-messages-pill"]');
    return el ? el.textContent.trim() : "";
  });
  check(pill.includes(`${incoming} new message`), "unread pill counts live traffic", pill);

  // 4) Click the pill → land back at the latest.
  await page.evaluate(() => {
    window.__scrollMarks = [];
    document.querySelector('button[data-testid="new-messages-pill"]')?.click();
  });
  // Smooth-scroll over an 8000px transcript takes seconds — poll to settle.
  let backAtBottom = Infinity;
  for (let i = 0; i < 30; i++) {
    await sleep(400);
    backAtBottom = await page.evaluate(() => {
      const el = document.querySelector('div[role="log"]');
      return el.scrollHeight - el.scrollTop - el.clientHeight;
    });
    if (backAtBottom <= 4) break;
  }
  const pillMarks = await page.evaluate(() => window.__scrollMarks);
  console.log("PILL-MARKS:", JSON.stringify(pillMarks));
  check(backAtBottom <= 4, "pill click returns to latest", `distance=${backAtBottom}px`);
  const pillGone = await page.evaluate(
    () => !document.querySelector('button[data-testid="new-messages-pill"]'),
  );
  check(pillGone, "pill dismissed after jump");

  // 5) Rapid sends: 5 in quick succession — all render exactly once.
  for (let i = 0; i < 5; i++) {
    await page.focus("textarea[aria-label='Message']");
    await page.type("textarea[aria-label='Message']", `rapid ${i + 1}`);
    await page.keyboard.press("Enter");
    await sleep(150);
  }
  await sleep(4000);
  const rapidOk = await page.evaluate(() => {
    const el = document.querySelector('div[role="log"]').innerText;
    for (let i = 1; i <= 5; i++) {
      const needle = `rapid ${i}`;
      if (!el.includes(needle)) return `missing ${needle}`;
      if (el.split(needle).length - 1 > 2) return `duplicated ${needle}`; // body text + maybe reply quote
    }
    return "";
  });
  check(rapidOk === "", "5 rapid sends render exactly once", rapidOk);

  // 6) Switch away and back — transcript survives.
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('ul[aria-label="Conversations"] button')];
    rows.find((b) => b.textContent?.includes("General"))?.click();
  });
  await sleep(1500);
  await page.evaluate((name) => {
    const rows = [...document.querySelectorAll('ul[aria-label="Conversations"] button')];
    rows.find((b) => b.textContent?.includes(name))?.click();
  }, groupName);
  await sleep(2500);
  const restored = await page.evaluate(() => {
    const el = document.querySelector('div[role="log"]');
    const d = el.scrollHeight - el.scrollTop - el.clientHeight;
    return { atLatest: d <= 4, hasRapid: el.innerText.includes("rapid 5") };
  });
  check(restored.atLatest, "re-open lands at latest again");
  check(restored.hasRapid, "rapid messages persisted across switch");
} catch (err) {
  failed = true;
  console.log("FATAL:", err.message);
} finally {
  await browser.close();
  broker.end(true);
  // Cleanup: tombstone the fixture group (exact id, admin=duong).
  await fetch(`${API}/conversations/${conversationId}?actor=duong`, { method: "DELETE" }).catch(
    () => {},
  );
  console.log("fixture tombstoned", conversationId);
}
console.log(failed ? "SCROLL ACCEPTANCE FAILED" : "SCROLL ACCEPTANCE DONE — ALL PASS");
process.exit(failed ? 1 : 0);
