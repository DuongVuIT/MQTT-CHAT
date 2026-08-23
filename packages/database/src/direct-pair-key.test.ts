import { describe, expect, it } from "vitest";
import { directPairKeyFor } from "./index.js";

describe("directPairKeyFor", () => {
  it("is order-independent", () => {
    expect(directPairKeyFor("usr_aaa", "usr_bbb")).toBe(directPairKeyFor("usr_bbb", "usr_aaa"));
  });

  it("sorts ids so the key is canonical", () => {
    expect(directPairKeyFor("usr_bbb", "usr_aaa")).toBe("usr_aaa:usr_bbb");
  });

  it("works with arbitrary runtime ids (no hardcoded users)", () => {
    const a = `usr_${Math.random().toString(36).slice(2)}`;
    const b = `usr_${Math.random().toString(36).slice(2)}`;
    expect(directPairKeyFor(a, b)).toBe([a, b].sort().join(":"));
  });

  it("rejects identical members", () => {
    expect(() => directPairKeyFor("same", "same")).toThrow();
  });
});
