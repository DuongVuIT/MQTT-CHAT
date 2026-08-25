/**
 * Public gateway — the SINGLE browser-facing origin (default :3000).
 *
 *   localhost:3000/            → web app   (internal, default :3100)
 *   localhost:3000/admin       → web app   (admin lives inside the web app)
 *   localhost:3000/api/*      → API       (internal :3001, Nest global prefix /api)
 *   localhost:3000/media*     → API media streaming handler
 *   ws://localhost:3000/mqtt  → EMQX MQTT-over-WebSocket (internal :8083)
 *   ws://localhost:3000/_next/* → web app dev HMR websocket
 *
 * Internal ports stay internal: browsers and mobile clients only ever need
 * the public origin. Host headers are preserved so every hop sees the
 * public origin (important for any future signed-URL flows).
 */
import http from "node:http";
import httpProxy from "http-proxy";
import { loadGatewayEnv } from "@mqtt-chat/config";

// Env is validated at startup like every other app (AGENTS invariant #12) —
// garbage like GATEWAY_PORT=abc fails fast instead of listening on NaN.
const env = loadGatewayEnv();

const PORT = env.GATEWAY_PORT;
const WEB_ORIGIN = env.WEB_ORIGIN;
const API_ORIGIN = env.API_ORIGIN;
const EMQX_WS_ORIGIN = env.EMQX_WS_ORIGIN;

const PROXY_TIMEOUT_MS = 30_000;

const proxy = httpProxy.createProxyServer({
  // Keep the original Host header (the public origin) on every hop.
  changeOrigin: false,
  xfwd: true,
  proxyTimeout: PROXY_TIMEOUT_MS,
  timeout: PROXY_TIMEOUT_MS,
});

proxy.on("error", (err, _req, res) => {
  const code = (err as NodeJS.ErrnoException).code;
  const message = `Gateway upstream unavailable (${code ?? err.message})`;
  if (res instanceof http.ServerResponse && res.writableEnded === false) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "BAD_GATEWAY", message } }));
    return;
  }
  // Raw upgrade sockets have no response object — just tear them down.
  if (res && typeof (res as { destroy?: () => void }).destroy === "function") {
    (res as { destroy: () => void }).destroy();
  }
});

function routeHttp(pathname: string): string {
  if (pathname === "/api" || pathname.startsWith("/api/")) return API_ORIGIN;
  // Public canonical media path → API's /api/media handler (target carries
  // the base path so /media?key=… resolves to /api/media?key=… upstream).
  if (pathname === "/media" || pathname.startsWith("/media/")) return `${API_ORIGIN}/api`;
  return WEB_ORIGIN;
}

function routeUpgrade(pathname: string): string {
  // EMQX's WS listener serves MQTT at path /mqtt.
  if (pathname === "/mqtt" || pathname.startsWith("/mqtt/") || pathname.startsWith("/mqtt?")) {
    return EMQX_WS_ORIGIN;
  }
  // Next.js dev HMR (webpack/turbopack) opens its websocket under /_next/.
  return WEB_ORIGIN;
}

const server = http.createServer((req, res) => {
  const pathname = (req.url ?? "/").split("?")[0] ?? "/";
  const target = routeHttp(pathname);
  proxy.web(req, res, { target });
});

// WebSocket upgrades: MQTT-over-WS goes to EMQX, everything else to the web app.
server.on("upgrade", (req, socket, head) => {
  const pathname = (req.url ?? "/").split("?")[0] ?? "/";
  const target = routeUpgrade(pathname);
  proxy.ws(req, socket, head, { target });
});

// A client disconnecting mid-request must not crash the gateway.
server.on("clientError", (err, socket) => {
  if (socket.writable) {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(
    `[gateway] public origin http://localhost:${PORT} →\n` +
      `  /*        → ${WEB_ORIGIN}\n` +
      `  /api/*    → ${API_ORIGIN}\n` +
      `  /media*   → ${API_ORIGIN}\n` +
      `  /mqtt(ws) → ${EMQX_WS_ORIGIN}`,
  );
});

// Graceful shutdown (AGENTS invariant #15): stop accepting new work, give
// in-flight HTTP requests a short drain window, then force-close everything —
// long-lived WS upgrades would otherwise keep the process alive forever.
//
// The drain window MUST stay well under tsx watch's 5s kill grace: in dev,
// every proxied HMR/MQTT websocket keeps `server.close()` waiting, and with a
// 5s drain tsx printed "Process didn't exit in 5s. Force killing…" and
// SIGKILLed us on every watched-file restart. 2s drain + hard exit at 3.5s
// guarantees a clean exit inside the grace window.
const DRAIN_MS = 2_000;
const HARD_EXIT_MS = 3_500;

function shutdown(signal: string): void {
  console.log(`[gateway] ${signal} received — draining ${DRAIN_MS / 1000}s…`);
  server.closeIdleConnections?.();
  const forceTimer = setTimeout(() => {
    server.closeAllConnections?.();
  }, DRAIN_MS);
  const hardExit = setTimeout(() => {
    console.log("[gateway] drain elapsed — exiting");
    process.exit(0);
  }, HARD_EXIT_MS);
  forceTimer.unref();
  hardExit.unref();
  server.close(() => {
    clearTimeout(forceTimer);
    clearTimeout(hardExit);
    console.log("[gateway] closed cleanly");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
