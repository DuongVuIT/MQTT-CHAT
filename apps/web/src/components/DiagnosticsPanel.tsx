"use client";

import { useEffect, useState } from "react";
import { useChatStore } from "@/store/chat-store";
import { getRealtimeService } from "@/lib/realtime-service";
import { API_URL } from "@/lib/api";

/**
 * Dev-only diagnostics overlay (PROJECT_STATUS §42): public origin, API base,
 * MQTT state, active identity, conversation/sequence/pending snapshot and the
 * last canonical event — the fastest way to answer "what does the client
 * actually see?" while debugging realtime issues.
 *
 * Rendered only outside production builds; collapsed by default.
 */

export function DiagnosticsPanel() {
  const [open, setOpen] = useState(false);
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const connectionState = useChatStore((s) => s.connectionState);
  const identity = useChatStore((s) => s.identity);
  const conversations = useChatStore((s) => s.conversations);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const pendingCount = useChatStore((s) => s.pendingMessages.length);
  const lastSequence = useChatStore((s) =>
    activeConversationId
      ? (s.conversations.find((c) => c.id === activeConversationId)?.lastSequence ?? 0)
      : 0,
  );

  // Track the last canonical event while the panel is open.
  useEffect(() => {
    if (!open) return;
    return getRealtimeService().onEvent((envelope) => {
      const at = envelope.timestamp ? new Date(envelope.timestamp).toLocaleTimeString() : "";
      setLastEvent(`${envelope.eventType}${at ? ` · ${at}` : ""}`);
    });
  }, [open]);

  if (process.env.NODE_ENV === "production") return null;

  return (
    <div className="fixed bottom-3 left-3 z-50 font-mono text-xs">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
        }}
        className="rounded-full bg-slate-900 px-3 py-1 text-slate-200 shadow-lg ring-1 ring-slate-700 hover:bg-slate-800"
        aria-expanded={open}
      >
        {open ? "× diagnostics" : "⚙ diagnostics"}
      </button>
      {open && (
        <dl className="mt-2 max-h-80 w-80 overflow-y-auto rounded-xl bg-slate-950/95 p-3 leading-relaxed text-slate-300 shadow-xl ring-1 ring-slate-700">
          <Row k="origin" v={typeof window === "undefined" ? "—" : window.location.origin} />
          <Row k="api" v={API_URL} />
          <Row k="mqtt" v={connectionState} />
          <Row k="userId" v={identity?.userId ?? "—"} />
          <Row k="deviceId" v={identity?.deviceId ?? "—"} />
          <Row k="conversations" v={String(conversations.length)} />
          <Row k="activeConv" v={activeConversationId ?? "—"} />
          <Row k="lastSequence" v={String(lastSequence)} />
          <Row k="pendingQueue" v={String(pendingCount)} />
          <Row k="lastEvent" v={lastEvent ?? "—"} />
        </dl>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="inline text-slate-500">{k}: </dt>
      <dd className="inline break-all">{v}</dd>
      <br />
    </>
  );
}
