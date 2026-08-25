# System Re-Audit

Audit date: 2026-08-25  
Baseline: `main` at `85b65bc`  
Scope: executable source, schemas and migrations, shared contracts, tests, runtime behavior, development lifecycle, and the current Web/Mobile/API/MQTT integration.

## Architecture verified

### Runtime topology

- `apps/gateway` is the only public origin on port 3000. It proxies the Web UI, `/api/*`, `/media*`, and MQTT WebSocket `/mqtt` to internal services.
- `apps/web` is the Next.js application on internal port 3100. Chat is `/chat`; admin is `/admin`. The empty `apps/admin` directory is not a separately deployed application.
- `apps/mobile` is the React Native client. It uses the same REST and MQTT contracts as Web and has an explicit demo-identity picker/profile switcher.
- `apps/api` is the NestJS HTTP API on internal port 3001. It owns bootstrap/history queries, conversation and group lifecycle mutations, uploads, bot administration, and admin queries.
- `apps/chat-worker` is the authoritative command processor. It validates MQTT commands, checks membership/permissions, deduplicates, advances conversation sequence, persists domain state, writes the transactional outbox, and publishes canonical events.
- `apps/bot-worker` consumes canonical chat events/rules and sends `bot.send` commands back through chat-worker. It cannot bypass normal message validation or persistence.
- `apps/notification-worker` consumes canonical events and notifies offline recipients.
- EMQX carries commands and canonical events; PostgreSQL is durable truth; Redis stores ephemeral presence/typing and related fast state; MinIO stores uploaded media.

### Shared boundaries

- `packages/mqtt-contracts`: topic builders, QoS policy, schemas, and versioned event envelopes.
- `packages/realtime-core`: shared MQTT client behavior, canonical normalization, sequence handling, identity presentation, and bootstrap merge rules.
- `packages/database`: Prisma schema/client, migrations, direct-pair canonicalization, sequence and outbox storage.
- `packages/redis`: key builders and multi-device presence primitives.
- `packages/mqtt`, `packages/storage`, `packages/config`, `packages/logger`: transport, object storage, validated configuration, and structured logging.
- `packages/bot-sdk`, `packages/bot-rules`: bot command/rule processing with correlation, causation, cooldown, and loop protection.
- `packages/ui`, `packages/shared-types`, `packages/testing`: shared presentation, types, and test support.

Dependencies retain the required direction: apps may consume package public APIs; packages do not import apps.

### Canonical flows traced

1. **Send:** Web/Mobile creates an optimistic row keyed by `clientMessageId` → publishes a command → chat-worker validates envelope, membership, reply/media constraints, and deduplication → transactionally advances `Conversation.lastSequence`, writes `Message`, and writes outbox rows → canonical `message.created` reaches both sender and recipients → each client replaces/merges the optimistic row by `clientMessageId` and orders by sequence.
2. **Read/delivered:** client publishes a receipt command → chat-worker clamps the requested sequence to the conversation high-water mark and compare-and-advances `ConversationMember` → the same transaction writes user/member fan-out events → all devices converge from canonical `receipt.read`/`receipt.delivered`; bootstrap derives unread from `lastSequence - lastReadSequence` under the current domain semantics.
3. **Identity switch:** old Web/Mobile session stops handlers and timers, publishes intentional offline state, unsubscribes/disconnects once, and resets identity-scoped state → new REST and MQTT contexts are created → SUBACK completes → realtime buffering and REST bootstrap run → the buffer is replayed before live processing resumes.
4. **Reconnect/bootstrap:** subscription is established before the REST snapshot; incoming events are buffered; snapshot and buffered rows are merged by canonical identifiers/sequences. The same barrier is used during reconnect recovery, preventing snapshot overwrite and subscription gaps.
5. **Reply/media/group:** API validates group lifecycle and upload boundaries; reply/media commands are revalidated by chat-worker; canonical events carry reply/media/member/tombstone data; delete prevents later sends. Existing E2E suites cover the full supported lifecycle.
6. **Presence:** each device is a Redis set member; only real set transitions produce canonical presence events. A user remains online while any device connection remains.
7. **Bot/notification:** both consume canonical events. Bots re-enter through command handling; offline notification decisions use current presence state.

