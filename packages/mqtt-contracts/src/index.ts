export * from "./topics";
export * from "./qos";
export * from "./envelope";
export * from "./commands";
export * from "./events";
export * from "./media";

import type { Actor, CommandEnvelope, EventEnvelope, Origin } from "./envelope";

/** Build a command envelope with generated requestId. */
export function buildCommandEnvelope<T>(params: {
  commandType: string;
  actor: Actor;
  data: T;
  clientMessageId?: string;
  correlationId?: string;
  causationId?: string;
}): CommandEnvelope<T> {
  return {
    requestId: crypto.randomUUID(),
    commandType: params.commandType,
    version: 1,
    timestamp: new Date().toISOString(),
    actor: params.actor,
    ...(params.clientMessageId ? { clientMessageId: params.clientMessageId } : {}),
    ...(params.correlationId ? { correlationId: params.correlationId } : {}),
    ...(params.causationId ? { causationId: params.causationId } : {}),
    data: params.data,
  };
}

/** Build a canonical event envelope with generated eventId. */
export function buildEventEnvelope<T>(params: {
  eventType: string;
  origin: Origin;
  data: T;
  actor?: Actor;
  conversationId?: string;
  correlationId?: string;
  causationId?: string;
}): EventEnvelope<T> {
  return {
    eventId: crypto.randomUUID(),
    eventType: params.eventType,
    version: 1,
    timestamp: new Date().toISOString(),
    ...(params.actor ? { actor: params.actor } : {}),
    ...(params.conversationId ? { conversationId: params.conversationId } : {}),
    origin: params.origin,
    ...(params.correlationId ? { correlationId: params.correlationId } : {}),
    ...(params.causationId ? { causationId: params.causationId } : {}),
    data: params.data,
  };
}
