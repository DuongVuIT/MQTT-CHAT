import { describe, expect, it } from "vitest";
import { advanceMemberWatermark } from "./read-watermark";

describe("advanceMemberWatermark (canonical read state — REG-02)", () => {
  const members = [
    { userId: "alice", lastReadSequence: 5 },
    { userId: "bob", lastReadSequence: 2 },
  ];

  it("advances only the target member and returns a new array", () => {
    const next = advanceMemberWatermark(members, "alice", 9);
    expect(next).not.toBeNull();
    expect(next?.[0]).toEqual({ userId: "alice", lastReadSequence: 9 });
    expect(next?.[1]).toEqual({ userId: "bob", lastReadSequence: 2 });
    expect(next).not.toBe(members);
  });

  it("is idempotent under QoS1 redelivery (same sequence → null)", () => {
    expect(advanceMemberWatermark(members, "alice", 5)).toBeNull();
  });

  it("never moves the watermark BACKWARDS on out-of-order events", () => {
    expect(advanceMemberWatermark(members, "alice", 4)).toBeNull();
    // And the original array stays untouched.
    expect(members[0]?.lastReadSequence).toBe(5);
  });

  it("returns null for unknown members or missing member lists", () => {
    expect(advanceMemberWatermark(members, "carol", 10)).toBeNull();
    expect(advanceMemberWatermark(undefined, "alice", 10)).toBeNull();
  });

  it("rejects non-finite sequences defensively", () => {
    expect(advanceMemberWatermark(members, "alice", Number.NaN)).toBeNull();
    expect(advanceMemberWatermark(members, "alice", Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("advances from a zero watermark (fresh membership)", () => {
    const fresh = [{ userId: "bob", lastReadSequence: 0 }];
    const next = advanceMemberWatermark(fresh, "bob", 1);
    expect(next?.[0]?.lastReadSequence).toBe(1);
  });
});
