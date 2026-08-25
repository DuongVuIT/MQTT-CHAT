import type { InputHTMLAttributes } from "react";
import { cn } from "../cn";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-xl border border-line bg-raised px-3.5 text-sm text-ink",
        "placeholder:text-ink-3",
        "focus:border-brand focus:outline-2 focus:outline-offset-0 focus:outline-brand/30",
        "disabled:cursor-not-allowed disabled:bg-surface disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}
