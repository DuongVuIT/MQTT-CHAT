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

const PORT = Number(process.env.GATEWAY_PORT ?? 3000);

const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://127.0.0.1:3100";
const API_ORIGIN = process.env.API_ORIGIN ?? "http://127.0.0.1:3001";
const EMQX_WS_ORIGIN = process.env.EMQX_WS_ORIGIN ?? "http://127.0.0.1:8083";

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
