import { describe, expect, it } from "vitest";
import { brokerClientId } from "./index.js";

describe("MQTT broker client identity", () => {
  it("includes logical identity and a per-connection nonce", () => {
    expect(brokerClientId({ userId: "alice", deviceId: "web-a" }, "nonce-1")).toBe(
      "alice:web-a:nonce-1",
    );
  });

  it("does not collide across rapid connections", () => {
    const ids = new Set(
      Array.from({ length: 100 }, () => brokerClientId({ userId: "alice", deviceId: "web-a" })),
    );
    expect(ids.size).toBe(100);
  });
});
