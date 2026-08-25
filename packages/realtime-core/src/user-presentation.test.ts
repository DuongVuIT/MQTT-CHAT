import { describe, expect, it } from "vitest";
import {
  AVATAR_PALETTE,
  avatarColorHex,
  avatarPaletteIndex,
  hashIdentityKey,
  initialsFromDisplayName,
  userPresentation,
} from "./user-presentation";

describe("userPresentation (cross-client avatar parity — REG-05)", () => {
  it("derives the color from the stable key only", () => {
    // Same id + wildly different display names MUST land on the same color:
    // web used to hash the display name while mobile hashed the id.
    expect(avatarColorHex("alice")).toBe(avatarColorHex("alice"));
    expect(userPresentation("alice", "Alice").colorHex).toBe(
      userPresentation("alice", "Alice Nguyen").colorHex,
    );
    expect(userPresentation("alice", "Alice").colorHex).toBe(
      userPresentation("alice", null).colorHex,
    );
    expect(userPresentation("alice", "Alice").colorHex).not.toBe(
      userPresentation("bob", "Alice").colorHex,
    );
  });

  it("stays inside the palette for arbitrary keys", () => {
    const keys = ["duong", "alice", "bob", "john", "", "chat-bot", "x".repeat(500)];
    for (const key of keys) {
      const idx = avatarPaletteIndex(key);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(AVATAR_PALETTE.length);
      expect(AVATAR_PALETTE).toContain(avatarColorHex(key));
    }
  });

  it("hashes unsigned so sign bits cannot skew the modulo", () => {
    // djb2 with |0 arithmetic goes negative on long keys; the >>>0 normalize
    // keeps every key mapping into [0, palette.length).
    for (const key of ["a", "ab", "abcdefghij", "z".repeat(64)]) {
      expect(hashIdentityKey(key)).toBeGreaterThanOrEqual(0);
    }
  });

  it("derives initials from up to two words of the display name", () => {
    expect(initialsFromDisplayName("Duong")).toBe("D");
    expect(initialsFromDisplayName("duong van nguyen")).toBe("DV");
    expect(initialsFromDisplayName("  Alice   B ")).toBe("AB");
    expect(initialsFromDisplayName("")).toBe("?");
    expect(initialsFromDisplayName(null)).toBe("?");
    expect(initialsFromDisplayName(undefined)).toBe("?");
  });

  it("is deterministic across repeated calls (no per-render drift)", () => {
    const first = userPresentation("conv-123", "Design Group");
    for (let i = 0; i < 5; i += 1) {
      expect(userPresentation("conv-123", "Design Group")).toEqual(first);
    }
  });
});
