"use client";

import { useEffect } from "react";
import { useChatStore } from "@/store/chat-store";

/**
 * Global error surface (#191): the store's `error` was write-only — bootstrap,
 * upload, member-management and delete failures all reported into it and no
 * component ever rendered it, so users saw silent no-ops. ONE dismissible
 * toast renders whatever the flows report and auto-clears so a stale failure
 * cannot outlive the session state that produced it. Positioned TOP-CENTER
 * (§64) — the old bottom strip physically covered the composer, blocking the
 * user from responding to exactly the failure it reported.
 */

const AUTO_DISMISS_MS = 8_000;

export function ErrorBanner() {
  const error = useChatStore((state) => state.error);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => useChatStore.getState().setError(null), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [error]);

  if (!error) return null;
  return (
    <div
      role="alert"
      className="pointer-events-none absolute inset-x-0 top-3 z-banner flex justify-center px-4"
    >
      <div className="animate-sheet-in pointer-events-auto flex max-w-lg items-center gap-3 rounded-xl border border-danger/30 bg-surface px-4 py-2 shadow-xl">
        <span aria-hidden className="text-danger">
          ⚠
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{error}</span>
        <button
          type="button"
          onClick={() => useChatStore.getState().setError(null)}
          className="shrink-0 rounded px-2 py-0.5 text-sm font-medium text-ink-2 hover:text-ink"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
