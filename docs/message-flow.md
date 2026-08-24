# Message Flow

## Send Message (canonical flow)

```
Client
  │ 1. generate clientMessageId (uuid)
  │ 2. optimistic UI (status=pending)
  │ 3. publish command → chat/v1/commands/message/send (QoS 1)
  ▼
EMQX ──► Chat Worker ($share/chat-workers/...)
  │ 4. schema validation (Zod)
  │ 5. membership check
  │ 6. dedupe: unique clientMessageId → if exists, re-publish canonical event, stop
  │ 7. sequence = ++conversation.lastSequence (same transaction)
  ▼
PostgreSQL transaction
  ├─ insert Message (id, sequence, content, senderType=USER)
  └─ insert OutboxEvent (message.created)
  ▼
Outbox Publisher (retryable)
  │ 8. publish canonical event → chat/v1/events/message/created (QoS 1)
  │ 9. mark outbox row published
  ▼
┌───────────────┬──────────────────┬───────────────────┐
│ Other clients │   Bot Worker     │ Notification Worker│
│ render event  │ rules/commands   │ offline push       │
└───────────────┴──────────────────┴───────────────────┘
```

Client reconciles the pending message with the canonical event by `clientMessageId`
→ status becomes `sent` → `delivered` (receipt events) → `read`.

## Offline Sync / Reconnect

```
reconnect
  ↓ resubscribe topics
  ↓ compare local lastSequence vs conversation.lastSequence (from history API)
  ↓ GET /conversations/:id/messages?afterSequence=<gap> (cursor pagination)
  ↓ merge + dedupe by clientMessageId
  ↓ resume realtime
```

## Read Receipts

- Client opens conversation at sequence N → publishes `receipt/read { lastReadSequence: N }`.
- chat-worker updates `ConversationMember.lastReadSequence` (watermark; no per-message rows).
- Canonical `receipt.read` event lets senders update ticks in realtime.

## Media

```
POST /api/uploads (multipart, same-origin via gateway) → server persists to MinIO → durable storageKey
MQTT message carries mediaUrl = /media?key=<storageKey> + mimeType, size, filename
GET /media?key=… → API streams the object server-side (immutable cache headers)
```

Keys are durable and resolved at READ time — no stale signed URLs can exist.

## Idempotency Guarantees

- QoS 1 may redeliver commands and events.
- Commands deduped server-side by unique `clientMessageId`.
- Events carry unique `eventId`; consumers tolerate duplicates.
