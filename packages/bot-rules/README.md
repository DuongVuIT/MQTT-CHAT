# @mqtt-chat/bot-rules

Declarative chat bot rules stored as JSON. Rules are validated with [Zod](https://zod.dev) and evaluated by a small condition engine that never runs user code: no `eval`, no `new Function`, only a fixed set of operators.

It was extracted from [MQTT-CHAT](https://github.com/DuongVuIT/MQTT-CHAT), where admins create and toggle bot rules from a dashboard and a bot worker evaluates them against live chat events. The engine itself has no dependency on MQTT, so it works with any chat or event system.

## Install

```bash
npm install @mqtt-chat/bot-rules
# or
pnpm add @mqtt-chat/bot-rules
```

Works with both ESM (`import`) and CommonJS (`require`). Node 18+. Uses Zod 4 (installed automatically).

## Quick example

```ts
import { parseRuleDefinition, evaluateConditions } from "@mqtt-chat/bot-rules";

// A rule as it might be stored in your database or sent from an admin UI.
const rule = parseRuleDefinition({
  trigger: { event: "message.created" },
  conditions: [
    { field: "data.content", operator: "contains", value: "xin chào" },
    { field: "actor.userId", operator: "not_equals", value: "system-bot" },
  ],
  actions: [{ type: "reply", content: "👋 Chào bạn!" }],
});

const context = {
  data: { content: "xin chào mọi người" },
  actor: { userId: "alice" },
};

if (evaluateConditions(rule.conditions, context)) {
  for (const action of rule.actions) {
    // Your runtime decides what each action type does.
    console.log("run action", action.type, action.content);
  }
}
```

## Rule shape

A rule has three parts:

| Part         | Description                                                                    |
| ------------ | ------------------------------------------------------------------------------ |
| `trigger`    | Either `{ event: string }` or `{ command: string }` (e.g. `"/ping"`).          |
| `conditions` | Array of `{ field, operator, value? }`. All must pass (AND). Defaults to `[]`. |
| `actions`    | Array of validated action objects. Defaults to `[]`.                           |

`field` is a dot-path into the context you pass in, such as `data.content`, `state.flow` or `tags.0`.

### Operators

`equals`, `not_equals`, `contains`, `not_contains`, `starts_with`, `ends_with`, `matches_regex` (case-insensitive), `exists`, `greater_than`, `less_than`, `in`, `not_in`.

String operators accept strings, numbers and booleans. Numeric operators accept numbers and numeric strings. Missing fields and type mismatches evaluate to `false` instead of throwing.

### Action types

`send_message`, `reply`, `reply_status`, `reply_users`, `reply_stats`, `reply_room`, `add_reaction`, `set_state`, `delete_state`, `increment_counter`, `delay`, `schedule`, `publish_event`, `http_request`.

The schema validates the shape and limits of each action (for example `delay.ms` is capped at 60 seconds and `http_request.timeoutMs` at 30 seconds). Executing actions is up to your bot runtime; this package only defines and validates them.

## API

| Export                                                                     | Description                                                                                                 |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `parseRuleDefinition(raw)`                                                 | Validate unknown JSON into a `RuleDefinition`. Throws `ZodError` if invalid.                                |
| `safeParseRuleDefinition(raw)`                                             | Same, but returns `{ success, data }` or `{ success: false, error }` with a readable message for admin UIs. |
| `evaluateCondition(c, ctx)`                                                | Evaluate a single condition against a context object.                                                       |
| `evaluateConditions(cs, ctx)`                                              | Evaluate all conditions with AND semantics.                                                                 |
| `resolvePath(ctx, path)`                                                   | Read a dot-path from a context. Only own properties are read.                                               |
| `ruleDefinitionSchema`, `conditionSchema`, `actionSchema`, `triggerSchema` | The Zod schemas, for composing into your own validation.                                                    |

All types (`RuleDefinition`, `Condition`, `Action`, `Trigger`, `ConditionOperator`, `ActionType`) are exported.

## Security notes

Rule JSON is treated as untrusted input: anything that does not match the schema is rejected, and unknown action types such as `run_shell_command` fail validation. `resolvePath` refuses `__proto__`, `prototype` and `constructor` and only reads own properties, so rules cannot reach into object prototypes.

`matches_regex` compiles the pattern from the rule. An invalid pattern simply never matches, but a pathological pattern can still be slow on long input (ReDoS). Only let trusted admins author regex rules, or cap message length before evaluation.

## License

MIT
