import { describe, expect, it } from "vitest";
import {
  CANONICAL_MEDIA_TYPES,
  isAllowedMediaType,
  mediaTypeFromFilename,
  normalizeMediaType,
  resolveMediaType,
} from "./media";

/**
 * Canonical media-type policy regression (#26): platform MIME spellings must
 * fold onto canonical values BEFORE any allowlist check. Rejecting
 * `image/jpg` made normal iOS photos unsharable.
 */
describe("normalizeMediaType", () => {
  it("aliases image/jpg → image/jpeg (iOS picker spelling)", () => {
    expect(normalizeMediaType("image/jpg")).toBe("image/jpeg");
  });

  it("aliases progressive-jpeg spellings", () => {
    expect(normalizeMediaType("image/pjpeg")).toBe("image/jpeg");
    expect(normalizeMediaType("image/pipeg")).toBe("image/jpeg");
  });

  it("lowercases and strips MIME parameters", () => {
    expect(normalizeMediaType("IMAGE/JPEG;charset=binary")).toBe("image/jpeg");
    expect(normalizeMediaType(" Image/PNG ")).toBe("image/png");
  });

  it("passes canonical values through untouched", () => {
    for (const t of CANONICAL_MEDIA_TYPES) {
      expect(normalizeMediaType(t)).toBe(t);
    }
  });

  it("keeps unknown types normalized but NOT allow-listed (heic is intentional)", () => {
    expect(normalizeMediaType("image/heic")).toBe("image/heic");
    expect(isAllowedMediaType("image/heic")).toBe(false);
  });

  it("handles null/undefined/empty", () => {
    expect(normalizeMediaType(null)).toBeNull();
    expect(normalizeMediaType(undefined)).toBeNull();
    expect(normalizeMediaType("")).toBeNull();
    expect(normalizeMediaType(";charset=x")).toBeNull();
  });
});

describe("isAllowedMediaType", () => {
  it("accepts every canonical type through raw aliases and casing", () => {
    expect(isAllowedMediaType("image/jpeg")).toBe(true);
    expect(isAllowedMediaType("image/jpg")).toBe(true);
    expect(isAllowedMediaType("Image/JPG;quality=high")).toBe(true);
    expect(isAllowedMediaType("application/pdf")).toBe(true);
  });

  it("rejects unknown/unsupported types deterministically", () => {
    expect(isAllowedMediaType("image/heic")).toBe(false);
    expect(isAllowedMediaType("application/zip")).toBe(false);
    expect(isAllowedMediaType(null)).toBe(false);
  });
});

describe("mediaTypeFromFilename / resolveMediaType", () => {
  it("derives canonical MIME from extensions including .jpg", () => {
    expect(mediaTypeFromFilename("photo.JPG")).toBe("image/jpeg");
    expect(mediaTypeFromFilename("doc.pdf")).toBe("application/pdf");
    expect(mediaTypeFromFilename("clip.webm")).toBe("video/webm");
    expect(mediaTypeFromFilename("mystery.zzz")).toBeNull();
    expect(mediaTypeFromFilename(null)).toBeNull();
  });

  it("resolveMediaType prefers explicit MIME then falls back to filename", () => {
    // iOS alias + real filename → canonical jpeg.
    expect(resolveMediaType("image/jpg", "photo.jpg")).toBe("image/jpeg");
    // Android null MIME → extension decides.
    expect(resolveMediaType(null, "photo.jpg")).toBe("image/jpeg");
    expect(resolveMediaType("", "unknown.bin")).toBeNull();
    // Explicit unsupported MIME is NOT rescued by a known filename ext.
    expect(resolveMediaType("image/heic", "photo.jpg")).toBeNull();
  });
});
