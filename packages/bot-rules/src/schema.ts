import { z } from "zod";

/**
 * Bot rule schemas: trigger / conditions / actions.
 * Rule JSON from the database is ALWAYS validated with these schemas —
 * arbitrary JSON is never trusted, and no JS code is ever evaluated.
 */

export const conditionOperatorSchema = z.enum([
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "matches_regex",
  "exists",
  "greater_than",
  "less_than",
  "in",
  "not_in",
]);
export type ConditionOperator = z.infer<typeof conditionOperatorSchema>;

export const conditionSchema = z.object({
  /** Dot-path into the evaluation context, e.g. "data.content", "state.flow", "actor.userId". */
  field: z.string().min(1),
  operator: conditionOperatorSchema,
  value: z.unknown().optional(),
});
export type Condition = z.infer<typeof conditionSchema>;

export const triggerSchema = z.union([
  z.object({ event: z.string().min(1) }),
  z.object({ command: z.string().min(1) }),
]);
export type Trigger = z.infer<typeof triggerSchema>;

export const actionTypeSchema = z.enum([
  "send_message",
  "reply",
  "reply_status",
  "reply_users",
  "reply_stats",
  "reply_room",
  "add_reaction",
  "set_state",
  "delete_state",
  "increment_counter",
  "delay",
  "schedule",
  "publish_event",
  "http_request",
]);
export type ActionType = z.infer<typeof actionTypeSchema>;

export const actionSchema = z.object({
  type: actionTypeSchema,
  content: z.string().max(10_000).optional(),
  emoji: z.string().min(1).max(16).optional(),
  key: z.string().min(1).optional(),
  value: z.unknown().optional(),
  field: z.string().min(1).optional(),
  ms: z.number().int().positive().max(60_000).optional(),
  runAtMs: z.number().int().positive().optional(),
  userArgIndex: z.number().int().nonnegative().optional(),
  eventType: z.string().min(1).optional(),
  payload: z.record(z.unknown()).optional(),
  url: z.string().url().optional(),
  method: z.enum(["GET", "POST", "PUT", "PATCH"]).optional(),
  timeoutMs: z.number().int().positive().max(30_000).optional(),
});
export type Action = z.infer<typeof actionSchema>;

export const ruleDefinitionSchema = z.object({
  trigger: triggerSchema,
  conditions: z.array(conditionSchema).default([]),
  actions: z.array(actionSchema).default([]),
});
export type RuleDefinition = z.infer<typeof ruleDefinitionSchema>;

/** Validate a raw rule JSON (from DB or admin API). Throws ZodError on invalid input. */
export function parseRuleDefinition(raw: unknown): RuleDefinition {
  return ruleDefinitionSchema.parse(raw);
}

/** Safe-parse variant for admin UI validation feedback. */
export function safeParseRuleDefinition(
  raw: unknown,
): { success: true; data: RuleDefinition } | { success: false; error: string } {
  const result = ruleDefinitionSchema.safeParse(raw);
  if (result.success) return { success: true, data: result.data };
  return {
    success: false,
    error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
  };
}
