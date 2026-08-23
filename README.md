# MQTT Chat Monorepo + Bot Automation Platform

Realtime chat demo platform built on MQTT (EMQX) with a server-authoritative architecture,
bot automation engine, notifications, media uploads, and admin dashboard.

**No auth** — this is a demo. Users are picked in the UI: `duong | alice | bob | john`.
Identity = `userId:deviceId` (e.g. `duong:web-01`). Open multiple browsers/devices to demo multi-device presence.

## Status (verified end-to-end)

All quality gates pass against a live stack:

```text
pnpm install     PASS          Docker infra      RUNNING (EMQX / PostgreSQL / Redis / MinIO healthy)
pnpm lint        PASS          DB migrate+seed   PASS
pnpm typecheck   PASS          Web  :3000        RUNNING
pnpm test        PASS (38/38)  API  :3001        RUNNING (health reports database state)
pnpm build       PASS          Admin :3002       RUNNING
                               Workers           RUNNING (chat / bot / notification)
```

Seven integration/E2E suites verify the critical flows against real MQTT + HTTP +
PostgreSQL + Redis (see [Verification](#verification)).

## Stack

- **Monorepo**: pnpm workspace + Turborepo, TypeScript strict, Node 22 LTS
- **Frontend**: Next.js 16, React 19.2, Tailwind CSS, TanStack Query, Zustand, mqtt.js
- **Backend**: NestJS API, chat-worker / bot-worker / notification-worker (tsx)
- **Data**: PostgreSQL (Prisma), Redis (ioredis), MinIO (S3-compatible storage)
- **Realtime**: MQTT over EMQX (TCP 1883 / WS 8083), transactional outbox publisher
- **Testing**: Vitest (unit/integration), MQTT smoke script (`scripts/smoke.mjs`)

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env

# 3. Start infrastructure (EMQX, PostgreSQL, Redis, MinIO)
docker compose up -d

# 4. Migrate + seed database
pnpm db:migrate      # loads ../../.env automatically via dotenv-cli
pnpm db:seed         # duong/alice/bob/john/system-bot, General+Random rooms, bot rules

# 5. Run everything (web :3000, api :3001, admin :3002, workers)
pnpm dev
```

Open:

- Chat app: http://localhost:3000
- Admin dashboard: http://localhost:3002
- EMQX dashboard: http://localhost:18083 (admin/public)

## Architecture Overview

```
                    ┌──────────────┐
                    │     Web      │   Admin (:3002)
                    └──────┬───────┘
                           │
               ┌───────────┴───────────┐
              HTTP                   MQTT
               │                       │
               ▼                       ▼
             API (:3001)             EMQX
               │                       │
               │        ┌──────────────┼──────────────────┐
               │        ▼              ▼                  ▼
               │   Chat Worker    Bot Worker      Notification Worker
               │        │              │
               ▼        ▼              ▼
          PostgreSQL  Redis         Scheduler (BotScheduledJob)
               │
               ▼
            MinIO/R2 (media binaries)
```

**Core principle — server-authoritative chat:**

```
Client → command (MQTT) → EMQX → Chat Worker
  → validate → dedupe (clientMessageId) → business rules
  → PostgreSQL transaction { save message + outbox event }
  → outbox publisher → canonical event (MQTT) → clients / bot-worker / notification-worker
```

Clients never publish canonical events. Bots never bypass chat-worker.
See `docs/architecture.md` for details.

## Apps

| App                        | Port | Responsibility                                                                                     |
| -------------------------- | ---- | -------------------------------------------------------------------------------------------------- |
| `apps/web`                 | 3000 | Chat UI: conversations, realtime messages, typing, presence, receipts, media                       |
| `apps/api`                 | 3001 | REST: users, conversations, history, uploads, bots, admin stats                                    |
| `apps/admin`               | 3002 | Dashboard: stats, users, live events, bot rule management                                          |
| `apps/chat-worker`         | —    | Consumes commands via shared subscription; authoritative state; outbox                             |
| `apps/bot-worker`          | —    | Bot runtime: commands, rules, dynamic responders, scheduling, loop protection                      |
| `apps/notification-worker` | —    | Offline detection + console push notifications                                                     |
| `apps/mobile`              | —    | React Native (0.87) chat client sharing `@mqtt-chat/realtime-core`; Android debug APK builds green |

## Packages

| Package                   | Purpose                                                              |
| ------------------------- | -------------------------------------------------------------------- |
| `packages/mqtt-contracts` | Topics, command/event schemas, envelope (Zod)                        |
| `packages/mqtt`           | MQTT client factory, reconnect, QoS constants                        |
| `packages/database`       | Prisma schema/client, migrations, seed                               |
| `packages/redis`          | Client factory, key builders, presence/typing/unread/bot-state repos |
| `packages/storage`        | ObjectStorage abstraction (MinIO / S3-compatible)                    |
| `packages/bot-sdk`        | Bot framework: `bot.on/command`, context, parser                     |
| `packages/bot-rules`      | Rule schema, condition engine (12 operators), action validation      |
| `packages/config`         | Env parsing + validation at startup                                  |
| `packages/logger`         | Structured logging with correlation IDs                              |
| `packages/ui`             | Shared design system components                                      |

## Try the Demo Flows

1. **Realtime chat** — open two browsers as different users, send messages; no refresh needed.
2. **Bot commands** — send `/help`, `/ping`, `/status bob`, `/users`, `/stats` in any conversation.
3. **Auto response** — say "xin chào" → bot replies 👋; say "nice" → bot reacts 👍.
4. **Typing & read receipts** — typing indicator appears/disappears; read marks update live.
5. **Multi-device** — pick the same user with different device IDs; close one tab, user stays online until the last device drops.
6. **Reconnect sync** — kill network on one client, send messages from another, restore → gap is fetched via HTTP.
7. **Admin** — toggle the welcome rule off/on at :3002 and watch auto-replies stop/start (rule hot-reload takes ≤5s).
8. **Notifications** — keep Bob offline, message him, watch `[PUSH] recipient=bob ...` in notification-worker logs.

## Mobile (React Native)

```bash
pnpm --filter @mqtt-chat/mobile test        # jest suite (message lifecycle)
cd apps/mobile/android && ./gradlew assembleDebug   # → app/build/outputs/apk/debug/app-debug.apk
```

The mobile app reuses the same platform-agnostic realtime client
(`packages/realtime-core`) and message-lifecycle semantics as web
(optimistic pending → reconcile by `clientMessageId` → timeout → retry).
On Android emulators use `ws://10.0.2.2:8083` to reach host EMQX.

## Verification

With services running (`docker compose up -d && pnpm dev`):

```bash
node scripts/smoke.mjs    # realtime flow A, dedup single-event, bot /ping → pong, history
```

Additional coverage verified by integration suites (MQTT + HTTP + Redis + Postgres):

| Suite             | Verifies                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Smoke             | Command → chat-worker → outbox → canonical event; idempotent dedup emits exactly one event                                                  |
| Bot               | Rule match/reply, disable→silence→re-enable→reply, loop protection (no recursive replies)                                                   |
| Presence          | Multi-device set 2→1→0 in Redis, LWT-triggered offline, `connectionCount` in events                                                         |
| Flows (19 checks) | Typing TTL, read-receipt watermark + sender notification, edit/delete/reaction/reply realtime+DB, reconnect gap recovery without duplicates |
| Scheduler         | `delay` action latency; `schedule` action → `BotScheduledJob` PENDING→COMPLETED → message                                                   |
| Race              | 20 concurrent sends → unique, gapless, monotonic per-conversation sequence                                                                  |
| Notification      | Offline-only push, sender never notified, online recipients skipped                                                                         |

Unit tests: `pnpm test` (38 tests across 5 files, including all 12 condition operators
and rejection of incompatible-type comparisons).

## Stabilization Log (bugs found by running the stack, then fixed at the root)

1. **Duplicate canonical events** — resending a command with the same `clientMessageId`
   re-emitted a second `message.created` event. The outbox row is created atomically with
   the message insert, so the duplicate path now only acknowledges (single event guaranteed).
2. **`GET /bots` returned 500** — tsx/esbuild does not emit decorator metadata, so implicit
   Nest DI injected `undefined`. All controllers use explicit `@Inject(PrismaService)`.
3. **Users stayed online after closing the tab** — the web LWT payload used an invalid
   envelope shape and was dropped by chat-worker's validator. LWT is now a valid
   `presence.set` command envelope.
4. **Presence bricked after going offline** — removing the last connection overwrote the
   Redis SET key with a JSON string; the next `SADD`/`SMEMBERS` failed with WRONGTYPE.
   Last-seen lives in its own key now and empty sets are deleted.
5. **Bot settings changes never took effect** — per-process settings cache was never
   invalidated; it now clears alongside the 5s rule refresh.
6. **MinIO unreachable from host** — container predated the compose port mapping;
   recreated to expose 9000/9001.
7. **`pnpm db:migrate` / `db:seed` failed from repo root** — Prisma CLI and the seed script
   never loaded the root `.env`. Scripts now run through `dotenv -e ../../.env`.
8. **Inconsistent HTTP error shapes** — framework-generated errors (malformed JSON body,
   unknown route) leaked raw Nest shapes. The global exception filter now normalizes every
   error to `{error:{code,message,details,requestId}}`.

Contract hygiene: hardcoded topics outside `@mqtt-chat/mqtt-contracts` were replaced with
`SUBSCRIPTION_PATTERNS.allEvents` and a new `botEventsTopic()` builder.

## Quality Gates

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Note: avoid running `pnpm build` while `next dev` servers are holding `.next` — the build
overwrites dev artifacts and dev requests return 500 until the dev servers restart.
Run builds before starting `pnpm dev`, or restart web/admin afterwards.

### Clean-start recovery (if web shows `Cannot find module './NNN.js'` or similar chunk errors)

```bash
# 1. Kill every dev process (zombie processes silently serve stale code!)
pkill -f 'tsx' ; pkill -f 'turbo run dev' ; pkill -f 'next dev'
lsof -ti :3000 | xargs kill -9 2>/dev/null   # repeat for :3001 :3002

# 2. Remove ONLY generated artifacts (never source code)
rm -rf apps/web/.next apps/admin/.next .turbo

# 3. Restart detached and verify
nohup pnpm dev > /tmp/mqtt-dev.log 2>&1 &
curl -s -o /dev/null -w '%{http_code}
' http://localhost:3000   # expect 200
```

Also check the dev log for `EADDRINUSE` — if present, a zombie process still
holds the port and the browser will talk to an OLD instance of that service.

## Documentation

See `docs/`: architecture, mqtt-topics, message-flow, bot-system, development.

## Agent Instructions

Coding agents must read `AGENTS.md` first; detailed rules in `.agent/rules/`, workflows in `.agent/skills/`.
# MQTT-CHAT
# MQTT-CHAT
