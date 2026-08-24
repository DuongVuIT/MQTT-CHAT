# MQTT Chat Monorepo + Bot Automation Platform

Realtime chat demo platform built on MQTT (EMQX) with a **single public
origin**, server-authoritative architecture, bot automation engine,
notifications, media uploads and an admin dashboard.

**No auth** — this is a demo. Users are picked in the UI. Identity =
`userId:deviceId` (e.g. `duong:web-01`). Open multiple browsers/devices to
demo multi-device presence.

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

# 5. Start everything (gateway, web, api, workers)
pnpm dev
```

Then open **only**:

- Chat app: **http://localhost:3000** → pick an identity → `/chat`
- Admin dashboard: **http://localhost:3000/admin**

You never need to open any other port.

## Acceptance probes (dev stack + Chrome required)

```bash
pnpm probe:scroll   # §72: 300-message conversation — open-at-latest (0px),
                    # EXACT prepend-anchor preservation, unread-pill jump,
                    # rapid sends, switch-and-return
pnpm probe:leak     # §73: churn conversations/identity/reconnects, then the
                    # broker must see ONE stable-subscription client per session
```

## Public Surface (the only browser-facing routes)

| Route          | Serves                                                       |
| -------------- | ------------------------------------------------------------ |
| `/`            | Identity picker (home)                                       |
| `/chat`        | Chat app                                                     |
| `/admin`       | Admin dashboard (system health, stats, users, events, bots)  |
| `/api/*`       | REST backend (`GET /api/health` shows real dependency state) |
| `ws:///mqtt`   | MQTT over WebSocket (realtime)                               |
| `/media?key=…` | Media streaming from object storage (durable storage keys)   |

Everything else is INTERNAL ONLY (for debugging, not for normal use):
web :3100 · API :3001 · EMQX TCP 1883 / WS 8083 / dashboard 18083 ·
PostgreSQL 5432 · Redis 6379 · MinIO 9000/9001.

## Architecture Overview

```
                 http://localhost:3000   ← THE public origin
                          │
                    PUBLIC GATEWAY (apps/gateway)
                          │
      ┌───────────────────┼───────────────────┐
      │ /chat /admin      │ /api/*  /media    │ /mqtt (WS upgrade)
      ▼                   ▼                   ▼
   Web UI (:3100)     API (:3001)         EMQX (:8083)
   Next.js + /admin   NestJS, prefix /api      │
      │                   │        ┌──────────┼─────────────┐
      │ MQTT (ws)         │        ▼          ▼             ▼
      └──────────────► PostgreSQL  Chat Worker  Bot Worker  Notification Worker
                       Redis       (transactional outbox → canonical events)
                       MinIO
```

**Core principle — server-authoritative chat:**

```
Client → command (MQTT) → EMQX → Chat Worker
  → validate → dedupe (clientMessageId) → business rules
  → PostgreSQL transaction { save message + outbox event }
  → outbox publisher → canonical event (MQTT) → clients / bot-worker / notification-worker
```

Clients never publish canonical events; they never import `mqtt` directly —
all client transport goes through the shared `@mqtt-chat/realtime-core`
adapter. Bots never bypass chat-worker. See `docs/architecture.md`.

## Apps

| App                        | Port (internal) | Responsibility                                                                                   |
| -------------------------- | --------------- | ------------------------------------------------------------------------------------------------ |
| `apps/gateway`             | **3000 public** | Reverse proxy: HTTP routing, WebSocket upgrade, media path — the single origin                   |
| `apps/web`                 | 3100            | Chat UI **and admin dashboard** (`/admin`): realtime messages, typing, presence, receipts, media |
| `apps/api`                 | 3001            | REST under `/api`: users, conversations, history, uploads/media, bots, admin stats               |
| `apps/chat-worker`         | —               | Consumes commands via shared subscription; authoritative state; outbox                           |
| `apps/bot-worker`          | —               | Bot runtime: commands, rules, dynamic responders, scheduling, loop protection                    |
| `apps/notification-worker` | —               | Offline detection + console push notifications                                                   |
| `apps/mobile`              | —               | React Native (0.87) chat client sharing `@mqtt-chat/realtime-core`; safe-area-correct UI         |

## Packages

| Package                   | Purpose                                                                   |
| ------------------------- | ------------------------------------------------------------------------- |
| `packages/mqtt-contracts` | Topics (env-fencable namespace), command/event schemas, envelope (Zod)    |
| `packages/realtime-core`  | Platform-agnostic browser/RN MQTT adapter — the only client mqtt importer |
| `packages/mqtt`           | Server-side MQTT client factory, reconnect, QoS constants                 |
| `packages/database`       | Prisma schema/client, migrations, seed                                    |
| `packages/redis`          | Client factory, key builders, presence/typing/unread/bot-state repos      |
| `packages/storage`        | ObjectStorage abstraction + media key contract (MinIO/S3-compatible)      |
| `packages/bot-sdk`        | Bot framework: `bot.on/command`, context, parser                          |
| `packages/bot-rules`      | Rule schema, condition engine (12 operators), action validation           |
| `packages/config`         | Env parsing + validation at startup                                       |
| `packages/logger`         | Structured logging with correlation IDs                                   |
| `packages/ui`             | Shared design system components                                           |

## Try the Demo Flows

1. **Realtime chat** — two browsers as different users; messages fly with no refresh.
2. **Bot commands** — send `/help`, `/ping`, `/status bob`, `/users`, `/stats`.
3. **Auto response** — say "xin chào" → 👋 reply; say "nice" → 👍 reaction.
4. **Typing & read receipts** — indicators update live.
5. **Multi-device** — same user on two devices; presence reflects connection count.
6. **Reconnect sync** — drop network, send from another client, restore → gap fetched over HTTP.
7. **Groups** — "+ New" in the sidebar: title, user search, multi-select members; creation and membership changes appear for every member in realtime (no reload). Add members later from the details panel.
8. **Media** — attach an image; it uploads same-origin and renders on web and mobile from a durable storage key.
9. **Identity switch** — "Switch" in the sidebar cleanly tears down the old session (subscriptions, presence, pending queue) before starting the new one.
10. **Admin** — toggle rules at `/admin`; live event stream via the same shared MQTT adapter as chat.
11. **Diagnostics** — the ⚙ button (bottom-left of `/chat`, dev builds) shows origin/API/MQTT state, identity, last sequence, pending queue and last event.

## Mobile (React Native)

```bash
pnpm --filter @mqtt-chat/mobile test        # jest suite (message lifecycle)
cd apps/mobile/android && ./gradlew assembleDebug   # → app/build/outputs/apk/debug/app-debug.apk
```

Mobile talks to the SAME single origin: it derives `http://<host>:3000/api`,
`ws://<host>:3000/mqtt` and `<host>:3000/media` from one PUBLIC_HOST
(iOS Simulator → `localhost`, Android emulator → `10.0.2.2`; override with
`MQTT_CHAT_PUBLIC_HOST` for physical devices — no source edits per device).
Safe-area-correct layout (header/composer respect notch + home indicator),
keyboard-aware composer, grouped message bubbles with timestamps.

## Verification

Unit + integration gates:

```bash
pnpm validate        # format:check + lint + typecheck + test + build
```

E2E against an ISOLATED stack (dedicated `mqtt_chat_test` database, Redis db 1,
API :3011, topic-namespace-fenced workers — development data is never touched):

```bash
pnpm test:e2e        # boots the isolated stack, runs all suites, tears down
```

| Suite            | Verifies                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| Smoke            | Command → chat-worker → outbox → canonical event; idempotent dedup emits exactly one event           |
| Bot              | Rule match/reply, disable→silence→re-enable→reply, loop protection (no recursive replies)            |
| Presence         | Multi-device set 2→1→0 in Redis, LWT-triggered offline, `connectionCount` in events                  |
| Duplicate-direct | 20 concurrent DIRECT creates for one pair → ONE conversation row (DB unique pair key)                |
| Group/Media      | conversation.created realtime contract; same-origin upload → durable key → byte-perfect media stream |
| Notification     | Offline-only push, sender never notified, online recipients skipped                                  |

Gateway-level checks (public origin): HTTP 200 for `/`, `/chat`, `/admin`;
MQTT CONNECT + publish/receive through `ws://localhost:3000/mqtt`; PNG
round-trip through `/api/uploads` + `/api/media`
(`node scripts/upload-e2e.mjs` with `API_URL=http://localhost:3000/api`).

Completion gate: `pnpm verify:completion` parses PROJECT_STATUS.md and fails
while any mandatory P0 item is not VERIFIED.

## Quality Gates

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm format:check
```
