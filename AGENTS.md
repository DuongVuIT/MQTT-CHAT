# AGENTS.md — Source of Truth for Coding Agents

This file is the canonical instruction set for any coding agent working in this repository.
Detailed rules live in `.agent/rules/`, reusable workflows in `.agent/skills/`.
If an environment supports a native project-instruction mechanism, mirror this file — never maintain conflicting rule sets.

## Project Summary

MQTT Chat Monorepo + Bot Automation Platform (demo, **no auth**).
Users are picked in the UI (`duong | alice | bob | john`); identity = `userId:deviceId`.

## Absolute Invariants

1. **Understand before modifying.** Scan the repo; read entrypoints; do not guess.
2. **Never knowingly leave the repository broken** (typecheck/lint/test/build must pass).
3. **No fake implementations.** No placeholder/TODO features marked as done.
4. **Server-authoritative chat.** Clients publish _commands_ only. Canonical _events_ come exclusively from chat-worker via transactional outbox → EMQX.
5. **Commands ≠ Events.** Commands request actions; events report completed facts.
6. **apps → packages allowed; packages → apps forbidden.** No circular dependencies. Public API via `src/index.ts` only.
7. **Contracts from `@mqtt-chat/mqtt-contracts`.** Never hardcode MQTT topics or Redis keys elsewhere.
8. **Idempotency everywhere.** QoS 1 redelivers; dedupe by `clientMessageId`; consumers must tolerate duplicates.
9. **Monotonic per-conversation sequence** generated transactionally (never `MAX(sequence)+1` reads).
10. **Bot cannot bypass chat-worker.** Bots send `bot.send` commands; bot messages get full domain treatment.
11. **Bot loop protection is mandatory.** Ignore `senderType == BOT` unless a rule explicitly opts in; cooldowns + correlation/causation IDs required.
12. **Validate every boundary**: HTTP input, MQTT payloads, env vars, bot rule JSON, storage metadata. Zod schemas; types inferred from schemas.
13. **Strict TypeScript.** No lazy `any`, no `@ts-ignore`, no lazy `eslint-disable`.
14. **Thin controllers/handlers.** Logic lives in services/domain/repositories.
15. **Graceful shutdown** for MQTT/Redis/DB/HTTP on SIGTERM/SIGINT.
16. **UI states**: loading / empty / error / offline / reconnecting for every important surface. Every visible button works.
17. **Fix root causes**, not symptoms. No random multi-file edits to "try things".
18. **Verify after changes**: run lint, typecheck, test, build before declaring done.

## Key Architecture Facts

- Monorepo: pnpm workspace + Turborepo, TypeScript strict, Node 22 LTS.
- Apps: `gateway` (:3000 — the SINGLE public origin: `/`, `/chat`, `/admin`, `/api/*`, `/media*`, ws `/mqtt`), `web` (:3100 internal), `api` (:3001 internal), `chat-worker`, `bot-worker`, `notification-worker`. Admin is a route (`/admin`) inside web, not a separate app.
- Infra: EMQX (1883 TCP / 8083 WS), PostgreSQL (5432), Redis (6379), MinIO (9000/9001) via docker-compose.
- Topic namespace: `chat/v1/...` — see `packages/mqtt-contracts/src/topics.ts`.
- Event envelope: versioned, schema-validated, with actor/origin/correlation/causation.
- Workers use shared subscriptions (`$share/<group>/...`) for horizontal scale.
- Presence: multi-device sets in Redis; user offline only when connection count hits 0.
- Typing: ephemeral Redis TTL keys, never persisted.
- Read receipts: `ConversationMember.lastReadSequence` watermark.
- History/offline sync: HTTP cursor pagination + client sequence-gap detection.

## Quality Gates (mandatory before completion)

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Where to Look First

| Need                    | File                                                             |
| ----------------------- | ---------------------------------------------------------------- |
| MQTT topics/QoS/schemas | `packages/mqtt-contracts/src/*`                                  |
| DB schema               | `packages/database/prisma/schema.prisma`                         |
| Redis keys/state        | `packages/redis/src/*`                                           |
| Bot framework           | `packages/bot-sdk/src/bot.ts`                                    |
| Rule engine             | `packages/bot-rules/src/*`, `apps/bot-worker/src/rule-engine.ts` |
| Canonical message flow  | `apps/chat-worker/src/*`                                         |
| Env validation          | `packages/config/src/index.ts`                                   |