There is intentionally no production authentication in this demo. Identity is the selected `userId:deviceId`; authorization still exists at domain mutation boundaries such as conversation membership and group administration.

## Known regressions

| Issue                          | Classification                             | Finding                                                                                                                                                                                             |
| ------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BUG-01 Web/Mobile divergence   | REGRESSION + NEWLY DISCOVERED contributors | Shared sequence/dedup logic existed, but recent lifecycle/bootstrap paths did not establish a subscribe-before-fetch barrier and allowed stale history to overwrite newer realtime state.           |
| BUG-02 read/unread divergence  | REGRESSION                                 | Cross-device server fan-out included the reader, while Web explicitly discarded self receipts. Persistence also advanced outside the outbox transaction, so state and event delivery could diverge. |
| BUG-03 Mobile switch user      | NEWLY DISCOVERED                           | The picker and handler had not disappeared. The failure was session teardown/bootstrap correctness: timers, callbacks, pending snapshots, and MQTT sessions could outlive the selected identity.    |
| BUG-04 profile/avatar mismatch | REGRESSION                                 | A shared deterministic presentation helper existed but several Web/Mobile call sites still used local first-character logic, creating inconsistent initials and colors.                             |
| BUG-05 unstable `pnpm dev`     | REGRESSION                                 | Root process exit did not own and reap the complete Turbo process group. Orphaned descendants occupied ports and later starts reported secondary `ELIFECYCLE`, force-kill, or exit-130 symptoms.    |

## Newly discovered issues

- MQTT `connect()` reported readiness before SUBACK, so bootstrap could begin with a real event gap.
- REST history results could replace live rows that arrived while the request was in flight.
- Web typing/presence timers survived identity reset; the per-conversation read watermark ref was not reset.
- Critical read-receipt publish errors were swallowed, leaving no deterministic retry after reconnect.
- Broker client IDs based only on `Date.now()` collided during rapid React Strict Mode/session replacement, causing EMQX session-takeover reconnect loops.
- Concurrent old-route cleanup and new-session setup could disconnect the same logical session twice and emit duplicate offline transitions.
- Redis presence handlers emitted canonical events for duplicate SADD/SREM/no-op commands.
- Reaction persistence and outbox emission were not one state transition; duplicate QoS 1 delivery could emit duplicate canonical reaction events.
- Outbox rows were selected with `FOR UPDATE SKIP LOCKED` outside a lasting transaction, so multiple replicas could publish the same row concurrently.
- E2E MQTT simulations silently depended on an orphan gateway at port 3000. A clean machine failed, while a dirty developer machine appeared green.
- The event contract did not include `receipt.delivered`, despite producer/consumer behavior requiring it.

## Root causes

### RC-01 — Development process ownership

**Symptom:** repeated starts failed on occupied ports; watcher output showed force-kill/`ELIFECYCLE`; root Ctrl+C could leave gateway, Web, API, or workers alive.

**Root cause:** the root script delegated directly to Turbo and had no durable owner for the full process group after terminal/root-parent death.

**Evidence:** a baseline stack had a PPID-1 root and live descendants. SIGTERM of the visible parent left service ports occupied. Port preflight then correctly exposed those orphans as the first failure.

**Affected paths:** `package.json`, `scripts/dev.mjs`, `apps/api/src/main.ts`, `apps/web/package.json`.

**Fix:** a supervisor launches Turbo in its own process group; a detached watchdog forwards INT/TERM and reaps that exact group if the supervisor disappears. API shutdown hooks are enabled. The Web production build explicitly uses supported webpack mode in this managed environment.

**Regression protection:** manual root start, service-ready check, chat-worker hot restart, Ctrl+C, and post-exit port/process inspection all passed without a restart or force-kill loop.

