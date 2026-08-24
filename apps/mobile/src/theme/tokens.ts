/**
 * Mobile design tokens (#45) — ONE source for spacing/radius/typography and
 * the dark surface hierarchy. Screens import these instead of hardcoding
 * random values; visual parity with the web theme is intentional.
 */

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const radius = {
  sm: 8,
  md: 10,
  lg: 14,
  bubble: 18,
  avatar: 18,
} as const;

export const typography = {
  title: { fontSize: 17, fontWeight: '700' },
  screenTitle: { fontSize: 20, fontWeight: '700' },
  subtitle: { fontSize: 12, fontWeight: '400' },
  body: { fontSize: 15, fontWeight: '400' },
  meta: { fontSize: 11, fontWeight: '400' },
} as const;

/** Dark surface hierarchy (slate ramp) + semantic accents. */
export const colors = {
  background: '#0f172a',
  surface: '#1e293b',
  surfaceRaised: '#334155',
  border: '#1e293b',

  textPrimary: '#f8fafc',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',

  primary: '#6366f1',
  primarySoft: 'rgba(99, 102, 241, 0.15)',
  onPrimary: '#ffffff',

  danger: '#ef4444',
  dangerSoft: 'rgba(239, 68, 68, 0.12)',

  success: '#34d399',
  warning: '#fbbf24',

  presenceOnline: '#34d399',
  presenceOffline: '#475569',
} as const;
