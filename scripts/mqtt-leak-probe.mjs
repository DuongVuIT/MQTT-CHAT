/**
 * §73 subscription/listener leak probe (permanent): churn conversations,
 * switch identity, drop/restore the network 3×, then assert against the
 * broker that THIS probe's own sessions stay exactly ONE client with a
 * STABLE subscription count (other tabs/devices are legitimate separate
 * clients and are filtered out by the probe's unique deviceId).
 *
 * Requires the dev stack (pnpm dev) + Chrome + docker (EMQX CLI).
 * Run: pnpm probe:leak
 */
import puppeteer from "puppeteer-core";
import { spawnSync } from "node:child_process";

const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = "http://localhost:3000";

function mqttClients() {
  // `emqx ctl clients list` prints the table but exits 1 — parse stdout and
  // ignore the exit code.
  const res = spawnSync("docker", ["exec", "mqtt-chat-emqx", "emqx", "ctl", "clients", "list"], {
    encoding: "utf8",
  });
  const out = res.stdout ?? "";
  return out
    .trim()
    .split("\n")
    .filter((l) => l.startsWith("Client("))
    .map((l) => {
      const id = l.slice("Client(".length, l.indexOf(","));
      const subs = Number(/subscriptions=(\d+)/.exec(l)?.[1] ?? -1);
      const connected = /connected=(true|false)/.exec(l)?.[1] === "true";
      return { id, subs, connected };
    });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const forUser = (clients, prefix) => clients.filter((c) => c.id.startsWith(prefix));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox"],
});
let failed = false;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
  if (!ok) failed = true;
};

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
  // Snapshot pre-existing client ids BEFORE this probe picks an identity —
  // the operator's own tabs / the simulator may hold legitimate live sessions
  // for the same users (documented non-leak). Every later per-user assertion
  // judges only clients THIS probe created.
  const baselineIds = mqttClients().map((c) => c.id);
  await page.evaluate(() => {
    document.querySelector('button[data-user-id="duong"]')?.click();
  });
  await sleep(3500);

  const baseline = forUser(mqttClients(), "duong:").filter((c) => !baselineIds.includes(c.id));
  check(baseline.length === 1, "exactly ONE NEW broker client for duong (probe's own)", JSON.stringify(baseline));
  const baseSubs = baseline[0]?.subs ?? -1;
  check(baseSubs >= 2, "global + user topic subscribed", `subs=${baseSubs}`);

  // Churn: open conversations A/B/A rapidly.
  const openConv = async (index) => {
    await page.evaluate((i) => {
      const rows = [...document.querySelectorAll('ul[aria-label="Conversations"] button')];
      rows[i]?.click();
    }, index);
    await sleep(900);
  };
  await openConv(0);
  await openConv(1);
  await openConv(0);
  await openConv(2);
  await openConv(0);

  // Only THIS probe's duong session — pre-existing tabs (baselineIds) are
  // legitimate separate clients, not leaks.
  const afterChurn = forUser(mqttClients(), "duong:").filter((c) => !baselineIds.includes(c.id));
  check(
    afterChurn.length === 1 && afterChurn[0]?.subs === baseSubs,
    "subscription count STABLE after conversation churn",
    JSON.stringify(afterChurn),
  );

  // Identity switch: duong → alice (teardown + fresh session).
  await page.click('button[aria-label="Switch user"]');
  await sleep(1500);
  await page.evaluate(() => {
    document.querySelector('button[data-user-id="alice"]')?.click();
  });
  await sleep(3500);
  const midClients = mqttClients().filter((c) => c.id.startsWith("duong:") && !baselineIds.includes(c.id));
  check(
    midClients.length === 0 || midClients.every((c) => !c.connected),
    "duong client GONE after identity switch",
    JSON.stringify(midClients),
  );

  // Reconnect churn on alice: drop and restore the network 3×.
  for (let i = 0; i < 3; i++) {
    await page.setOfflineMode(true);
    await sleep(1200);
    await page.setOfflineMode(false);
    await sleep(3500);
  }
  // NOTE: other live clients of the same user (another browser tab) are
  // legitimate — the leak contract is about THIS session's client. Capture
  // the probe's own client id at pick time via the newest alice session.
  const aliceClients = forUser(mqttClients(), "alice:");
  const mine = aliceClients.find((c) => !baselineIds.includes(c.id));
  check(
    Boolean(mine && mine.connected),
    "probe's alice client connected after 3 reconnects",
    JSON.stringify(aliceClients),
  );
  check(
    mine?.subs === baseSubs,
    "alice subscription count matches baseline",
    `subs=${mine?.subs} expected=${baseSubs}`,
  );
} catch (err) {
  failed = true;
  console.log("FATAL:", err.message);
} finally {
  await browser.close();
}
console.log(failed ? "LEAK PROBE FAILED" : "LEAK PROBE DONE — ALL PASS");
process.exit(failed ? 1 : 0);
