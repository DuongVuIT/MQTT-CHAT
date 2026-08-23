import type { Condition } from "./schema";

/**
 * Condition evaluation engine.
 * Resolves dot-paths into an evaluation context and applies operators.
 * No arbitrary code execution — only declarative operators.
 */

/** Resolve a dot-path like "data.content" or "state.flow" against a nested object. */
export function resolvePath(context: Record<string, unknown>, path: string): unknown {
  const segments = path.split(".");
  let current: unknown = context;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function toStringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function toNumberValue(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function evaluateCondition(condition: Condition, context: Record<string, unknown>): boolean {
  const actual = resolvePath(context, condition.field);
  const expected = condition.value;

  switch (condition.operator) {
    case "equals":
      return actual === expected;
    case "not_equals":
      return actual !== expected;
    case "contains": {
      const a = toStringValue(actual);
      const b = toStringValue(expected);
      return a !== undefined && b !== undefined && a.includes(b);
    }
    case "not_contains": {
      const a = toStringValue(actual);
      const b = toStringValue(expected);
      return a === undefined || b === undefined || !a.includes(b);
    }
    case "starts_with": {
      const a = toStringValue(actual);
      const b = toStringValue(expected);
      return a !== undefined && b !== undefined && a.startsWith(b);
    }
    case "ends_with": {
      const a = toStringValue(actual);
      const b = toStringValue(expected);
      return a !== undefined && b !== undefined && a.endsWith(b);
    }
    case "matches_regex": {
      const a = toStringValue(actual);
      const pattern = toStringValue(expected);
      if (a === undefined || pattern === undefined) return false;
      try {
        // Case-insensitive by default for chat matching.
        return new RegExp(pattern, "i").test(a);
      } catch {
        return false; // invalid regex in rule → never matches
      }
    }
    case "exists":
      return actual !== undefined && actual !== null;
    case "greater_than": {
      const a = toNumberValue(actual);
      const b = toNumberValue(expected);
      return a !== undefined && b !== undefined && a > b;
    }
    case "less_than": {
      const a = toNumberValue(actual);
      const b = toNumberValue(expected);
      return a !== undefined && b !== undefined && a < b;
    }
    case "in": {
      if (!Array.isArray(expected)) return false;
      return expected.includes(actual);
    }
    case "not_in": {
      if (!Array.isArray(expected)) return true;
      return !expected.includes(actual);
    }
    default:
      return false;
  }
}

/** All conditions must pass (AND semantics). */
export function evaluateConditions(
  conditions: readonly Condition[],
  context: Record<string, unknown>,
): boolean {
  return conditions.every((condition) => evaluateCondition(condition, context));
}
