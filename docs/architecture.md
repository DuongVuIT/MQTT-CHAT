# Architecture

## System Diagram

```
                   ┌─────────────────────────┐
                   │  Browser / Mobile app    │
                   └────────────┬────────────┘
                                │  single public origin :3000
                    ┌───────────┴────────────┐
                    │       GATEWAY          │
                    │  /,/chat,/admin → web  │
                    │  /api/*,/media* → api  │
                    │      ws /mqtt → EMQX   │
                    └───────┬────────┬───────┘
                            │        │
                          HTTP     MQTT (ws)
                            │        │
                            ▼        ▼
                          API      EMQX
                            │        │
                            │   ┌────┼──────────────┐
                            │   │    │              │
                            │   ▼    ▼              ▼
                            │ Chat   Bot      Notification
                            │ Worker Worker         Worker
                            │   │    │
                            ▼   ▼    ▼
                        PostgreSQL  Redis
                            │
                            ▼
                        MinIO/R2
```

## Responsibilities

| Component               | Responsibility                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **gateway**             | Reverse proxy — the SINGLE public origin (:3000): `/`, `/chat`, `/admin` → web; `/api/*`, `/media*`, ws `/mqtt` → their internal services.       |
| **web**                 | Chat UI + admin route (`/admin`: stats, users, live event stream, bot rule toggles). Publishes commands over MQTT; consumes canonical events.    |
| **api**                 | REST for history, conversations, uploads (same-origin multipart), bots config, stats.                                                            |
| **chat-worker**         | Authority of realtime chat. Validates commands, dedupes, generates sequences, writes DB + outbox in one transaction, publishes canonical events. |
| **bot-worker**          | Consumes all events (`chat/v1/events/#`), runs command engine + rule engine + scheduler; sends messages only via `bot.send` commands.            |
| **notification-worker** | Detects offline recipients on `message.created`, dispatches notifications via provider abstraction (Console demo provider).                      |

## Key Decisions

1. **Commands ≠ Events** — clients request actions (`chat/v1/commands/...`); only chat-worker publishes facts (`chat/v1/events/...`) after the DB transaction commits.
2. **Transactional outbox** — domain write and outbox insert share one PostgreSQL transaction; a retryable publisher drains pending rows to EMQX and marks them published. At-least-once delivery; consumers are idempotent.
3. **Monotonic sequence** — `Conversation.lastSequence` is incremented inside the same transaction as message creation (never `MAX(sequence)+1` reads). Clients use it for ordering, gap detection, offline sync, read watermarks.
4. **Idempotency** — unique `clientMessageId` per conversation; QoS 1 redeliveries never create duplicates.
5. **Shared subscriptions** — workers scale horizontally via `$share/<group>/...`; different worker groups each receive every event.
6. **Multi-device presence** — Redis sets track active devices per user; user is offline only when the set empties. MQTT LWT covers abrupt disconnects.
7. **Ephemeral typing** — Redis TTL keys with auto-expiry; never persisted.
8. **Media through the API** — binaries upload same-origin via `POST /api/uploads` (multipart) to durable MinIO keys; reads stream server-side through `/media?key=…`. MQTT messages carry only `mediaUrl` + metadata; keys are resolved at READ time so no stale signed URLs can exist.

## Dependency Rule

```
apps → packages ✓        packages → apps ✗
shared-types ← mqtt-contracts ← mqtt ← apps   (no cycles)
```

Each package exposes its public API through `src/index.ts` only.
