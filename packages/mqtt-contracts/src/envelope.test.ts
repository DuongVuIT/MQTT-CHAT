import { describe, expect, it } from "vitest";
import { commandEnvelopeSchema, eventEnvelopeSchema } from "./envelope.js";

const validEvent = {
  eventId: "e1",
  eventType: "message.created",
  version: 1,
  timestamp: new Date().toISOString(),
  origin: { type: "user", id: "duong" },
  data: { hello: "world" },
};

describe("eventEnvelopeSchema", () => {
  it("accepts a valid envelope", () => {
    const result = eventEnvelopeSchema.safeParse(validEvent);
    expect(result.success).toBe(true);
  });

  it("rejects missing eventType", () => {
    const { eventType: _eventType, ...rest } = validEvent;
    expect(eventEnvelopeSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects invalid origin type", () => {
    expect(
      eventEnvelopeSchema.safeParse({ ...validEvent, origin: { type: "alien" } }).success,
    ).toBe(false);
  });
});

describe("commandEnvelopeSchema", () => {
  it("accepts a valid command envelope", () => {
    const result = commandEnvelopeSchema.safeParse({
      requestId: "r1",
      commandType: "message.send",
      version: 1,
      timestamp: new Date().toISOString(),
      actor: { userId: "duong", deviceId: "web-01" },
      data: {},
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing actor", () => {
    expect(
      commandEnvelopeSchema.safeParse({
        requestId: "r1",
        commandType: "message.send",
        version: 1,
        timestamp: new Date().toISOString(),
        data: {},
      }).success,
    ).toBe(false);
  });
});
