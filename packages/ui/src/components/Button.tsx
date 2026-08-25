import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../cn";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "icon";
  children?: ReactNode;
}

const variantClasses: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "bg-brand text-on-brand shadow-sm hover:bg-brand-strong focus-visible:outline-brand-strong",
  secondary: "border border-line-strong bg-raised text-ink hover:border-brand/50 hover:bg-high",
  ghost: "bg-transparent text-ink-2 hover:bg-raised hover:text-ink",
  danger: "bg-danger-strong text-on-brand hover:bg-danger",
};

const sizeClasses: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-11 px-4 text-sm",
  icon: "h-11 w-11 p-0",
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-fast",
        "focus-visible:outline-2 focus-visible:outline-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-45",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
}
