/**
 * Preflight guard for `pnpm dev` — fails fast BEFORE turbo starts when a dev
 * port is already taken.
 *
 * Why: web/gateway die with EADDRINUSE when a previous stack is still alive
 * (orphaned by a closed terminal or a Mac sleep), turbo then aborts every
 * task mid-teardown and the log fills with ELIFECYCLE exit-code noise that
 * looks like a broken stack. Naming the offending PID turns "dev is broken"
 * into a one-line fix for the operator.
 */
import { createConnection } from "node:net";
import { execFileSync } from "node:child_process";

const PORTS = [3000, 3001, 3100];

function portOwner(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.setTimeout(500);
    const finish = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.on("connect", () => finish(true));
    socket.on("timeout", () => finish(false));
    socket.on("error", () => finish(false));
  });
}

const taken = [];
for (const port of PORTS) {
  if (await portOwner(port)) taken.push(port);
}

if (taken.length === 0) {
  console.log(`[preflight] dev ports free (${PORTS.join(", ")})`);
  process.exit(0);
}

console.error(`[preflight] REFUSING to start: dev port(s) already in use: ${taken.join(", ")}`);
for (const port of taken) {
  try {
    const pids = execFileSync("lsof", ["-nP", "-iTCP:" + port, "-sTCP:LISTEN"], {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => line.trim().split(/\s+/)[1])
      .filter(Boolean);
    console.error(`[preflight]   :${port} → PID ${pids.join(", ") || "?"}`);
  } catch {
    console.error(`[preflight]   :${port} → (lsof unavailable)`);
  }
}
console.error(
  "[preflight] A previous dev stack is still running. Stop it first, e.g.:\n" +
    "[preflight]   kill -TERM <pids above>   # or close its original terminal",
);
process.exit(1);
