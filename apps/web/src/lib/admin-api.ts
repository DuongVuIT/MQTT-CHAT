/**
 * Admin REST client (apps/api) + realtime event stream.
 *
 * SINGLE ORIGIN: all REST calls use same-origin `/api/...` paths proxied by
 * the public gateway. The live event stream uses the shared
 * `@mqtt-chat/realtime-core` browser MQTT adapter — admin MUST NOT import
 * `mqtt` directly (that duplicate implementation caused a runtime
 * `mqtt.connect is not a function` crash; see docs/repair-log.md).
 */
import { ChatRealtimeClient, type RealtimeEvent } from "@mqtt-chat/realtime-core";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api";

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
  getHealth: () => request<{ status: string; database: string }>("/health"),
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

/**
 * Live event stream over MQTT WS — admin is an anonymous observer that
 * subscribes to the canonical all-events wildcard through the shared
 * realtime adapter. Returns a disposer.
 */
export function connectEventStream(
  onEvent: (eventType: string, payload: unknown) => void,
): () => void {
  const deviceId = `admin-${Math.random().toString(36).slice(2, 8)}`;
  const proto =
    typeof window !== "undefined" && window.location.protocol === "https:" ? "wss" : "ws";
  const url = process.env.NEXT_PUBLIC_MQTT_WS_URL ?? `${proto}://${window.location.host}/mqtt`;

  const client = new ChatRealtimeClient({
    url,
    identity: { userId: "admin-dashboard", deviceId },
    // Observer only: the core's base subscription IS the all-events wildcard;
    // skip per-user targeted topics.
    subscribeUserEvents: false,
    onStatus: (status) => {
      if (process.env.NODE_ENV !== "production") {
        console.log("[admin-mqtt]", deviceId, status);
      }
    },
    onEvent: (event: RealtimeEvent) => onEvent(event.eventType, event),
  });

  if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
    // Dev-only diagnostics hook (§42): expose stream clients for inspection.
    const diag = window as typeof window & { __adminStreams?: unknown[] };
    (diag.__adminStreams ??= []).push(client);
  }

  void client.connect().catch(() => {
    // The dashboard keeps polling REST; realtime is best-effort. The mqtt.js
    // auto-reconnect inside the core client retries in the background.
  });

  return () => {
    void client.disconnect();
  };
}
