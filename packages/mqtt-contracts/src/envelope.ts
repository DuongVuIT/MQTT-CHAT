import { z } from "zod";

/**
 * Shared envelopes for MQTT commands and canonical events.
 * Every payload crossing the broker MUST be wrapped in one of these
 * and validated with the corresponding schema on receipt.
 */

export const actorSchema = z.object({
  userId: z.string().min(1).optional(),
  deviceId: z.string().min(1).optional(),
  botId: z.string().min(1).optional(),
});
export type Actor = z.infer<typeof actorSchema>;

export const originSchema = z.object({
  type: z.enum(["user", "bot", "system"]),
  id: z.string().min(1).optional(),
  ruleId: z.string().min(1).optional(),
});
export type Origin = z.infer<typeof originSchema>;

/** Envelope for COMMANDS (requests). */
export const commandEnvelopeSchema = z.object({
  requestId: z.string().min(1),
  commandType: z.string().min(1),
  version: z.number().int().positive().default(1),
  timestamp: z.string().datetime(),
  actor: actorSchema,
  /** Client-generated id used for idempotency (dedup) where applicable. */
  clientMessageId: z.string().min(1).optional(),
  correlationId: z.string().min(1).optional(),
  causationId: z.string().min(1).optional(),
  data: z.unknown(),
});
// NOTE: defined manually because z.infer makes `data: z.unknown()` optional.
export interface CommandEnvelope<T = unknown> {
  requestId: string;
  commandType: string;
  version: number;
  timestamp: string;
  actor: Actor;
  clientMessageId?: string;
  correlationId?: string;
  causationId?: string;
  data: T;
}

/** Envelope for canonical EVENTS (facts). */
export const eventEnvelopeSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.string().min(1),
  version: z.number().int().positive().default(1),
  timestamp: z.string().datetime(),
  actor: actorSchema.optional(),
  conversationId: z.string().min(1).optional(),
  origin: originSchema,
  correlationId: z.string().min(1).optional(),
  causationId: z.string().min(1).optional(),
  data: z.unknown(),
});
// NOTE: defined manually because z.infer makes `data: z.unknown()` optional.
export interface EventEnvelope<T = unknown> {
  eventId: string;
  eventType: string;
  version: number;
  timestamp: string;
  actor?: Actor;
  conversationId?: string;
  origin: Origin;
  correlationId?: string;
  causationId?: string;
  data: T;
}

/** Parse + validate a raw JSON payload as an event envelope. */
export function parseEventEnvelope(raw: string | Buffer): EventEnvelope {
  const json: unknown = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
  return eventEnvelopeSchema.parse(json) as EventEnvelope;
}

/** Parse + validate a raw JSON payload as a command envelope. */
export function parseCommandEnvelope(raw: string | Buffer): CommandEnvelope {
  const json: unknown = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
  return commandEnvelopeSchema.parse(json) as CommandEnvelope;
}
