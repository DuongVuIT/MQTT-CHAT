"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  adminApi,
  connectEventStream,
  type AdminEvent,
  type AdminStats,
  type AdminUser,
  type BotDto,
  type BotRuleDto,
} from "@/lib/admin-api";
import { Spinner } from "@mqtt-chat/ui";

type Tab = "overview" | "users" | "events" | "bot";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "users", label: "Users" },
  { id: "events", label: "Events" },
  { id: "bot", label: "Bot" },
];

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [health, setHealth] = useState<{ status: string; database: string } | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [liveEvents, setLiveEvents] = useState<{ eventType: string; at: string }[]>([]);
  const [bots, setBots] = useState<BotDto[]>([]);
  const [rules, setRules] = useState<BotRuleDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  const activeBot = bots[0];

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [h, s, u, e, b] = await Promise.all([
        adminApi.getHealth(),
        adminApi.getStats(),
        adminApi.getUsers(),
        adminApi.getEvents(),
        adminApi.listBots(),
      ]);
      setHealth(h);
      setStats(s.stats);
      setUsers(u.users);
      setEvents(e.events);
      setBots(b.bots);
      if (b.bots[0]) {
        const r = await adminApi.listRules(b.bots[0].id);
        setRules(r.rules);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load admin data");
    }
  }, []);

  // Poll REST + subscribe live MQTT event stream (via the shared adapter).
  useEffect(() => {
    void refresh();
    const poll = setInterval(() => {
      void refresh();
    }, 5000);
    const closeStream = connectEventStream((eventType) => {
      setLiveEvents((prev) => [{ eventType, at: new Date().toISOString() }, ...prev].slice(0, 50));
    });
    return () => {
      clearInterval(poll);
      closeStream();
    };
  }, [refresh]);

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">MQTT Chat — Admin</h1>
          <p className="text-xs text-slate-400">
            <Link href="/chat" className="text-indigo-500 hover:underline">
              ← Back to chat
            </Link>
            {" · "}
            auto-refresh 5s
          </p>
        </div>
        {health && (
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              health.status === "ok"
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                : "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300"
            }`}
          >
            API {health.status} · DB {health.database}
          </span>
        )}
      </header>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400"
        >
          {error}
        </p>
      )}

      <nav className="mb-6 flex gap-2" aria-label="Admin sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id);
            }}
            aria-current={tab === t.id}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              tab === t.id
                ? "bg-indigo-600 text-white"
                : "bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {!stats && !error && (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      )}

      {stats && tab === "overview" && <Overview stats={stats} live={liveEvents} />}
      {tab === "users" && <Users users={users} />}
      {tab === "events" && <Events events={events} />}
      {tab === "bot" && activeBot && (
        <BotPanel
          bot={activeBot}
          rules={rules}
          onToggleBot={async (enabled) => {
            await adminApi.patchBot(activeBot.id, { enabled });
            await refresh();
          }}
          onToggleRule={async (ruleId, enabled) => {
            await adminApi.patchRule(activeBot.id, ruleId, { enabled });
            await refresh();
          }}
        />
      )}
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function Overview({
  stats,
  live,
}: {
  stats: AdminStats;
  live: { eventType: string; at: string }[];
}) {
  return (
    <section>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Users" value={stats.users.total} />
        <StatCard label="Online" value={stats.users.online} />
        <StatCard label="Conversations" value={stats.conversations.total} />
        <StatCard label="Messages" value={stats.messages.total} />
        <StatCard label="Msgs/min" value={stats.messages.perMinute} />
        <StatCard label="Events (1h)" value={stats.events.lastHour} />
      </div>
      <h3 className="mb-2 mt-8 text-sm font-semibold">Live event stream</h3>
      <ul className="max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 font-mono text-xs dark:border-slate-800 dark:bg-slate-900">
        {live.length === 0 && <li className="text-slate-400">Waiting for events…</li>}
        {live.map((e, i) => (
          <li key={`${e.at}-${i}`} className="py-0.5 text-slate-600 dark:text-slate-300">
            [{new Date(e.at).toLocaleTimeString()}] {e.eventType}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Users({ users }: { users: AdminUser[] }) {
  return (
    <table className="w-full overflow-hidden rounded-xl border border-slate-200 bg-white text-sm dark:border-slate-800 dark:bg-slate-900">
      <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400 dark:bg-slate-800">
        <tr>
          <th className="px-4 py-2">User</th>
          <th className="px-4 py-2">Status</th>
          <th className="px-4 py-2">Devices</th>
          <th className="px-4 py-2">Last activity</th>
          <th className="px-4 py-2">Messages sent</th>
        </tr>
      </thead>
      <tbody>
        {users.map((u) => (
          <tr key={u.id} className="border-t border-slate-100 dark:border-slate-800">
            <td className="px-4 py-2 font-medium">{u.displayName}</td>
            <td className="px-4 py-2">
              <span
                className={`inline-flex items-center gap-1.5 ${u.online ? "text-emerald-600" : "text-slate-400"}`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${u.online ? "bg-emerald-500" : "bg-slate-300"}`}
                />
                {u.online ? "online" : "offline"}
              </span>
            </td>
            <td className="px-4 py-2">{u.deviceCount}</td>
            <td className="px-4 py-2 text-slate-500">
              {u.lastActivityAt ? new Date(u.lastActivityAt).toLocaleString() : "—"}
            </td>
            <td className="px-4 py-2">{u.messagesSent}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Events({ events }: { events: AdminEvent[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400 dark:bg-slate-800">
          <tr>
            <th className="px-4 py-2">Time</th>
            <th className="px-4 py-2">Type</th>
            <th className="px-4 py-2">Actor</th>
            <th className="px-4 py-2">Conversation</th>
          </tr>
        </thead>
        <tbody>
          {events.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                No events recorded yet
              </td>
            </tr>
          )}
          {events.map((e) => (
            <tr key={e.id} className="border-t border-slate-100 dark:border-slate-800">
              <td className="whitespace-nowrap px-4 py-2 text-slate-500">
                {new Date(e.createdAt).toLocaleTimeString()}
              </td>
              <td className="px-4 py-2 font-mono text-xs">{e.eventType}</td>
              <td className="px-4 py-2">{e.actorUserId ?? e.botId ?? "system"}</td>
              <td className="max-w-[220px] truncate px-4 py-2 font-mono text-xs text-slate-400">
                {e.conversationId ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BotPanel({
  bot,
  rules,
  onToggleBot,
  onToggleRule,
}: {
  bot: BotDto;
  rules: BotRuleDto[];
  onToggleBot: (enabled: boolean) => Promise<void>;
  onToggleRule: (ruleId: string, enabled: boolean) => Promise<void>;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div>
          <p className="font-medium">BOT · {bot.name}</p>
          <p className="text-xs text-slate-400">{bot.id}</p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={bot.enabled}
            onChange={(e) => {
              void onToggleBot(e.target.checked);
            }}
          />
          {bot.enabled ? "Enabled" : "Disabled"}
        </label>
      </div>

      <h3 className="text-sm font-semibold">Rules ({rules.length})</h3>
      <ul className="space-y-2">
        {rules.map((r) => (
          <li
            key={r.id}
            className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">
                  {r.name}{" "}
                  <span className="ml-1 rounded bg-slate-100 px-1.5 text-[10px] text-slate-500 dark:bg-slate-800">
                    priority {r.priority}
                  </span>
                </p>
                {r.description && <p className="text-xs text-slate-400">{r.description}</p>}
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={r.enabled}
                  onChange={(e) => {
                    void onToggleRule(r.id, e.target.checked);
                  }}
                />
                {r.enabled ? "on" : "off"}
              </label>
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-indigo-500">View JSON</summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] leading-relaxed text-emerald-300">
                {JSON.stringify(
                  { trigger: r.trigger, conditions: r.conditions, actions: r.actions },
                  null,
                  2,
                )}
              </pre>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
