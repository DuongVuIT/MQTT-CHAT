import { describe, expect, it } from "vitest";
import { evaluateCondition, evaluateConditions } from "./condition-engine";
import { ruleDefinitionSchema } from "./schema";

describe("evaluateCondition", () => {
  const data = {
    content: "xin chào bot",
    senderId: "duong",
    count: 5,
    tags: ["a", "b"],
  };

  it("contains / not_contains", () => {
    expect(evaluateCondition({ field: "content", operator: "contains", value: "chào" }, data)).toBe(
      true,
    );
    expect(evaluateCondition({ field: "content", operator: "contains", value: "bye" }, data)).toBe(
      false,
    );
    expect(
      evaluateCondition({ field: "content", operator: "not_contains", value: "bye" }, data),
    ).toBe(true);
    expect(
      evaluateCondition({ field: "content", operator: "not_contains", value: "chào" }, data),
    ).toBe(false);
  });

  it("equals / not_equals", () => {
    expect(evaluateCondition({ field: "senderId", operator: "equals", value: "duong" }, data)).toBe(
      true,
    );
    expect(
      evaluateCondition({ field: "senderId", operator: "not_equals", value: "alice" }, data),
    ).toBe(true);
  });

  it("starts_with / ends_with", () => {
    expect(
      evaluateCondition({ field: "content", operator: "starts_with", value: "xin" }, data),
    ).toBe(true);
    expect(evaluateCondition({ field: "content", operator: "ends_with", value: "bot" }, data)).toBe(
      true,
    );
  });

  it("matches_regex", () => {
    expect(
      evaluateCondition({ field: "content", operator: "matches_regex", value: "^xin\\s" }, data),
    ).toBe(true);
  });

  it("exists", () => {
    expect(evaluateCondition({ field: "count", operator: "exists", value: null }, data)).toBe(true);
    expect(evaluateCondition({ field: "missing", operator: "exists", value: null }, data)).toBe(
      false,
    );
  });

  it("greater_than / less_than", () => {
    expect(evaluateCondition({ field: "count", operator: "greater_than", value: 3 }, data)).toBe(
      true,
    );
    expect(evaluateCondition({ field: "count", operator: "less_than", value: 3 }, data)).toBe(
      false,
    );
  });

  it("numeric operators reject incompatible types instead of coercing silently", () => {
    expect(evaluateCondition({ field: "senderId", operator: "greater_than", value: 3 }, data)).toBe(
      false,
    );
    expect(
      evaluateCondition({ field: "count", operator: "greater_than", value: "not-a-number" }, data),
    ).toBe(false);
  });

  it("in / not_in", () => {
    expect(
      evaluateCondition({ field: "senderId", operator: "in", value: ["duong", "bob"] }, data),
    ).toBe(true);
    expect(
      evaluateCondition({ field: "senderId", operator: "not_in", value: ["alice"] }, data),
    ).toBe(true);
  });

  it("returns false for unknown field instead of throwing", () => {
    expect(evaluateCondition({ field: "nope.nope", operator: "equals", value: 1 }, data)).toBe(
      false,
    );
  });
});

describe("evaluateConditions (AND semantics)", () => {
  const data = { content: "hello world", senderId: "bob" };

  it("all conditions must match", () => {
    expect(
      evaluateConditions(
        [
          { field: "content", operator: "contains", value: "hello" },
          { field: "senderId", operator: "equals", value: "bob" },
        ],
        data,
      ),
    ).toBe(true);

    expect(
      evaluateConditions(
        [
          { field: "content", operator: "contains", value: "hello" },
          { field: "senderId", operator: "equals", value: "alice" },
        ],
        data,
      ),
    ).toBe(false);
  });

  it("empty conditions always match", () => {
    expect(evaluateConditions([], data)).toBe(true);
  });
});

describe("ruleDefinitionSchema validation", () => {
  it("accepts a valid rule definition", () => {
    expect(
      ruleDefinitionSchema.safeParse({
        trigger: { event: "message.created" },
        conditions: [{ field: "data.content", operator: "contains", value: "xin chào" }],
        actions: [{ type: "reply", content: "Chào bạn 👋" }],
      }).success,
    ).toBe(true);
  });

  it("rejects invalid action type (no arbitrary execution)", () => {
    expect(
      ruleDefinitionSchema.safeParse({
        trigger: { event: "message.created" },
        conditions: [],
        actions: [{ type: "run_shell_command", command: "rm -rf /" }],
      }).success,
    ).toBe(false);
  });
});