### RC-02 — Receipt state and canonical event were not one transition

**Symptom:** read badges could reappear or disagree across Web, Mobile, reload, and devices; self-device convergence failed; invalid future receipt sequences could advance state.

**Root cause:** receipt persistence and outbox fan-out were separate operations; updates were not compare-and-advance; input was not clamped; Web ignored the reader's own canonical event; publish failures did not remain retryable.

**Evidence:** producer fan-out included the actor but the Web reducer filtered `actorId === currentUserId`. The repository update occurred before outbox insertion, and stale/future commands had no atomic high-water guard.

**Affected paths:** `apps/chat-worker/src/handlers/receipts.ts`, `packages/mqtt-contracts/src/events.ts`, `apps/web/src/lib/canonical-events.ts`, `apps/web/src/components/MessageList.tsx`, `apps/mobile/src/hooks/useChatSession.ts`.

**Fix:** compare-and-advance and bounded sequence checks now execute in the same transaction as outbox fan-out; both clients apply self receipts; Web resets watermarks per conversation; failed receipt publication remains pending and retries after reconnect. `receipt.delivered` is part of the shared schema.

**Regression protection:** unit tests cover self read routing and stale monotonic updates; E2E verifies reader device 1, reader device 2, sender ticks, REST persistence, unread derivation, and stale non-regression.

### RC-03 — Bootstrap and realtime lacked a consistency barrier

**Symptom:** Web and Mobile showed different conversations/messages/last message after initial load or reconnect; a newer realtime row could disappear when an older REST request completed.

**Root cause:** subscription readiness was assumed before SUBACK, and snapshot assignment did not merge events received during the fetch.

**Evidence:** both clients had fetch/subscribe timing windows; history loaders replaced arrays; MQTT core resolved connection on socket connect rather than successful subscriptions.

**Affected paths:** `packages/realtime-core/src/index.ts`, `packages/realtime-core/src/bootstrap-merge.test.ts`, `apps/web/src/app/chat/page.tsx`, `apps/mobile/src/hooks/useChatSession.ts`, `apps/mobile/src/features/messaging/message-lifecycle.ts`.

**Fix:** wait for SUBACK; buffer during initial bootstrap and reconnect recovery; merge snapshots with live rows by canonical IDs/client IDs; replay buffered envelopes through the normal reducer; reject early socket close.

**Regression protection:** shared merge tests cover live-over-stale behavior; Web reducer tests cover canonical ordering/dedup; Mobile lifecycle tests cover stale history; Web–Mobile E2E verifies immediate discovery, same `clientMessageId`, one DB entity, and no duplicate after redelivery.

### RC-04 — Identity session cleanup was neither isolated nor serialized

**Symptom:** Mobile switching could retain old state/subscriptions; rapid Web identity replacement produced periodic online/offline flapping; duplicate cleanup emitted duplicate offline commands.

**Root cause:** module-scope timers and callbacks survived store reset; stale async callbacks could act on a newer core; millisecond-only broker IDs collided; two callers could run teardown concurrently.

**Evidence:** browser/runtime logs showed a two-second EMQX takeover loop after a rapid switch. Rapid ID generation reproduced duplicates with the old algorithm. Concurrent teardown reached presence/disconnect twice.

**Affected paths:** `packages/realtime-core/src/client-id.test.ts`, `apps/web/src/lib/realtime-service.ts`, `apps/web/src/store/chat-store.ts`, `apps/web/src/app/chat/page.tsx`, `apps/mobile/src/hooks/useChatSession.ts`.

**Fix:** broker IDs include a UUID nonce; callbacks are accepted only from the active core; disconnect is single-flight; stale teardown cannot clear a newer session; timers/handlers/buffers are canceled on identity reset; intentional MQTT close is graceful.

**Regression protection:** tests generate 100 unique rapid client IDs, assert concurrent disconnect publishes offline/disconnects once, and verify timer cleanup. Browser E2E identity switching completed without console errors or periodic presence flapping.

