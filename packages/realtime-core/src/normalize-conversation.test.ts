import { describe, expect, it } from "vitest";
import { normalizeConversation, upsertConversationInto } from "./index";

/**
 * Regression tests for canonical conversation normalization + upsert
 * (Web→Mobile group discovery lifecycle). Historical crash class:
 * conversation.members.find on incomplete payloads; duplicate entities from
 * blind appends.
 */

describe("normalizeConversation", () => {
  it("payload without members normalizes members to [] (never undefined)", () => {
    const c = normalizeConversation({ id: "c1", type: "GROUP", title: "g" });
    expect(c.members).toEqual([]);
    expect(c.memberCount).toBe(0);
  });

  it("members are validated — malformed entries dropped", () => {
    const c = normalizeConversation({
      id: "c1",
      type: "GROUP",
      members: [
        { userId: "user-a", role: "ADMIN", lastReadSequence: 3 },
        { role: "MEMBER" }, // no userId → dropped
        null,
        "junk",
        { userId: "user-b" }, // defaults applied
      ],
    });
    expect(c.members).toEqual([
      { userId: "user-a", role: "ADMIN", lastReadSequence: 3 },
      { userId: "user-b", role: "MEMBER", lastReadSequence: 0 },
    ]);
  });

  it("non-object input yields an inert entity without throwing", () => {
    expect(() => normalizeConversation(null)).not.toThrow();
    expect(normalizeConversation(undefined).id).toBe("");
    expect(normalizeConversation("junk").members).toEqual([]);
  });

  it("DIRECT type preserved; unknown type falls back to GROUP", () => {
    expect(normalizeConversation({ id: "c", type: "DIRECT" }).type).toBe("DIRECT");
    expect(normalizeConversation({ id: "c", type: "WEIRD" }).type).toBe("GROUP");
  });
});

describe("upsertConversationInto", () => {
  const conv = (id: string, seq = 0) =>
    normalizeConversation({
      id,
      type: "GROUP",
      title: id,
      lastSequence: seq,
      members: [{ userId: "user-a" }],
    });

  it("same conversation received twice collapses to ONE entity", () => {
    let list: ReturnType<typeof normalizeConversation>[] = [];
    list = upsertConversationInto(list, conv("c1"));
    list = upsertConversationInto(list, conv("c1"));
    expect(list).toHaveLength(1);
  });

  it("membership event (no message info) preserves locally-known activity", () => {
    const active = normalizeConversation({
      id: "c1",
      type: "GROUP",
      title: "c1",
      lastSequence: 7,
      lastMessagePreview: "hello",
      lastMessageAt: "2026-08-24T00:00:00.000Z",
      members: [{ userId: "user-a" }],
    });
    const stale = normalizeConversation({
      id: "c1",
      type: "GROUP",
      title: "c1",
      lastSequence: 0,
      members: [{ userId: "user-a" }, { userId: "user-b" }],
    });
    const merged = upsertConversationInto([active], stale)[0]!;
    expect(merged.members).toHaveLength(2); // membership updated
    expect(merged.lastSequence).toBe(7); // activity preserved, never regressed
    expect(merged.lastMessagePreview).toBe("hello");
    expect(merged.lastMessageAt).toBe("2026-08-24T00:00:00.000Z");
  });

  it("new conversations are prepended (most recent first)", () => {
    const list = upsertConversationInto([conv("old")], conv("new"));
    expect(list.map((c) => c.id)).toEqual(["new", "old"]);
  });
});
