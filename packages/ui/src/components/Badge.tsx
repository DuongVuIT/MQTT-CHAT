import type { ReactNode } from "react";
import { cn } from "../cn";

export interface BadgeProps {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  className?: string;
}

const tones = {
  neutral: "bg-raised text-ink-2",
  success: "bg-ok-soft text-ok",
  warning: "bg-raised text-warn",
  danger: "bg-danger-soft text-danger",
  info: "bg-brand-soft text-brand-strong",
} as const;

export function Badge({ children, tone = "neutral", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
