/**
 * Mobile design tokens v2 — the ONE source of truth for the product's
 * visual language (phase-2 design system). Semantic, not decorative: every
 * screen consumes these instead of hardcoding hex values, so web and mobile
 * read as the same product (the values mirror apps/web/src/app/globals.css).
 *
 * Layers: base ramp (background/surfaces/borders) → text tiers → brand →
 * semantic states → presence → spacing/radius/typography → motion →
 * elevation/z-index → avatar identity palette.
 */

import { avatarColorHex } from '@mqtt-chat/realtime-core';

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------

export const colors = {
  // Base ramp — layered dark surfaces (never pure black; each layer is one
  // visible step above the last so elevation reads without borders).
  background: '#0B1220',
  surface: '#131C30',
  surfaceRaised: '#1C2942',
  surfaceHigh: '#263554',
  border: '#1D2A45',
  borderStrong: '#2C3B5F',

  // Text tiers
  textPrimary: '#F2F6FD',
  textSecondary: '#9AA9C7',
  textMuted: '#5E6E8F',

  // Brand — ONE indigo (the historical #4f46e5/#6366f1 split is collapsed).
  primary: '#6366F1',
  primaryStrong: '#818CF8',
  primarySoft: 'rgba(99, 102, 241, 0.16)',
  onPrimary: '#FFFFFF',

  // Semantic states
  success: '#34D399',
  successSoft: 'rgba(52, 211, 153, 0.14)',
  warning: '#FBBF24',
  danger: '#F87171',
  dangerStrong: '#EF4444',
  dangerSoft: 'rgba(248, 113, 113, 0.13)',
  onDanger: '#FFFFFF',

  // Presence
  presenceOnline: '#34D399',
  presenceOffline: '#44546B',

  // Overlays / scrims
  scrim: 'rgba(4, 9, 20, 0.62)',
  backdrop: 'rgba(2, 6, 23, 0.6)',
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
  display: { fontSize: 26, fontWeight: '700' },
  screenTitle: { fontSize: 20, fontWeight: '700' },
  title: { fontSize: 17, fontWeight: '600' },
  subtitle: { fontSize: 13, fontWeight: '500' },
  body: { fontSize: 15, fontWeight: '400' },
  caption: { fontSize: 12, fontWeight: '400' },
  meta: { fontSize: 11, fontWeight: '500' },
} as const;

// ---------------------------------------------------------------------------
// Motion (§39) — semantic timing only; no random durations in feature files.
// ---------------------------------------------------------------------------

export const motion = {
  fast: 130,
  normal: 200,
  slow: 300,
} as const;

export const easing = {
  /** Material-emulate standard — balanced accel/decel for moves/fades. */
  standard: 'cubic(0.4, 0, 0.2, 1)',
  /** Enter: decelerate — things arriving lose speed gently. */
  enter: 'cubic(0, 0, 0.2, 1)',
  /** Exit: accelerate — things leaving pick up and go. */
  exit: 'cubic(0.4, 0, 1, 1)',
} as const;

// ---------------------------------------------------------------------------
// Elevation (shadows are subtle on dark — hairline + soft ambient)
// ---------------------------------------------------------------------------

export const elevation = {
  card: {
    shadowColor: '#000000',
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  floating: {
    shadowColor: '#000000',
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
// Avatar identity palette — DELEGATED to the canonical presentation helper in
// @mqtt-chat/realtime-core. Web and mobile MUST hash the same key with the
// same algorithm over the same palette, or the same user renders different
// colors per platform (REG-05). Keys: userId for people, conversationId for
// conversation avatars — never display names.
// ---------------------------------------------------------------------------

/** White text on every 600-weight palette entry stays readable on both platforms. */
const AVATAR_FG = '#FFFFFF';

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
