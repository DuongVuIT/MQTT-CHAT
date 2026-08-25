/**
 * Canonical user presentation — ONE deterministic algorithm for every client.
 *
 * REGRESSION ROOT CAUSE (2026-08-25): web (packages/ui Avatar) hashed the
 * display name with `hash*31+c` over a tailwind palette while mobile hashed a
 * caller-chosen key (display title for DMs, userId elsewhere) with djb2 over
 * a different palette — the same user rendered different colors/initials on
 * the two clients. Identity presentation MUST derive from the stable user id
 * (AGENTS §20: never infer identity from display names).
 *
 * Contract:
 *   colorKey = userId for humans/bots, conversationId for group avatars.
 *   displayName feeds initials ONLY — never the color.
 * Same key ⇒ same palette entry on web and mobile, forever.
 */

/** Mid-luminance 600-weight hexes — white foreground stays readable on both
 * the web dark theme and the mobile light/dark surfaces. */
export const AVATAR_PALETTE: readonly string[] = [
  "#2563eb", // blue-600
  "#7c3aed", // violet-600
  "#db2777", // pink-600
  "#ea580c", // orange-600
  "#16a34a", // green-600
  "#0891b2", // cyan-600
  "#a16207", // yellow-700
  "#dc2626", // red-600
] as const;

/** Unsigned djb2 — identical arithmetic in JS on every platform. */
export function hashIdentityKey(key: string): number {
  let hash = 5381;
  for (let i = 0; i < key.length; i += 1) {
    hash = (((hash << 5) + hash) | 0) + (key.charCodeAt(i) | 0);
    hash = hash >>> 0; // keep unsigned so sign bits never skew the modulo
  }
  return hash >>> 0;
}

/** Deterministic palette index for a color key. */
export function avatarPaletteIndex(colorKey: string): number {
  return Number(hashIdentityKey(colorKey) % AVATAR_PALETTE.length);
}

/** Deterministic background hex for a color key. */
export function avatarColorHex(colorKey: string): string {
  return AVATAR_PALETTE[avatarPaletteIndex(colorKey)] ?? AVATAR_PALETTE[0]!;
}

/**
 * Initials from a display name: first character of up to two words,
 * uppercased ("duong van a" → "DA", "Alice" → "A"). Empty/space-only names
 * fall back to "?" — never an empty label.
 */
export function initialsFromDisplayName(displayName: string | null | undefined): string {
  const parts = (displayName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const initials = parts
    .slice(0, 2)
    .map((part) => part.charAt(0)?.toUpperCase() ?? "")
    .join("");
  return initials.length > 0 ? initials : "?";
}

export interface UserPresentation {
  /** Stable color key (userId / conversationId) the presentation derives from. */
  colorKey: string;
  /** Deterministic background hex — identical across clients. */
  colorHex: string;
  /** Initials derived from the display name (never affects the color). */
  initials: string;
}

export function userPresentation(
  colorKey: string,
  displayName: string | null | undefined,
): UserPresentation {
  return {
    colorKey,
    colorHex: avatarColorHex(colorKey),
    initials: initialsFromDisplayName(displayName),
  };
}
