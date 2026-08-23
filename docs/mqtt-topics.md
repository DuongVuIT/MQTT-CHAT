# MQTT Topics & Contracts

All topics, payloads, and schemas are defined in `packages/mqtt-contracts` — never hardcode topics elsewhere.

## Namespace

`chat/v1/...`

## Commands (clients/bots → chat-worker)

| Topic                                | QoS | Payload schema                  |
| ------------------------------------ | --- | ------------------------------- |
| `chat/v1/commands/message/send`      | 1   | `sendMessageCommandSchema`      |
| `chat/v1/commands/message/edit`      | 1   | `editMessageCommandSchema`      |
| `chat/v1/commands/message/delete`    | 1   | `deleteMessageCommandSchema`    |
| `chat/v1/commands/reaction/add`      | 1   | `addReactionCommandSchema`      |
| `chat/v1/commands/reaction/remove`   | 1   | `removeReactionCommandSchema`   |
| `chat/v1/commands/receipt/read`      | 1   | `readReceiptCommandSchema`      |
| `chat/v1/commands/receipt/delivered` | 1   | `deliveredReceiptCommandSchema` |
| `chat/v1/commands/presence/set`      | 1   | `presenceSetCommandSchema`      |
| `chat/v1/commands/typing/set`        | 0   | `typingSetCommandSchema`        |
| `chat/v1/commands/bot/send`          | 1   | `botSendCommandSchema`          |

## Events (chat-worker → everyone)

| Topic                              | QoS |
| ---------------------------------- | --- |
| `chat/v1/events/message/created`   | 1   |
| `chat/v1/events/message/edited`    | 1   |
| `chat/v1/events/message/deleted`   | 1   |
| `chat/v1/events/reaction/added`    | 1   |
| `chat/v1/events/reaction/removed`  | 1   |
| `chat/v1/events/receipt/delivered` | 1   |
| `chat/v1/events/receipt/read`      | 1   |
| `chat/v1/events/typing/started`    | 0   |
| `chat/v1/events/typing/stopped`    | 0   |
| `chat/v1/events/presence/online`   | 1   |
| `chat/v1/events/presence/offline`  | 1   |
| `chat/v1/events/conversation/*`    | 1   |
| `chat/v1/events/media/uploaded`    | 1   |
| `chat/v1/events/system/error`      | 1   |

## Event Envelope

Every canonical event is wrapped in a versioned, schema-validated envelope:

```ts
{
  eventId: string          // unique, for dedupe
  eventType: string        // e.g. "message.created"
  version: number          // schema version
  timestamp: string        // ISO 8601
  actor?: { userId?, deviceId?, botId? }
  conversationId?: string
  origin: { type: "user" | "bot" | "system", id?, ruleId? }
  correlationId?: string   // trace chain root
  causationId?: string     // event that caused this one
  data: T                  // event-specific payload
}
```

## Subscriptions

- Web client: only topics for its conversations + own presence/typing.
- chat-worker: `$share/chat-workers/chat/v1/commands/#`
- bot-worker: `$share/bot-workers/chat/v1/events/#`
- notification-worker: `$share/notification-workers/chat/v1/events/message/created`
- admin dashboard (observer): `chat/v1/events/#`