### RC-05 — Presentation logic was only partially centralized

**Symptom:** identical users could have different initials/avatar colors across lists, messages, groups, and clients.

**Root cause:** several call sites continued to slice one character or choose a local color after the shared canonical helper was introduced.

**Evidence:** repository search found duplicated initials/color construction in both Web and Mobile presentation paths.

**Affected paths:** `apps/web/src/components/MessageBubble.tsx` and Mobile profile, identity picker, conversation list, new-conversation, and group-detail components.

**Fix:** all audited fallback call sites use shared `initialsFromDisplayName` and stable user/conversation-key palette semantics.

**Regression protection:** five shared presentation tests cover Unicode/name cases and deterministic key mapping; Web/Mobile compile against the same public package API.

### RC-06 — QoS 1 idempotency gaps in reactions and outbox

**Symptom:** duplicate command delivery or multiple worker replicas could produce duplicate canonical events even when final DB state looked correct.

**Root cause:** reaction mutation and outbox insertion were separate; removal emitted regardless of a real transition; row locks ended before MQTT publication.

**Evidence:** add/remove handlers emitted after non-atomic repository calls. The outbox selection lock was acquired without enclosing publication/marking in the same transaction.

**Affected paths:** `apps/chat-worker/src/handlers/reactions.ts`, `apps/chat-worker/src/outbox.ts`.

**Fix:** add/remove state transitions and outbox writes are transactional; duplicate add and no-op remove emit nothing; outbox claim/publish/mark occurs while an explicit `SKIP LOCKED` transaction owns the row; shutdown waits for in-flight publication.

**Regression protection:** all message redelivery, bot, group, and integration suites pass with a single canonical entity/event outcome.

### RC-07 — E2E harness had a hidden external dependency

**Symptom:** E2E passed with an orphan dev gateway but failed on a clean host with `ECONNREFUSED :3000`.

**Root cause:** TypeScript E2E clients inherited the public WebSocket default rather than the isolated EMQX endpoint used by the test stack.

**Evidence:** after orphan cleanup, `web-mobile-discovery-e2e` was the first clean-host failure. Starting an unrelated gateway masked it.

**Affected path:** `scripts/test-stack.mjs`.

**Fix:** the harness explicitly supplies `MQTT_WS_URL=ws://localhost:8083/mqtt` to every isolated client simulation.

**Regression protection:** all 10 E2E flows pass with no dev stack on port 3000.

### RC-08 — Presence producer emitted no-op transitions

**Symptom:** transport duplicate/offline boundaries could generate multiple identical canonical presence events and unnecessary UI mutations/notifications.

**Root cause:** Redis set operations returned the resulting presence snapshot but not whether membership actually changed; the worker always published.

**Evidence:** runtime teardown produced multiple offline commands, and duplicate SADD/SREM paths had unconditional outbox publication.

**Affected paths:** `packages/redis/src/index.ts`, `apps/chat-worker/src/handlers/presence.ts`.

**Fix:** presence repository operations return `{ info, changed }`; chat-worker publishes only real set membership transitions while still preserving device last-seen behavior.

**Regression protection:** three Redis unit tests cover first add, duplicate add, real remove, and duplicate remove. Multi-device/LWT E2E returns exactly to baseline without false offline.

## Fixes

- Restored stable root dev lifecycle, graceful API/MQTT shutdown, and deterministic production Web builds.
- Made receipt, reaction, presence, and outbox paths authoritative, atomic, monotonic, and idempotent.
- Closed initial bootstrap, reconnect, history overwrite, optimistic reconciliation, and identity teardown races on both clients.
- Unified deterministic profile fallback presentation without redesigning the UI.
- Made integration tests hermetic instead of dependent on stale developer processes.
- Added targeted protection for each reproduced invariant violation and kept existing direct conversation, reply, media, group permission/tombstone, notification, and bot behavior intact.

