#!/usr/bin/env node
/**
 * Signal-safe root development supervisor.
 *
 * `pnpm dev` used to be a shell chain (`preflight && turbo run dev`). When
 * the outer pnpm process disappeared without signalling its descendants, the
 * shell/Turbo/services were re-parented to PID 1 and kept all dev ports open.
 * This supervisor owns a dedicated Turbo process group, forwards terminal
 * signals, and also notices when its own parent disappears.
 */
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const IS_WINDOWS = process.platform === "win32";
const PNPM = IS_WINDOWS ? "pnpm.cmd" : "pnpm";
const SHUTDOWN_GRACE_MS = 12_000;

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function processGroupExists(groupPid) {
  if (IS_WINDOWS) return processExists(groupPid);
  try {
    process.kill(-groupPid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function watchdog(groupPid) {
  const supervisorPid = process.ppid;
  while (processGroupExists(groupPid)) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    if (process.ppid !== 1 && processExists(supervisorPid)) continue;

    try {
      if (IS_WINDOWS) process.kill(groupPid, "SIGTERM");
      else process.kill(-groupPid, "SIGTERM");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
    const deadline = Date.now() + SHUTDOWN_GRACE_MS;
    while (processGroupExists(groupPid) && Date.now() < deadline) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
    if (processGroupExists(groupPid)) {
      try {
        if (IS_WINDOWS) process.kill(groupPid, "SIGKILL");
        else process.kill(-groupPid, "SIGKILL");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    }
    return;
  }
}

if (process.argv[2] === "--watchdog") {
  const groupPid = Number(process.argv[3]);
  if (Number.isInteger(groupPid) && groupPid > 1) await watchdog(groupPid);
  process.exit(0);
}

const preflight = spawnSync(process.execPath, ["scripts/preflight-dev.mjs"], {
  cwd: ROOT,
  stdio: "inherit",
});
if (preflight.status !== 0) process.exit(preflight.status ?? 1);

const initialParentPid = process.ppid;
const child = spawn(PNPM, ["exec", "turbo", "run", "dev"], {
  cwd: ROOT,
  stdio: "inherit",
  // A dedicated group lets one signal reach Turbo and every service/watch
  // child. Windows has no negative-PID process-group signalling.
  detached: !IS_WINDOWS,
});

// A detached watchdog is deliberately outside the terminal's foreground
// process group. If the terminal/pnpm/supervisor are killed together before
// JavaScript signal handlers run, it observes this supervisor disappear and
// still terminates the exact Turbo group from this invocation.
if (child.pid) {
  const guard = spawn(process.execPath, [SCRIPT_PATH, "--watchdog", String(child.pid)], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
  });
  guard.unref();
}

let stopping = false;
let requestedSignal = null;
let hardStopTimer = null;

function signalChild(signal) {
  if (!child.pid) return;
  try {
    if (IS_WINDOWS) child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function shutdown(signal, reason) {
  if (stopping) return;
  stopping = true;
  requestedSignal = signal;
  console.log(`[dev] ${reason}; forwarding ${signal} to the full Turbo process group…`);
  signalChild(signal);
  hardStopTimer = setTimeout(() => {
    console.error(`[dev] services exceeded ${SHUTDOWN_GRACE_MS}ms shutdown grace; force stopping`);
    signalChild("SIGKILL");
  }, SHUTDOWN_GRACE_MS);
  hardStopTimer.unref();
}

process.on("SIGINT", () => shutdown("SIGINT", "SIGINT received"));
process.on("SIGTERM", () => shutdown("SIGTERM", "SIGTERM received"));
process.on("SIGHUP", () => shutdown("SIGTERM", "terminal disconnected"));

// `pnpm` itself may be killed without forwarding a signal. package.json uses
// `exec node …`, eliminating the intermediate shell; once pnpm disappears
// this process is re-parented to PID 1 and can clean up its child group.
const parentWatch = setInterval(() => {
  if (initialParentPid !== 1 && process.ppid === 1) {
    shutdown("SIGTERM", "parent process disappeared");
  }
}, 500);
parentWatch.unref();

child.on("error", (error) => {
  console.error(`[dev] failed to start Turbo: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  clearInterval(parentWatch);
  if (hardStopTimer) clearTimeout(hardStopTimer);
  if (stopping) {
    process.exitCode = requestedSignal === "SIGINT" ? 130 : 0;
    return;
  }
  if (signal) {
    console.error(`[dev] Turbo exited from ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
