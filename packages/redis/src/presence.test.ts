import { describe, expect, it, vi } from "vitest";
import { PresenceRepository, type RedisClient } from "./index.js";

function redisDouble(overrides: Record<string, unknown>): RedisClient {
  return {
    set: vi.fn(async () => "OK"),
    sadd: vi.fn(async () => 1),
    del: vi.fn(async () => 1),
    srem: vi.fn(async () => 1),
    smembers: vi.fn(async () => []),
    get: vi.fn(async () => null),
    ...overrides,
  } as unknown as RedisClient;
}

describe("PresenceRepository idempotent transitions", () => {
  it("marks a duplicate online command as unchanged", async () => {
    const repository = new PresenceRepository(
      redisDouble({
        sadd: vi.fn(async () => 0),
        smembers: vi.fn(async () => ["web-a"]),
      }),
    );

    const transition = await repository.addConnection("alice", "web-a");

    expect(transition.changed).toBe(false);
    expect(transition.info.online).toBe(true);
  });

  it("marks a duplicate offline command/LWT as unchanged", async () => {
    const repository = new PresenceRepository(
      redisDouble({
        del: vi.fn(async () => 0),
        srem: vi.fn(async () => 0),
      }),
    );

    const transition = await repository.removeConnection("alice", "web-a");

    expect(transition.changed).toBe(false);
    expect(transition.info.online).toBe(false);
  });

  it("reports real device membership changes", async () => {
    const repository = new PresenceRepository(redisDouble({}));

    expect((await repository.addConnection("alice", "web-a")).changed).toBe(true);
    expect((await repository.removeConnection("alice", "web-a")).changed).toBe(true);
  });
});
