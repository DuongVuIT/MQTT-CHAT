/**
 * ONE canonical media-type policy shared by every layer (repair-log #26):
 *
 *   picker/platform MIME
 *     → normalizeMediaType()      // alias + case + parameter folding
 *     → isAllowedMediaType()      // authoritative allowlist membership
 *     → upload / message.metadata.mimeType (ALWAYS the canonical value)
 *
 * Clients must NEVER string-compare a raw picker MIME against the allowlist:
 * iOS reports JPEG as `image/jpg`, some browsers append parameters, and
 * Android may report empty MIME (derive from filename extension instead).
 */

/** Types the product accepts — server-authoritative, client-mirrored. */
export const CANONICAL_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
  "audio/webm",
  "audio/mpeg",
  "application/pdf",
] as const;

export type CanonicalMediaType = (typeof CANONICAL_MEDIA_TYPES)[number];

/**
 * Platform/picker spellings that denote a canonical type. `image/jpg` is the
 * classic iOS PHPickerViewController alias for image/jpeg — rejecting it made
 * normal photos unsharable on Mobile (#26). HEIC/HEIF is deliberately NOT
 * aliased: the product intentionally does not accept it yet, so callers can
 * show a precise "convert to JPEG" product error instead of a generic one.
 */
export const MEDIA_TYPE_ALIASES: Readonly<Record<string, CanonicalMediaType>> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/pipeg": "image/jpeg",
};

/** File extensions → canonical type (fallback when MIME metadata is absent). */
const EXTENSION_MEDIA_TYPES: Readonly<Record<string, CanonicalMediaType>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
  weba: "audio/webm",
  mp3: "audio/mpeg",
  mpeg3: "audio/mpeg",
  pdf: "application/pdf",
};

/**
 * Fold any platform MIME spelling onto its canonical form:
 * lowercase, strip parameters (`image/jpeg;charset=binary`), apply aliases.
 * Returns the normalized string even when not allow-listed — membership is
 * a separate decision so callers can distinguish "unknown type" from
 * "known-but-unsupported" (e.g. image/heic).
 */
export function normalizeMediaType(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const base = raw.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!base) return null;
  return MEDIA_TYPE_ALIASES[base] ?? base;
}

/** Narrow an already-normalized string to the canonical union when allow-listed. */
function asCanonicalMediaType(value: string | null): CanonicalMediaType | null {
  return value !== null && (CANONICAL_MEDIA_TYPES as readonly string[]).includes(value)
    ? (value as CanonicalMediaType)
    : null;
}

/** Authoritative check: would this raw MIME be accepted for upload? */
export function isAllowedMediaType(raw: string | null | undefined): boolean {
  return asCanonicalMediaType(normalizeMediaType(raw)) !== null;
}

/** Derive a canonical MIME from a filename extension (null when unknown). */
export function mediaTypeFromFilename(
  filename: string | null | undefined,
): CanonicalMediaType | null {
  if (!filename) return null;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MEDIA_TYPES[ext] ?? null;
}

/**
 * Resolve the best-known media type from picker metadata:
 * explicit MIME (normalized) wins; filename extension is the fallback.
 */
export function resolveMediaType(
  rawMimeType: string | null | undefined,
  filename?: string | null,
): CanonicalMediaType | null {
  const canonical = asCanonicalMediaType(normalizeMediaType(rawMimeType));
  if (canonical) return canonical;
  if (normalizeMediaType(rawMimeType) === null && filename) {
    return mediaTypeFromFilename(filename);
  }
  return null;
}
