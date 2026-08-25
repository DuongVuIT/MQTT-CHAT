import { Platform } from "react-native";

/**
 * Environment-aware SINGLE-ORIGIN config.
 *
 * All client traffic (REST /api/*, MQTT WS /mqtt, media /media) goes to the
 * PUBLIC gateway on port 3000 — never to internal service ports.
 * The public host DIFFERS per target and is derived at runtime:
 *   - iOS Simulator shares the host loopback  → localhost
 *   - Android emulator maps host loopback     → 10.0.2.2
 *   - physical device on LAN                  → set MQTT_CHAT_PUBLIC_HOST
 *
 * Overrides (no source edits needed per environment):
 *   MQTT_CHAT_PUBLIC_HOST  — "host:port" of the public gateway
 *   MQTT_CHAT_API_URL      — full REST base URL (rarely needed)
 *   MQTT_CHAT_MQTT_WS_URL  — full MQTT WebSocket URL (rarely needed)
 */
const DEV_HOST = Platform.OS === "android" ? "10.0.2.2" : "localhost";

/** Public origin "host:port" — the ONLY endpoint mobile needs. */
export const PUBLIC_HOST = process.env.MQTT_CHAT_PUBLIC_HOST ?? `${DEV_HOST}:3000`;

export const API_BASE = process.env.MQTT_CHAT_API_URL ?? `http://${PUBLIC_HOST}/api`;

export const MQTT_WS_URL = process.env.MQTT_CHAT_MQTT_WS_URL ?? `ws://${PUBLIC_HOST}/mqtt`;

/** Canonical media path served by the gateway → API streaming handler. */
export function mediaUrl(storageKey: string): string {
  if (/^https?:\/\//i.test(storageKey)) return storageKey;
  return `http://${PUBLIC_HOST}/media?key=${encodeURIComponent(storageKey)}`;
}
