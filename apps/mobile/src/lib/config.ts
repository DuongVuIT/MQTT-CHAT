import { Platform } from 'react-native';

/**
 * Environment-aware service URLs.
 *
 * The dev services (API :3001, EMQX WS :8083) run on the host machine.
 * The host loopback alias DIFFERS per target:
 *   - iOS Simulator shares the host loopback  → localhost
 *   - Android emulator maps host loopback     → 10.0.2.2
 *   - physical device on LAN                  → set the override vars below
 *
 * Overrides (no source edits needed per environment):
 *   MQTT_CHAT_API_URL      — full REST base URL
 *   MQTT_CHAT_MQTT_WS_URL  — full MQTT WebSocket URL
 */
const DEV_HOST = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';

export const API_BASE =
  process.env.MQTT_CHAT_API_URL ??
  process.env.EXPO_PUBLIC_API_URL ??
  `http://${DEV_HOST}:3001`;

export const MQTT_WS_URL =
  process.env.MQTT_CHAT_MQTT_WS_URL ??
  process.env.MQTT_WS_URL ??
  `ws://${DEV_HOST}:8083`;
