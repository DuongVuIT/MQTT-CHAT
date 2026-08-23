import { cn } from "../cn";

export interface AvatarProps {
  name: string;
  size?: "sm" | "md" | "lg";
  online?: boolean;
  className?: string;
}

const sizeClasses = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-lg",
} as const;

const palette = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
];

function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  const fallback = "bg-blue-500";
  return palette[hash % palette.length] ?? fallback;
}

export function Avatar({ name, size = "md", online, className }: AvatarProps) {
  const initials = name
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase())
    .slice(0, 2)
    .join("");

  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex items-center justify-center rounded-full font-semibold text-white select-none",
          sizeClasses[size],
          colorFor(name),
        )}
      >
        {initials}
      </span>
      {online !== undefined && (
        <span
          role="status"
          aria-label={online ? "online" : "offline"}
          className={cn(
            "absolute right-0 bottom-0 h-3 w-3 rounded-full border-2 border-white dark:border-slate-900",
            online ? "bg-emerald-500" : "bg-slate-400",
          )}
        />
      )}
    </span>
  );
}
