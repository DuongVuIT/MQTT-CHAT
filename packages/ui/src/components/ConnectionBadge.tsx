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
  connecting: "bg-raised text-warn",
  connected: "bg-ok-soft text-ok",
  reconnecting: "bg-raised text-warn",
  disconnected: "bg-raised text-ink-2",
  error: "bg-danger-soft text-danger",
};

/**
 * Healthy connections stay quiet; degraded states receive a readable label.
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
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-full bg-presence shadow-[0_0_0_3px_var(--ok-soft)]"
        />
      </span>
    );
  }
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        tones[state],
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("h-2 w-2 rounded-full", state === "error" ? "bg-danger" : "bg-warn")}
      />
      {labels[state]}
    </span>
  );
}
