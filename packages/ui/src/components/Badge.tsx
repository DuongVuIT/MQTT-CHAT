import type { ReactNode } from "react";
import { cn } from "../cn";

export interface BadgeProps {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  className?: string;
}

const tones = {
  neutral: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  success: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300",
  danger: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300",
  info: "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300",
} as const;

export function Badge({ children, tone = "neutral", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
