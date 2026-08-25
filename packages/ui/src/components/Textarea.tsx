import type { TextareaHTMLAttributes } from "react";
import { cn } from "../cn";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        "w-full resize-none rounded-xl border border-line bg-raised px-3.5 py-2.5 text-sm text-ink",
        "placeholder:text-ink-3",
        "focus:border-brand focus:outline-2 focus:outline-offset-0 focus:outline-brand/30",
        "disabled:cursor-not-allowed disabled:bg-surface disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}
