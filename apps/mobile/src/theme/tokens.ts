/** Shared visual tokens for every mobile screen. */

import { avatarColorHex } from "@mqtt-chat/realtime-core";

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------

export const colors = {
  background: "#07101F",
  surface: "#0D1829",
  surfaceRaised: "#15243A",
  surfaceHigh: "#1D3150",
  border: "#1C2D47",
  borderStrong: "#314766",

  // Text tiers
  textPrimary: "#F7F9FD",
  textSecondary: "#AAB8CF",
  textMuted: "#71819B",

  primary: "#5B7CFA",
  primaryStrong: "#86A0FF",
  primarySoft: "rgba(91, 124, 250, 0.16)",
  accent: "#32D3A2",
  accentSoft: "rgba(50, 211, 162, 0.14)",
  onPrimary: "#FFFFFF",

  // Semantic states
  success: "#32D3A2",
  successSoft: "rgba(50, 211, 162, 0.14)",
  warning: "#FBBF24",
  danger: "#F87171",
  dangerStrong: "#EF4444",
  dangerSoft: "rgba(248, 113, 113, 0.13)",
  onDanger: "#FFFFFF",

  // Presence
  presenceOnline: "#32D3A2",
  presenceOffline: "#44546B",

  // Overlays / scrims
  scrim: "rgba(4, 9, 20, 0.62)",
  backdrop: "rgba(2, 6, 23, 0.6)",
} as const;

// ---------------------------------------------------------------------------
// Spacing / radius / typography
// ---------------------------------------------------------------------------

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  bubble: 18,
  avatar: 22,
  sheet: 20,
  full: 999,
} as const;

export const typography = {
  display: { fontSize: 30, lineHeight: 36, fontWeight: "700", letterSpacing: -0.7 },
  screenTitle: { fontSize: 22, lineHeight: 28, fontWeight: "700", letterSpacing: -0.35 },
  title: { fontSize: 17, lineHeight: 23, fontWeight: "600", letterSpacing: -0.15 },
  subtitle: { fontSize: 13, lineHeight: 19, fontWeight: "500" },
  body: { fontSize: 15, lineHeight: 22, fontWeight: "400" },
  caption: { fontSize: 12, lineHeight: 17, fontWeight: "400" },
  meta: { fontSize: 11, lineHeight: 15, fontWeight: "600", letterSpacing: 0.2 },
} as const;

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

export const motion = {
  fast: 130,
  normal: 200,
  slow: 300,
} as const;

export const easing = {
  standard: "cubic(0.4, 0, 0.2, 1)",
  enter: "cubic(0, 0, 0.2, 1)",
  exit: "cubic(0.4, 0, 1, 1)",
} as const;

// ---------------------------------------------------------------------------
// Elevation (shadows are subtle on dark — hairline + soft ambient)
// ---------------------------------------------------------------------------

export const elevation = {
  card: {
    shadowColor: "#000000",
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  floating: {
    shadowColor: "#000000",
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
} as const;

export const zIndex = {
  content: 0,
  sticky: 10,
  overlay: 50,
  toast: 80,
} as const;

// ---------------------------------------------------------------------------
// Avatar colors use the shared stable identity hash on Web and Mobile.
// ---------------------------------------------------------------------------

/** White text on every 600-weight palette entry stays readable on both platforms. */
const AVATAR_FG = "#FFFFFF";

/** Stable identity → avatar colors. Thin adapter over the shared algorithm. */
export function avatarColorFor(id: string): { bg: string; fg: string } {
  return { bg: avatarColorHex(id), fg: AVATAR_FG };
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

/** Apple HIG minimum touch target — every interactive element honors this. */
export const TOUCH_TARGET = 44;

/** Chat transcript max bubble width ratio (of screen) — long lines wrap. */
export const BUBBLE_MAX_RATIO = 0.78;
