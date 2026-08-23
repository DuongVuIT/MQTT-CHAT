import type { TextareaHTMLAttributes } from "react";
import { cn } from "../cn";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        "w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900",
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
