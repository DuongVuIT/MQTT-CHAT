"use client";

import { useEffect } from "react";
import { useChatStore } from "@/store/chat-store";

/**
 * Global error surface (#191): the store's `error` was write-only — bootstrap,
 * upload, member-management and delete failures all reported into it and no
 * component ever rendered it, so users saw silent no-ops. ONE dismissible
 * banner renders whatever the flows report and auto-clears so a stale failure
 * cannot outlive the session state that produced it.
 */

const AUTO_DISMISS_MS = 8_000;

export function ErrorBanner() {
  const error = useChatStore((s) => s.error);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => useChatStore.getState().setError(null), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [error]);

  if (!error) return null;
  return (
    <div
      role="alert"
      className="absolute inset-x-0 bottom-0 z-50 flex items-center justify-between gap-3 border-t border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
    >
      <span className="min-w-0 truncate">{error}</span>
      <button
        type="button"
        onClick={() => useChatStore.getState().setError(null)}
        className="shrink-0 rounded px-2 py-0.5 font-medium hover:bg-red-100 focus-visible:ring-2 focus-visible:ring-red-400 focus:outline-none dark:hover:bg-red-900"
      >
        Dismiss
      </button>
    </div>
  );
}
