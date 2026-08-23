import type { InputHTMLAttributes } from "react";
import { cn } from "../cn";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900",
        "placeholder:text-slate-400",
        "focus:border-blue-500 focus:outline-2 focus:outline-offset-0 focus:outline-blue-500/40",
        "disabled:cursor-not-allowed disabled:bg-slate-100",
        "dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500",
        className,
      )}
      {...props}
    />
  );
}
