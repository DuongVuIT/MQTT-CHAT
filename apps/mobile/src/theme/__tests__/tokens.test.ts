import { avatarColorFor } from "@app/theme/tokens";
import {
  avatarColorHex,
  avatarPaletteIndex,
  initialsFromDisplayName,
} from "@mqtt-chat/realtime-core";

/**
 * REG-05 (2026-08-25): mobile used to hash display names with djb2 over its
 * own AVATAR_PAIRS while web hashed them with hash*31 over tailwind classes —
 * the same user wore different colors per platform. The mobile adapter MUST
 * stay a thin delegation onto the shared canonical algorithm.
 */

describe("mobile avatar parity with the canonical presentation", () => {
  const keys = ["duong", "alice", "bob", "john", "chat-bot", "conv-abc123", ""];

  it.each(keys)("adapter bg equals shared avatarColorHex for %s", (key) => {
    expect(avatarColorFor(key).bg).toBe(avatarColorHex(key));
  });

  it("stays inside the shared palette bounds", () => {
    for (const key of keys) {
      expect(avatarPaletteIndex(key)).toBeGreaterThanOrEqual(0);
    }
  });

  it("is deterministic across calls (no per-render drift)", () => {
    expect(avatarColorFor("duong")).toEqual(avatarColorFor("duong"));
  });

  it("uses the shared initials rule", () => {
    expect(initialsFromDisplayName("Duong Van")).toBe("DV");
    expect(initialsFromDisplayName("Alice")).toBe("A");
  });
});