No schema migration was needed: the existing database already has unique direct-pair/member/message constraints, global `clientMessageId` deduplication, per-conversation sequence uniqueness, member read/delivered watermarks, and tombstone support.

## Regression tests

- Vitest: 17 files, 120 tests, all passing.
- Mobile Jest: 5 suites, 51 tests, all passing as part of `pnpm validate`.
- New/expanded unit coverage:
  - canonical user initials/color mapping;
  - event envelope and `receipt.delivered`;
  - bootstrap live-over-snapshot merge;
  - rapid broker client-ID uniqueness;
  - concurrent realtime teardown serialization;
  - self/stale canonical read reducer behavior;
  - identity timer cleanup;
  - Redis presence transition/no-op behavior;
  - Mobile message lifecycle stale-history protection.
- Integration/E2E: 10 isolated flows all passing:
  1. send → canonical event, dedup, history, bot response;
  2. bot commands, loop protection, rule enable/disable, logs;
  3. multi-device presence, no false offline, LWT cleanup;
  4. concurrent direct uniqueness and legacy-row adoption;
  5. group creation plus media upload/MIME/byte round-trip;
  6. offline notification;
  7. Web–Mobile realtime discovery, optimistic ack, redelivery dedup, member propagation;
  8. reply persistence and fast invalid-reply rejection, media MIME validation;
  9. group permission/member/leave/delete/tombstone/post-delete rejection lifecycle;
  10. multi-device read convergence, sender ticks, REST watermark persistence, stale non-regression.

## Validation

Final clean validation:

| Gate                     | Result                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Format check             | PASS                                                                                                                     |
| ESLint                   | PASS                                                                                                                     |
| TypeScript               | PASS across all 20 Turbo tasks/packages                                                                                  |
| Unit tests               | PASS — 17 Vitest files / 120 tests                                                                                       |
| Mobile tests             | PASS — 5 Jest suites / 51 tests                                                                                          |
| Integration/E2E          | PASS — 10/10 isolated system flows                                                                                       |
| Build                    | PASS — Web routes `/`, `/admin`, `/chat`; all workspace build tasks pass                                                 |
| `pnpm dev` smoke         | PASS — all services ready, chat-worker hot restart clean, no restart/force-kill loop                                     |
| Shutdown                 | PASS — Ctrl+C released ports 3000/3001/3100 and worker process group                                                     |
| Browser walkthrough      | PASS — group discovery, send/receive, user switch, admin health/live event; zero page/console/cross-origin errors        |
| Final diff/status review | PASS after removal of generated `next-env.d.ts` dev noise; no secret, dump, build output, or temporary artifact included |

The `normalizeMessage` warnings in unit output are intentional contract-drift test fixtures. Prisma's package.json configuration deprecation warning is non-failing and does not change current Prisma 6 behavior.

## Remaining risks

These are non-blocking future improvements, not reproduced failures in the supported demo:

- Clients currently subscribe to the broad namespaced canonical event wildcard and filter membership client-side; per-conversation subscription methods are no-ops. This matches current no-auth demo behavior but should be replaced by broker ACLs/narrow subscriptions before production privacy or large-scale use.
- `avatarUrl` is a canonical API field, but current seed data and UI expose deterministic fallback avatars only; custom avatar upload/rendering is not an implemented product flow. If added, both clients must consume the same validated URL/storage contract.
- The outbox keeps a database transaction/row lock open across bounded MQTT publication to guarantee multi-replica exclusivity. A future lease/claim state machine could reduce lock duration at larger throughput.
- Migrate Prisma configuration from `package.json#prisma` before upgrading to Prisma 7.
- Web builds use webpack explicitly because Turbopack process/port behavior is restricted in the managed validation host; this is a supported build path, not an application runtime failure.

`docs/SYSTEM_OVERVIEW_PRESENTATION.md` was deliberately left unchanged. Where older documentation differs from executable behavior, this audit follows current code, schema/migrations, shared contracts, tests, and runtime evidence in that order.
