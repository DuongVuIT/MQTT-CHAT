import { describe, expect, it, vi } from "vitest";
import { RealtimeService } from "@/lib/realtime-service";

describe("RealtimeService identity teardown", () => {
  it("shares concurrent disconnects and publishes offline once", async () => {
    let releasePresence: (() => void) | undefined;
    const presenceGate = new Promise<void>((resolve) => {
      releasePresence = resolve;
    });
    const core = {
      status: "connected",
      setPresence: vi.fn(() => presenceGate),
      disconnect: vi.fn(async () => {}),
    };
    const service = new RealtimeService();
    Object.assign(service, {
      core,
      identity: { userId: "duong", deviceId: "web-a" },
    });

    const first = service.disconnect();
    const second = service.disconnect();
    expect(core.setPresence).toHaveBeenCalledTimes(1);

    releasePresence?.();
    await Promise.all([first, second]);

    expect(core.disconnect).toHaveBeenCalledTimes(1);
  });
});
