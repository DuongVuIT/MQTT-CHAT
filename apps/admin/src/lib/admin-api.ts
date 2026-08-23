/**
 * Admin REST client (apps/api) + realtime event stream via MQTT WS.
 */

import type { MqttClient } from "mqtt";
import { SUBSCRIPTION_PATTERNS } from "@mqtt-chat/mqtt-contracts";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const MQTT_WS_URL = process.env.NEXT_PUBLIC_MQTT_WS_URL ?? "ws://localhost:8083";

export interface AdminStats {
  users: { total: number; online: number };
  conversations: { total: number };
  messages: { total: number; perMinute: number };
  bots: { total: number; enabled: number };
  events: { lastHour: number };
}

export interface AdminUser {
  id: string;
  displayName: string;
  online: boolean;
  deviceCount: number;
  lastActivityAt: string | null;
  messagesSent: number;
}

export interface AdminEvent {
  id: string;
  eventType: string;
  conversationId: string | null;
  actorUserId: string | null;
  botId: string | null;
  createdAt: string;
  payload: unknown;
}

export interface BotDto {
  id: string;
  name: string;
  enabled: boolean;
}

export interface BotRuleDto {
  id: string;
  botId: string;
  name: string;
  description: string | null;
  trigger: unknown;
  conditions: unknown[];
  actions: unknown[];
  priority: number;
  enabled: boolean;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export const adminApi = {
  getStats: () => request<{ stats: AdminStats }>("/admin/stats"),
  getUsers: () => request<{ users: AdminUser[] }>("/admin/users"),
  getEvents: () => request<{ events: AdminEvent[] }>("/admin/events"),
  listBots: () => request<{ bots: BotDto[] }>("/bots"),
  listRules: (botId: string) => request<{ rules: BotRuleDto[] }>(`/bots/${botId}/rules`),
  patchBot: (botId: string, patch: { enabled?: boolean }) =>
    request<{ bot: BotDto }>(`/bots/${botId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  patchRule: (botId: string, ruleId: string, patch: { enabled?: boolean }) =>
    request<{ rule: BotRuleDto }>(`/bots/${botId}/rules/${ruleId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
};

/** Live event stream over MQTT WS — admin is an observer, subscribes chat/v1/events/#. */
export function connectEventStream(
  onEvent: (eventType: string, payload: unknown) => void,
): () => void {
  let client: MqttClient | null = null;
  let stopped = false;

  void import("mqtt").then((mqtt) => {
    if (stopped) return;
    client = mqtt.connect(MQTT_WS_URL, {
      clientId: `admin-dashboard-${Math.random().toString(36).slice(2, 8)}`,
      clean: true,
      reconnectPeriod: 3000,
    });
    client.on("connect", () => {
      client?.subscribe(SUBSCRIPTION_PATTERNS.allEvents, { qos: 0 });
    });
    client.on("message", (_topic, payload) => {
      try {
        const envelope = JSON.parse(payload.toString()) as { eventType?: string };
        onEvent(envelope.eventType ?? "unknown", envelope);
      } catch {
        // Ignore malformed payloads in the observer dashboard.
      }
    });
  });

  return () => {
    stopped = true;
    client?.end(true);
  };
}
