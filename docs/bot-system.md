# Bot System

## Components

- `packages/bot-sdk` — framework: event router, command parser, context (`ctx.reply`, `ctx.getState`, ...).
- `packages/bot-rules` — Zod schemas for trigger/conditions/actions + condition engine.
- `apps/bot-worker` — runtime: consumes `chat/v1/events/#`, runs rules, executes actions, schedules jobs.

## Event Router

Bot worker subscribes to all canonical events. For each envelope it:

1. Validates the envelope schema (never trusts MQTT payloads).
2. **Loop protection**: skips events where `senderType == BOT` unless a rule explicitly sets `allowBotMessages`; enforces max automation depth via correlation/causation chains; per-rule cooldowns via Redis (`bot:cooldown:{botId}:{ruleId}:{userId}`).
3. Routes to: command engine (if content starts with `/`) and rule engine.

## Command Engine

```
/help            → command list
/ping            → pong
/status <user>   → user presence/last activity
/users           → online users
/stats           → message counters
/room            → conversation info
```

Parser supports args, quoted args, aliases, case-insensitive names. Unknown commands get an error reply.

## Rule Engine (trigger → conditions → actions)

Rules live in PostgreSQL (`bot_rules`, JSONB validated by Zod on load AND on every admin update).

```json
{
  "trigger": { "event": "message.created" },
  "conditions": [{ "field": "data.content", "operator": "contains", "value": "xin chào" }],
  "actions": [{ "type": "reply", "content": "Chào bạn 👋" }]
}
```

Operators: `equals, not_equals, contains, not_contains, starts_with, ends_with,
matches_regex, exists, greater_than, less_than, in, not_in`.
No arbitrary JS evaluation; no shell execution from rules.

## Actions

`send_message, reply, add_reaction, set_state, delete_state, increment_counter,
delay, schedule, publish_event, http_request` (+ status/users/stats/room replies).

All message-producing actions go through `bot.send` commands → chat-worker → full domain treatment
(sequence, history, receipts). Bots never publish `message.created` directly.

## State & Scheduling

- Transient state: Redis, scoped `bot:state:{botId}:{scopeKey}` with TTL (e.g. multi-step flows like asking a name).
- Persistent config/history: PostgreSQL.
- Delayed/scheduled actions run through an internal scheduler that survives restarts for persistent jobs.

## Seeded Demo Rules

| Rule      | Trigger             | Behavior                  |
| --------- | ------------------- | ------------------------- |
| welcome   | contains "xin chào" | reply "Chào bạn 👋"       |
| ping      | `/ping`             | reply "pong"              |
| help      | `/help`             | command list              |
| status    | `/status <user>`    | user presence report      |
| nice      | contains "nice"     | reaction 👍               |
| delayed   | contains "wait"     | delayed reply after ~2s   |
| name-flow | `/start-flow`       | 2-step session state demo |

Toggle any rule from Admin (:3002) → Bot tab.
