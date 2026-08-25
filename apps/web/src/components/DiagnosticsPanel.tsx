"use client";

import { useEffect, useState } from "react";
import { CloseIcon, SettingsIcon } from "@/components/icons";
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
  const connectionState = useChatStore((state) => state.connectionState);
  const identity = useChatStore((state) => state.identity);
  const conversations = useChatStore((state) => state.conversations);
  const activeConversationId = useChatStore((state) => state.activeConversationId);
  const pendingCount = useChatStore((state) => state.pendingMessages.length);
  const lastSequence = useChatStore((state) =>
    activeConversationId
      ? (state.conversations.find((conversation) => conversation.id === activeConversationId)
          ?.lastSequence ?? 0)
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
          setOpen((currentValue) => !currentValue);
        }}
        className="flex items-center gap-2 rounded-full border border-line-strong bg-surface/95 px-3 py-2 text-ink-2 shadow-floating hover:bg-raised hover:text-ink"
        aria-expanded={open}
      >
        {open ? <CloseIcon className="h-3.5 w-3.5" /> : <SettingsIcon className="h-3.5 w-3.5" />}
        <span>Diagnostics</span>
      </button>
      {open && (
        <dl className="mt-2 max-h-80 w-80 overflow-y-auto rounded-xl bg-slate-950/95 p-3 leading-relaxed text-slate-300 shadow-xl ring-1 ring-slate-700">
          <Row
            label="origin"
            value={typeof window === "undefined" ? "—" : window.location.origin}
          />
          <Row label="api" value={API_URL} />
          <Row label="mqtt" value={connectionState} />
          <Row label="userId" value={identity?.userId ?? "—"} />
          <Row label="deviceId" value={identity?.deviceId ?? "—"} />
          <Row label="conversations" value={String(conversations.length)} />
          <Row label="activeConv" value={activeConversationId ?? "—"} />
          <Row label="lastSequence" value={String(lastSequence)} />
          <Row label="pendingQueue" value={String(pendingCount)} />
          <Row label="lastEvent" value={lastEvent ?? "—"} />
        </dl>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="inline text-slate-500">{label}: </dt>
      <dd className="inline break-all">{value}</dd>
      <br />
    </>
  );
}
