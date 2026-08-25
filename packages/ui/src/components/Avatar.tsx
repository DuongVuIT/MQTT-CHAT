import { cn } from "../cn";
import { initialsFromDisplayName, avatarColorHex } from "@mqtt-chat/realtime-core";

export interface AvatarProps {
  /** Initials source — display name (never affects the color). */
  name: string;
  /**
   * Stable identity the color derives from: userId for people, conversationId
   * for groups. REQUIRED so web and mobile always render the same color for
   * the same identity (REG-05 — web used to hash the display name with a
   * different algorithm/palette than mobile).
   */
  colorKey: string;
  size?: "sm" | "md" | "lg";
  online?: boolean;
  className?: string;
}

const sizeClasses = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-lg",
} as const;

export function Avatar({ name, colorKey, size = "md", online, className }: AvatarProps) {
  // Shared canonical presentation — same hash + palette as mobile.
  const background = avatarColorHex(colorKey);
  const initials = initialsFromDisplayName(name);

  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <span
        aria-hidden="true"
        style={{ backgroundColor: background }}
        className={cn(
          "inline-flex items-center justify-center rounded-full font-semibold text-white select-none",
          sizeClasses[size],
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
