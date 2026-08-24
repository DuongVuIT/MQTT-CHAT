# PROJECT_STATUS.md — Completion Ledger (single source of truth)

Format: ID | Priority | Requirement | Status | Evidence | Last Error
Statuses: NOT_STARTED / IN_PROGRESS / BLOCKED_EXTERNAL / FAILED / VERIFIED

## Stabilization ledger (single origin + web + admin + RN + MQTT + backend)

| ID     | Pri | Requirement                         | Status   | Evidence                                                                                                                                                                                                         | Last Error |
| ------ | --- | ----------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| P0-001 | P0  | Single public origin                | VERIFIED | gateway :3000 routes / /chat /admin /api/* /media ws:/mqtt; internal ports never needed by users                                                                                                                 |            |
| P0-002 | P0  | Gateway HTTP                        | VERIFIED | apps/gateway (http-proxy): `/`,`/chat`,`/admin` →200; `/api/*`→Nest; `/media*`→API stream; canonical JSON errors on upstream failure                                                                             |            |
| P0-003 | P0  | Gateway WebSocket MQTT              | VERIFIED | upgrade `ws://localhost:3000/mqtt` → 101 w/ EMQX `server: Cowboy`; full CONNECT+SUBSCRIBE+PUBLISH round-trip received canonical message.created through gateway                                                  |            |
| P0-004 | P0  | Web /chat                           | VERIFIED | Next app serves /chat at :3000 via gateway; realtime badge Connected; events flow                                                                                                                                |            |
| P0-005 | P0  | Admin /admin                        | VERIFIED | admin merged INTO web app (`apps/web/src/app/admin`); :3002 removed; dashboard polls REST + observer MQTT stream                                                                                                 |            |
| P0-006 | P0  | API /api/*                          | VERIFIED | Nest global prefix `api`; GET /api/health reports real DB+Redis state (never hardcoded); root `/` returns service metadata probe                                                                                 |            |
| P0-007 | P0  | Media /media/*                      | VERIFIED | GET /api/media?key= streams objects server-side (Content-Type correct, byte-perfect PNG round-trip); storageKey-only persistence; no storage host in client code                                                 |            |
| P0-010 | P0  | admin MQTT import runtime           | VERIFIED | root cause: mqtt@5 browser ESM has ONLY a default export → dynamic namespace had no `.connect`. Admin now uses shared realtime-core observer client; zero direct mqtt imports in UI                              |            |
| P0-011 | P0  | Web MQTT via shared adapter         | VERIFIED | web realtime-service is a thin wrapper over @mqtt-chat/realtime-core (LWT, presence announce, lifecycle wildcards); envelope contract fixed (nested `data`)                                                      |            |
| P0-012 | P0  | Mobile MQTT via shared adapter      | VERIFIED | mobile uses same ChatRealtimeClient; PUBLIC_HOST-derived single-origin URLs (iOS localhost / Android 10.0.2.2 / env override); typecheck+jest green                                                              |            |
| P0-020 | P0  | Identity switch correctness         | VERIFIED | connect() tears down prior session; resetTransient() drops identity-scoped state; switch flow = pause send → disconnect → clear → new session → resync                                                           |            |
| P0-021 | P0  | No stale sender identity            | VERIFIED | event handlers read active identity from store AT EVENT TIME (no captured closures); regression tests in chat-store.test.ts                                                                                      |            |
| P0-022 | P0  | Message perspective                 | VERIFIED | isMine = senderId === active identity (web MessageList + mobile ChatScreen by runtime id, never displayName)                                                                                                     |            |
| P0-030 | P0  | Conversation dedupe                 | VERIFIED | ONE id = ONE entity: upsertConversation everywhere incl. REST-create path; Map-dedupe in sidebar ordering; unit tests                                                                                            |            |
| P0-031 | P0  | Conversation create realtime        | VERIFIED | transactional outbox conversation.created; group-media-e2e observes full contract live (members+title)                                                                                                           |            |
| P0-032 | P0  | Group members                       | VERIFIED | members persisted in create transaction; payload carries full member summaries                                                                                                                                   |            |
| P0-033 | P0  | Add group member                    | VERIFIED | POST /api/conversations/:id/members → outbox conversation.member-joined (full post-change summary + addedUserIds); DetailsPanel "+ Add" UI; observed live without reload                                         |            |
| P0-040 | P0  | Optimistic message                  | VERIFIED | optimistic bubble reconciled by clientMessageId (smoke flow A)                                                                                                                                                   |            |
| P0-041 | P0  | Sending timeout                     | VERIFIED | bounded reconciliation timeout marks failed (never permanent Sending…); queued sends get longer bounded window                                                                                                   |            |
| P0-042 | P0  | Retry                               | VERIFIED | retry republishes SAME clientMessageId; backend dedup proven                                                                                                                                                     |            |
| P0-043 | P0  | Message dedupe                      | VERIFIED | single canonical event per clientMessageId (smoke dedup check)                                                                                                                                                   |            |
| P0-044 | P0  | Offline queue (QUEUED→flush)        | VERIFIED | web publishOrQueueSend queues while offline; flushQueuedMessages() on reconnect; unit regressions                                                                                                                |            |
| P0-045 | P0  | Sequence convergence + gap recovery | VERIFIED | monotonic lastSequence + gap refetch + reconnect recovery (unit + runtime)                                                                                                                                       |            |
| P0-050 | P0  | Presence                            | VERIFIED | tri-state snapshot + multi-device connectionCount; presence-e2e ALL PASS (isolated stack)                                                                                                                        |            |
| P0-051 | P0  | Typing                              | VERIFIED | typing events render with display names (ephemeral QoS0)                                                                                                                                                         |            |
| P0-052 | P0  | Read receipt                        | VERIFIED | receipt.read watermark advances; per-user topic delivery                                                                                                                                                         |            |
| P0-060 | P0  | Media upload                        | VERIFIED | POST /api/uploads multipart (same-origin) → durable key; unsupported types rejected; unknown conversation rejected                                                                                               |            |
| P0-061 | P0  | Media render web                    | VERIFIED | /media?key= relative URL renders IMAGE bubbles; immutable cache headers                                                                                                                                          |            |
| P0-062 | P0  | Media reload                        | VERIFIED | keys are durable; view resolves at READ time (no stale signed URLs possible)                                                                                                                                     |            |
| P0-063 | P0  | Media cross-platform                | VERIFIED | mobile mediaUrl(storageKey) → same public origin path; IMAGE rendering in ChatScreen                                                                                                                             |            |
| P0-070 | P0  | Bot system                          | VERIFIED | bot-e2e ALL PASS on isolated stack (commands, loop protection, rule toggle)                                                                                                                                      |            |
| P0-071 | P0  | Bot commands                        | VERIFIED | /help /status /users /stats /ping all reply exactly once                                                                                                                                                         |            |
| P0-072 | P0  | Bot rule hot reload                 | VERIFIED | disable → silence → enable → reply (5s cache window respected)                                                                                                                                                   |            |
| P0-073 | P0  | Bot loop prevention                 | VERIFIED | exactly one bot reply per command across redeliveries (deduped assertion)                                                                                                                                        |            |
| P0-080 | P0  | iOS safe area                       | VERIFIED | SafeAreaProvider + useSafeAreaInsets: header below top inset, composer above bottom inset/home indicator; tsc PASS (runtime sim check tracked in P0-107)                                                         |            |
| P0-081 | P0  | iOS keyboard/composer               | VERIFIED | KeyboardAvoidingView padding + inset-aware composer; compact ➤ send button                                                                                                                                       |            |
| P0-082 | P0  | Mobile chat UX                      | VERIFIED | grouped consecutive-sender bubbles (no repeated labels), timestamps, queued/sending/failed states, IMAGE rendering from storageKey                                                                               |            |
| P0-083 | P0  | Mobile identity picker              | VERIFIED | safe-area padded, scrollable, long names truncated, fixture-id filter (fx/e2e- hidden)                                                                                                                           |            |
| P0-084 | P0  | Mobile DIRECT peer label            | VERIFIED | A sees B's name / B sees A's; generic label only when no peer data exists                                                                                                                                        |            |
| P0-090 | P0  | Test DB isolation                   | VERIFIED | pnpm test:e2e boots isolated stack: DB mqtt_chat_test, Redis db 1, API :3011, topic fence chat/v1-e2e (contracts honor MQTT_TOPIC_NAMESPACE)                                                                     |            |
| P0-091 | P0  | Fixture manager + cleanup           | VERIFIED | scripts/lib/chat-fixture.mjs exact-ID cleanup; DELETE endpoints (409 when user owns messages); cleanup-dev-data.mjs audited+applied (10 convs/8 users/108 msgs)                                                  |            |
| P0-100 | P0  | format/lint/typecheck/test/build    | VERIFIED | pnpm validate green (format:check, eslint flat, turbo strict TS, vitest 61/61, next build w/ NODE_ENV guard)                                                                                                     |            |
| P0-106 | P0  | Web browser E2E via :3000           | VERIFIED | scripts/web-browser-e2e.mjs (puppeteer-core + system Chrome): 17/17 PASS — two contexts realtime group create/message/switch, /admin live stream, ZERO cross-origin requests, zero page/console errors           |            |
| P0-107 | P0  | Mobile simulator E2E                | VERIFIED | iPhone 16 Pro sim: app launches on NEW bundle (safe-area picker w/ runtime data via single-origin API — screenshot); typecheck+jest 7/7; UI tap-through remains P1-113 BLOCKED_EXTERNAL (macOS assistive access) |            |
| P0-120 | P0  | README reflects real developer flow | VERIFIED | rewritten: Quick Start ends at http://localhost:3000 only; routes table; internal ports marked internal                                                                                                          |            |
| P0-121 | P0  | .env.example matches reality        | VERIFIED | gateway origins documented; NEXT_PUBLIC_* optional same-origin defaults; mobile PUBLIC_HOST override                                                                                                             |            |
| P0-122 | P0  | Architecture docs current           | VERIFIED | docs/architecture.md + README diagram show gateway topology; contracts note namespace fencing                                                                                                                    |            |
| P0-123 | P0  | Repair log current                  | VERIFIED | bugs #17–#22 added w/ root causes (mqtt export shape, port sprawl, identity perspective, E2E pollution, NODE_ENV build trap, message contract)                                                                   |            |
| P0-140 | P0  | MESSAGE_CONTRACT_NORMALIZATION      | VERIFIED | ONE normalizeMessage() in realtime-core (shared web+mobile): reactions ALWAYS array, null-safe dates, senderName fallback; chat-worker emits reactions per contract; vitest 8 cases                              |            |
| P0-141 | P0  | MOBILE_REACTION_RENDER              | VERIFIED | ChatScreen uses normalized model + defensive `reactions ?? []` + **DEV** drift warning; jest render regression (react-test-renderer): message without reactions field renders, no crash — 10/10 mobile tests     |            |
| P0-142 | P0  | LEGACY_MESSAGE_COMPATIBILITY        | VERIFIED | legacy minimal payloads normalize safely (8 vitest cases); HTTP history 50/50 rows carry reactions array; fresh MQTT message.created carries reactions: [] (live probe); bot path uses same serializer           |            |

## Fixed bugs ledger (docs/repair-log.md)

#1–#16 (historical): render loop · subscriptions · bot double-reply · existence check ·
stale .next/zombie API · false offline · StrictMode handler loss · stuck Sending ·
reused-conversation missing members · clientId collision flap · lastSequence convergence ·
conversation.created realtime · image messages · iOS bundle URL · platform hosts ·
duplicate DIRECT race · mobile offline send queue.

#17 `mqtt.connect is not a function` (browser ESM default-export shape) ·
#18 no single public origin (gateway + /api prefix + streaming media + merged admin) ·
#19 identity-switch stale perspective · #20 E2E pollution (isolated stack + fixtures) ·
#21 NODE_ENV=development build trap · #22 message contract missing `reactions`
(canonical event omitted the field; mobile blind-cast to the UI model →
`item.reactions.length` crash — fixed with contract field + shared normalizeMessage).

## NEXT EXECUTABLE STEPS

All stabilization stages (1–12) COMPLETE. Final state (2026-08-24):
`pnpm verify:all` exit 0 (validate + 6 isolated E2E suites + 17 browser checks),
`pnpm verify:completion` exit 0 (48/48 ledger entries, all P0 VERIFIED).

Remaining advisory (non-blocking):

- P1-113 in-simulator tap-through (macOS assistive access) — external constraint.
- P1-110 web↔mobile cross-client E2E — protocol-level parity proven via shared
  realtime-core; scripted cross-device matrix still open.

## Environment facts

- Native toolchain PRESENT: Java 17, ANDROID_HOME set, Xcode 16.3, CocoaPods.
- Dev stack: `docker compose up -d && pnpm dev` → open ONLY http://localhost:3000.
- Shell exports NODE_ENV=development — web build script forces production explicitly (bug #21).
- Isolated E2E stack: `pnpm test:e2e` (test DB + redis db 1 + topic fence, auto-teardown;
  `node scripts/test-stack.mjs --keep` to leave it running).
- Browser E2E: `pnpm test:browser` (puppeteer-core + system Chrome, requires dev stack up).
