import { describe, expect, it } from "vitest";
import { mergeMessageSnapshot } from "./index.js";

interface Row {
  id: string;
  sequence: number;
  content: string;
  deleted?: boolean;
}

describe("bootstrap message projection barrier", () => {
  it("keeps live rows that arrived while the REST snapshot was in flight", () => {
    const snapshot: Row[] = [{ id: "m1", sequence: 1, content: "one" }];
    const live: Row[] = [{ id: "m2", sequence: 2, content: "two" }];

    expect(mergeMessageSnapshot(snapshot, live).map((row) => row.id)).toEqual(["m1", "m2"]);
  });

  it("lets a newer canonical row win over the stale snapshot by id", () => {
    const snapshot: Row[] = [{ id: "m1", sequence: 1, content: "old" }];
    const live: Row[] = [{ id: "m1", sequence: 1, content: "", deleted: true }];

    expect(mergeMessageSnapshot(snapshot, live)).toEqual(live);
  });

  it("always returns canonical sequence order", () => {
    const snapshot: Row[] = [{ id: "m2", sequence: 2, content: "two" }];
    const live: Row[] = [{ id: "m1", sequence: 1, content: "one" }];

    expect(mergeMessageSnapshot(snapshot, live).map((row) => row.sequence)).toEqual([1, 2]);
  });
});
