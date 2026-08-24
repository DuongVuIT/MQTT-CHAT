import { cn } from "../cn";

export type ConnectionState =
  "connecting" | "connected" | "reconnecting" | "disconnected" | "error";

export interface ConnectionBadgeProps {
  state: ConnectionState;
  className?: string;
}

const labels: Record<ConnectionState, string> = {
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting…",
  disconnected: "Offline",
  error: "Connection error",
};

const tones: Record<ConnectionState, string> = {
  connecting: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300",
  connected: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300",
  reconnecting: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300",
  disconnected: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300",
  error: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300",
};

/**
 * Connection state, product-subtle (phase-2 §29): normal operation renders a
 * tiny status dot only — a full "Connected" pill must never dominate the
 * header. Degraded states escalate to a labelled pill.
 */
export function ConnectionBadge({ state, className }: ConnectionBadgeProps) {
  if (state === "connected") {
    return (
      <span
        role="status"
        aria-label="Connected"
        aria-live="polite"
        className={cn("inline-flex h-2.5 w-2.5 items-center justify-center", className)}
      >
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-500" />
      </span>
    );
  }
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        tones[state],
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("h-2 w-2 rounded-full", state === "error" ? "bg-red-500" : "bg-amber-500")}
      />
      {labels[state]}
    </span>
  );
}
