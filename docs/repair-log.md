# Repair Log

## 2026-08-23 — Session: web realtime + render-loop fixes

### Bug #1 — Infinite render loop in `MessageList` (web)

**Symptom:** Opening a conversation in the web app triggered an endless
re-render cycle; React eventually bailed with "Maximum update depth exceeded".

**Root cause:** `MessageList` used an inline object/array as a store selector
(e.g. `useChatStore((s) => s.messages.filter(...))`), producing a new reference
every render → zustand re-rendered on every store tick → loop.

**Fix:** Select stable primitives/references only; derive filtered lists with
`useMemo` outside the selector.

**Verified:** Conversation opens and renders without console errors.

### Bug #2 — Web client received no realtime events (pending stuck at "Sending…")

**Symptom:** Messages sent from the UI stayed "pending" forever; incoming
messages from other users/bots never appeared without a manual reload.

**Root cause:** The web `RealtimeService` subscribed to per-conversation
wildcard topics (`chat/v1/conversations/{id}/events/#`), but chat-worker's
transactional outbox publishes canonical events on **flat per-event-type
topics** (`chat/v1/events/message/created`, …). The subscription patterns
never matched any published topic, so no event ever reached the UI.

**Fix:**

- `packages/mqtt-contracts`: added `userEventsWildcardTopic(userId)` builder
  (`chat/v1/users/{id}/events/#`) for per-user targeted delivery (receipts).
- `apps/web/src/lib/realtime-service.ts`:
  - `subscribeConversation()` now subscribes to flat wildcards:
    `chat/v1/events/{messageCreated,messageEdited,messageDeleted,reactionAdded,reactionRemoved}/#`
  - `subscribeGlobal()` subscribes to presence/typing flat wildcards plus
    `userEventsWildcardTopic(userId)` for receipts.
- Regression test added in `packages/mqtt-contracts/src/topics.test.ts`
  locking client subscription patterns to every published event topic shape
  (conversation-scoped, global ephemeral, per-user targeted).

**Verified:**

- Unit tests: 41/41 pass (`pnpm test`).
- E2E smoke (`scripts/smoke.mjs`) against live stack: message flow,
  **single canonical event (dedup PASS)**, bot `/ping` → `pong 🏓`,
  history persistence — all PASS.
- Browser: history loads (incl. persisted reactions); send path reaches
  chat-worker and persists (message.created logged with sequence).

### Environment issues found & cleaned during verification

- Background `pnpm dev` terminals were being killed by the harness after
  ~10 minutes; dev stack is now run detached via `nohup pnpm dev >
/tmp/mqtt-dev.log 2>&1 &`.
- Zombie worker processes from earlier runs (duplicate chat-worker /
  bot-worker / notification-worker instances) caused duplicate outbox
  publishing (smoke reported 2 identical events). Killed stale PIDs;
  re-ran smoke → dedup PASS. Note: concurrent outbox publishers can
  double-publish because `FOR UPDATE SKIP LOCKED` locks are released when
  the raw query completes, not when publish+mark finishes — acceptable for
  the demo (consumers are idempotent by eventId/clientMessageId) but worth
  hardening later (e.g. claim rows with an UPDATE ... RETURNING).
- Puppeteer browser automation was flaky (auto-closed by non-browser tools;
  keyboard input intermittently not delivered), limiting interactive UI
  verification. Realtime receive is verified at the protocol level via the
  smoke subscriber using the exact same topic patterns as the web client.

### Bug #3 — Bot replied twice to a single command (spurious usage reply)

- **Symptom**: sending `/ping` produced TWO bot messages: the expected
  `pong 🏓` plus an unrelated `Cách dùng: /status <user>`.
- **Root cause**: `apps/bot-worker/src/index.ts` bridged every
  `message.created` event through ALL dynamic responder action types in
  order (`reply_status`, `reply_users`, `reply_stats`, `reply_room`) and
  stopped at the first one that "handled" it. `DynamicResponder.respond`
  treats a missing `/status <user>` argument as a handled case (usage
  reply), so ANY command that no DB rule matched got a spurious status
  usage message.
- **Fix**: map command name → action type explicitly
  (`status→reply_status`, `users→reply_users`, `stats→reply_stats`,
  `room→reply_room`); the bridge now returns early when the parsed command
  has no dynamic responder. Verified with new `scripts/bot-e2e.mjs`
  (loop-protection check asserts exactly ONE bot reply per user command).

### Bug #4 — Uploads `complete` accepted keys that were never uploaded

- **Symptom**: `POST /uploads/complete` returned 201 for arbitrary keys —
  the storage-existence check never fired.
- **Root cause**: `S3CompatibleStorage.getUrl()` only MINTS a presigned GET
  URL; it performs no request against storage, so it can never throw for a
  missing object. The controller's try/catch around it was dead code.
- **Fix**: added `ObjectStorage.exists(key)` implemented with
  `HeadObjectCommand` (handles `NotFound` / `NoSuchKey` / HTTP 404 shapes);
  controller now rejects unknown keys with 404. Verified by
  `scripts/upload-e2e.mjs`: presign → PUT → complete PASS, and negative
  check (never-uploaded key) correctly returns 404.

### Extended verification (session 2)

- `scripts/bot-e2e.mjs` — ALL PASS:
  built-in commands (/help /status /users /stats), loop protection
  (exactly 1 bot reply per command), rule disable via admin API stops
  replies, rule re-enable restores them, bot event/command/execution logs
  recorded. Note: rule engine caches rules for 5s, so admin toggles take
  up to ~5s to take effect.
- Realtime receive verified in the actual browser UI: a message published
  as `alice` over MQTT while the web client was open appeared in both the
  conversation list preview and the message list without reload
  (Bug #2 fix confirmed end-to-end).
- Media upload flow verified end-to-end against MinIO (see Bug #4).
- Admin app serves HTTP 200 on :3002.

### Bug #5 — Web runtime: `Cannot find module './289.js'` (stale .next + zombie API)

- **Symptom**: web app showed Next.js runtime overlay
  `Cannot find module './289.js'` from `webpack-runtime.js`.
- **Root cause**: two compounding environment problems:
  1. A `pnpm build` was run while the dev server held `apps/web/.next`,
     corrupting the dev chunk manifest (build output overwrote dev chunks).
  2. A **zombie API process** from an earlier session still held port 3001,
     so the freshly started API failed with `EADDRINUSE :::3001` and the
     browser kept talking to the OLD api instance (running pre-fix code).
- **Fix**: killed ALL node/tsx/next/turbo processes and freed ports
  3000/3001/3002 (`lsof -ti :3000 | xargs kill -9`), removed
  `apps/web/.next`, `apps/admin/.next`, `.turbo`, then clean restart.
  Rule going forward: never run `pnpm build` while `pnpm dev` is running.

### Upgrade — Next.js 15.3 → 16.3.2 + React 19.1 → 19.2.8

- Upgraded `apps/web` and `apps/admin`: next ^16.3.2, react/react-dom
  ^19.2.8, @types/react ^19.2.18.
- No config changes needed (`transpilePackages` works as-is on Next 16).
- Verified: web typecheck PASS, web build PASS (routes /, /chat),
  full-stack clean start with 0 errors in dev log.

### Runtime verification after recovery (browser, Next 16)

- Main page `/`: renders identity picker, HTTP 200, no console errors.
- Identity persisted; `/chat` loads conversation list from API.
- Opened General: history loads (bot messages, /ping→pong, alice's
  realtime message visible in sidebar preview AND message list).
- Browser keyboard input into composer remains blocked by the automation
  harness (known limitation) — send path verified at protocol level via
  smoke E2E instead.

### Bug #6 — False "Offline" presence on load (architecture stabilization)

- **Symptom**: every member showed a gray "offline" dot immediately after
  page load, even when they were actively connected.
- **Root cause**: bootstrap explicitly called `setPresence(u.id, false)`
  for ALL users before any presence data existed, and `DetailsPanel`
  defaulted missing presence to offline (`?? false`). Presence is only
  updated by realtime events, so a fresh page load always showed everyone
  offline until events happened to arrive.
- **Fix**:
  - New server-authoritative snapshot endpoint `GET /presence?userIds=…`
    reading the Redis presence sets written by chat-worker
    (`apps/api/src/redis.service.ts` + ChatController).
  - Web bootstrap now fetches the snapshot and applies it; users absent
    from the response stay UNKNOWN — never rendered as offline.
  - `DetailsPanel` renders tri-state dots: green (online), gray
    (server-confirmed offline), hollow border (unknown).

### Bug #7 — Connection badge stuck "Offline" + browser deaf to realtime events

- **Symptom**: header badge permanently showed "Offline" although MQTT WS
  connectivity was fine (verified independently with mqtt.js over WS);
  incoming messages never appeared live in an open tab.
- **Root cause**: React StrictMode (default-on in Next.js dev) double-
  invokes effects. The first effect run registered state/event handlers on
  the singleton RealtimeService; its cleanup then UNREGISTERED them; the
  second run early-returned on the `bootstrapped` ref guard — so handlers
  were permanently detached while the MQTT connection lived on. The store
  never received "connected" or any event.
- **Fix**: handlers are registered once for the page lifetime and no
  longer unregistered in effect cleanup (the service is a page-lifetime
  singleton). Verified: badge shows "Connected"; a message published over
  MQTT while the tab was open appeared via the "Jump to newest" indicator
  without reload.

### Bug #8 — Optimistic messages could remain "Sending…" forever

- **Symptom**: if the canonical `message.created` event was missed
  (subscribe race, reconnect gap), the optimistic bubble stayed pending
  indefinitely with no failure path.
- **Fix**: message state machine completed client-side:
  - every send arms a 10s reconciliation timeout keyed by clientMessageId;
  - timeout → status "failed" with a visible ↻ Retry button;
  - retry re-publishes the SAME clientMessageId — chat-worker dedupes by
    it, so retries are idempotent (no duplicate messages).

### Stabilization session verification

- `GET /presence` returns live Redis-backed presence (alice online via
  device observed in response).
- Browser: sidebar avatars show correct presence dots from snapshot;
  header badge "Connected"; realtime arrival confirmed via Jump-to-newest.
- web typecheck PASS, full lint PASS.

### Quality gates at end of session

```
pnpm lint       ✓
pnpm typecheck  ✓ (18 tasks)
pnpm test       ✓ (41/41)
pnpm build      ✓
smoke E2E       ✓ (flow A, dedup, bot reply, history)
bot E2E         ✓ (commands, loop protection, rule toggle, logs)
upload E2E      ✓ (presign, PUT, complete, negative 404)
web runtime     ✓ (Next 16, browser render, no console errors)
```

## Bug #9 — Sidebar crash on conversations missing `members`

- **Symptom**: Sidebar threw when a conversation in the list had no
  `members` array (API `findFirst` without `include: { members: true }`
  for reused conversations) — `.map`/`.find` on undefined.
- **Fix**: chat controller always includes members; Sidebar/DetailsPanel
  render defensively (`members ?? []`); regression test covers
  malformed-conversation payloads (suite 50/50).

## Bug #10 — clientId collision reconnect flap (web)

- **Symptom**: continuous `presence.online` / `presence.offline` event churn
  (~1 pair every 2s) whenever the same identity had two live MQTT sessions
  (zombie tab + fresh tab); UI badge flipped to "Offline" while the page was
  open. EMQX `clients list` showed the client re-created every few seconds.
- **Root cause**: `apps/web/src/lib/realtime-service.ts` built the MQTT
  clientId as bare `userId:deviceId`. MQTT brokers kick the existing
  connection when a new one with the same clientId connects (takeover); the
  kicked client's auto-reconnect then kicks the new one back — an endless
  takeover loop between the two sessions. `packages/realtime-core` already
  appended `Date.now()`; the web service did not.
- **Fix**: web realtime-service clientId is now
  `${userId}:${deviceId}:${Date.now()}` (unique per connection; the logical
  deviceId stays in the actor envelope for presence accounting).
  `scripts/two-client-listener.mjs` nonce'd too (`pid:timestamp`) after two
  overlapping listener instances reproduced the same flap.
- **Verification**: browser session stays "Connected" with zero presence
  flapping; two-client E2E action matrix (typing, send, edit, delete,
  reaction, read receipt) all observed on canonical topics.

## 2026-08-23 — Session: cross-client sync / realtime group creation / media / iOS bundle

### Bug #11 — Conversation list stale across clients (lastSequence mismatch, P0-A)

- **Symptom**: two Web clients showed different `lastSequence`/previews for
  the same conversation; a client that missed events stayed stale until a
  manual reload.
- **Root cause**: the web `handleEvent("message.created")` updated only the
  message list — the conversation entry (`lastSequence`, preview, timestamp)
  was never advanced, there was no sequence-gap detection, and no recovery
  refetch after an MQTT reconnect.
- **Fix** (`apps/web`):
  - `chat-store.ts`: new `upsertConversation` + `applyMessageActivity`
    (monotonic — never regresses `lastSequence` under QoS1 duplicates).
  - `chat/page.tsx`: `message.created` now advances the conversation entry;
    a canonical event with `sequence > lastKnown + 1` triggers
    `recoverSequenceGap()` (history fetch `after=lastKnown`, merged by id);
    a `reconnecting/disconnected → connected` transition triggers
    `recoverAfterReconnect()` (refetch conversations + active messages).
- **Regression**: `chat-store.test.ts` "conversation list realtime
  convergence" suite (advance, no-regress, upsert insert/replace).

### Bug #12 — New group appeared only after reload (P0-B)

- **Symptom**: creating a group persisted it, but other members' clients did
  not show it until leaving/re-entering or refreshing the page.
- **Root cause**: `POST /conversations` wrote the DB row only — no canonical
  `conversation.created` event existed anywhere in the pipeline, and web
  clients neither subscribed to conversation lifecycle topics nor handled
  the event.
- **Fix**:
  - `packages/mqtt-contracts/src/events.ts`: canonical
    `conversationCreatedDataSchema` (mirrors the REST list item; `members`
    required) + `conversation.created` added to `EVENT_SCHEMAS`.
  - `apps/api/chat.controller.ts`: conversation row + `conversation.created`
    outbox event inserted in ONE transaction; chat-worker's outbox relay
    publishes it to EMQX (server-authoritative path preserved).
  - `apps/web/realtime-service.ts`: `subscribeGlobal` now subscribes
    `conversation.created/updated/member-joined/member-left`.
  - `apps/web/chat/page.tsx`: `conversation.created` handler inserts the
    conversation if self is a member and subscribes to its message topics.
- **Regression**: `scripts/group-media-e2e.mjs` — HTTP create → canonical
  event observed on `chat/v1/events/conversation/created` with full contract.

### Bug #13 — Image messages rendered broken (P0-C)

- **Symptom**: an image message existed but the browser showed a broken
  image.
- **Root cause** (three stacked defects):
  1. web `handleEvent` coerced every realtime message `type` to `"TEXT"`,
     so IMAGE messages lost their type on receipt;
  2. `Composer` stored the raw storage key as `metadata.url` and
     `MessageBubble` used it directly as `<img src>` — a relative,
     non-fetchable path;
  3. no endpoint existed to resolve a storage key to a fetchable URL.
- **Fix**:
  - `chat/page.tsx`: canonical `type` is preserved.
  - `Composer`: metadata carries a durable `storageKey` (never a signed URL
    or dev host).
  - `apps/api/uploads.controller.ts`: new `GET /uploads/view?key=…` —
    strict key pattern (`media/{conversationId}/{ts}-{name}`), existence
    check, then 302 → short-lived presigned GET. URLs are minted per
    request so they can never be stale in history.
  - `MessageBubble`: resolves `storageKey`/legacy `url` via `mediaViewUrl()`
    at read time; non-text messages without resolvable media render an
    explicit attachment fallback, never a broken `<img>`.
- **Regression**: `scripts/group-media-e2e.mjs` — presign → PUT (with
  content-type) → complete → IMAGE message → `/uploads/view` 302 → object
  GET 200 `image/png` → byte round-trip → invalid key 404.

### Bug #14 — iOS simulator "No script URL provided" (P0-D)

- **Symptom**: launching the installed RN app in the iOS simulator failed
  with "No script URL provided…". After the bundle fix, the app rendered
  its own error state: "Network request timed out."
- **Root cause** (two stacked defects):
  1. `AppDelegate.bundleURL()` relied on `RCTBundleURLProvider` saved
     defaults, which exist only after a launch via `run-ios`; a fresh
     simulator / direct launch had no saved host and the DEBUG provider
     produced no URL.
  2. The mobile app hardcoded the ANDROID-emulator host alias `10.0.2.2`
     for both API and MQTT WS on every platform — on the iOS Simulator
     (which shares the host loopback) that address does not exist, so every
     request timed out.
- **Fix**:
  - `AppDelegate` pins `jsLocation = "localhost"` in DEBUG before resolving
    the bundle URL — Metro (port 8081) is the deterministic dev bundle
    source regardless of how the app was launched.
  - New `apps/mobile/src/lib/config.ts`: platform-aware `DEV_HOST`
    (iOS → `localhost`, Android → `10.0.2.2`) with `MQTT_CHAT_API_URL` /
    `MQTT_CHAT_MQTT_WS_URL` env overrides (no source edits per environment;
    LAN devices set the overrides). `lib/api.ts` and `useChatSession` now
    consume it.
- **Verification** (iPhone 16 Pro sim, iOS 18.4):
  - `xcodebuild -workspace MqttChat.xcworkspace -scheme MqttChat
-configuration Debug build` → BUILD SUCCEEDED.
  - `simctl install` + `simctl launch` OK (PID logged).
  - Metro log: `BUNDLE ./index.js` served to the app (no "No script URL
    provided").
  - Screenshot: identity picker renders with the user list fetched from the
    API through the platform-aware base URL.
  - mobile `tsc --noEmit` PASS; jest 4/4 PASS.
  - Remaining manual step: tapping an identity in the simulator UI (UI
    automation requires assistive access, error -1719 — no idb/simctl tap
    available). All underlying flows (bundle, API, MQTT WS loopback) are
    verified reachable from the simulator host.

# Bug #15 — Duplicate DIRECT conversations possible (TOCTOU race, no DB invariant)

- **Symptom**: Two clients creating a direct conversation with the same user
  pair concurrently (e.g. both sides tap each other) could each insert their
  own DIRECT row → duplicate conversations with different generated ids,
  duplicated sidebar entries.
- **Root cause**: Uniqueness was enforced ONLY by a non-transactional
  `findFirst` check in `POST /conversations` (check-then-insert). The
  `Conversation` table had no uniqueness constraint for direct pairs — the DB
  happily accepted two rows for the same member set.
- **Fix** (canonical layer):
  - `Conversation.directPairKey` (sorted `userIdA:userIdB`, computed
    SERVER-SIDE via `directPairKeyFor()` in @mqtt-chat/database; never trusted
    from the client) + UNIQUE index — order-independent canonical key.
  - Migration `20260823120000_direct_pair_key`: ADD COLUMN + backfill existing
    DIRECT rows (legacy seed rows carry a third system-bot member; the key uses
    the two lexicographically first member ids) + UNIQUE constraint. If
    duplicate pairs existed, the constraint creation fails LOUDLY (explicit
    repair required, never silent deletion).
  - API: fast-path reuse by `findUnique({ directPairKey })`; race window
    closed by catching Prisma P2002 inside create and reusing the winner's row;
    DIRECT now requires exactly two distinct memberIds.
- **Regression test**: `scripts/duplicate-direct-e2e.mjs` — creates two RUNTIME
  users, fires 8 concurrent creates (both A→B and B→A orderings), asserts all
  responses share ONE conversation id and the DB holds exactly one row with the
  canonical pair key. Result: 7/7 PASS. Plus `directPairKeyFor` unit tests
  (order-independence, canonical sort, arbitrary runtime ids, identical-member
  rejection) — vitest suite 58/58 PASS.

# Bug #16 — Mobile send while MQTT disconnected rejected immediately

- **Symptom**: Sending a message on mobile while the MQTT connection was down
  surfaced "MQTT not connected" as an immediate FAILED bubble (or unhandled
  rejection from best-effort commands); user had to manually retry after
  reconnect even though delivery would have succeeded.
- **Root cause**: `ChatRealtimeClient.publish` rejects when not connected and
  `MessageLifecycleStore.send` mapped any rejection straight to FAILED — no
  queued state; `markRead`/`setTyping` were fire-and-forget promises that could
  reject unhandled.
- **Fix**:
  - `MessageLifecycleStore` gained an `isConnected` gate: sends while offline
    become QUEUED (bounded by the same reconciliation timeout — no
    forever-queued), new `flushQueued()` publishes them on reconnect;
    publish failures during flush are caught → failed/retryable.
  - `useChatSession` wires the gate (`client.status === 'connected'`) and calls
    `flushQueued()` on the offline→connected transition.
  - `markRead`/`setTyping` now `.catch(() => {})` (best-effort ephemeral
    commands — dropped silently when disconnected).
- **Regression test**: jest `message-lifecycle.test.ts` 7/7 PASS —
  disconnected send → queued (nothing published), flushQueued publishes once +
  reconcile clears, flush failure → failed → retry succeeds, timeout bounds
  queued messages. Mobile `tsc --noEmit` PASS.

# Audit — Zero unhandled promise rejections

- All `void`-called async functions across web+mobile verified to catch
  internally (web: recoverAfterReconnect/recoverSequenceGap/loadOlder/
  uploadFile/createConversation; mobile: openConversation/sendMessage/
  retryMessage via lifecycle store).
- Web `publishCommand` uses callback-less mqtt.js `publish` (packets buffer
  while offline and drain on reconnect — no promise rejection path).

# Bug #17 — Admin dashboard crashed: `mqtt.connect is not a function`

- **Symptom**: Opening the admin dashboard threw `mqtt.connect is not a
function` at runtime from `admin-api.ts`; the live event stream never came up.
- **Root cause**: `mqtt@5.15.2`'s browser ESM bundle (`dist/mqtt.esm.js`,
  selected via the package `exports` map's `browser → import` condition) has
  ONLY a default export — there is no named `connect`. The admin code used
  `import("mqtt").then((mqtt) => mqtt.connect(...))`, so at runtime the module
  namespace object had no `.connect`. (The web app worked because it used a
  default import, whose binding IS the full module object.)
- **Fix** (structural, not a cast): admin no longer imports `mqtt` at all.
  `packages/realtime-core` is the single browser MQTT adapter; admin's
  `connectEventStream` now constructs an observer-mode `ChatRealtimeClient`
  (identity `admin-dashboard:<random>`, `subscribeUserEvents: false`) and the
  core client uses a static default import internally.
- **Rule enforced**: UI layers must never `import "mqtt"` (checked in review;
  realtime-core is the only allowed importer on the client side).

# Bug #18 — No single public origin (ports sprawl)

- **Symptom**: Developers/users had to know five ports (:3000 web,
  :3001 API, :3002 admin, :8083 MQTT WS, :9000 MinIO); browser code hardcoded
  cross-origin service URLs; presigned upload URLs leaked the MinIO host into
  the browser.
- **Root cause**: Each service was exposed directly; no reverse proxy layer;
  media used presigned-PUT/302 flows that embed object-storage origins.
- **Fix**:
  - New `apps/gateway` (Node + http-proxy): public origin :3000 routes
    `/api/*`→API, `/media*`→API (`/api/media` streaming handler), everything
    else→web (:3100 internal), WS upgrade `/mqtt`→EMQX (:8083 internal),
    other upgrades (Next HMR)→web. Host headers preserved end-to-end.
  - API: Nest global prefix `/api` (root `/` excluded as a service probe);
    health reports real DB+Redis state.
  - Media: multipart POST `/api/uploads` streams through the API server-side
    (presign/complete/view endpoints removed); GET `/api/media?key=` streams
    objects with correct Content-Type; metadata persists only `storageKey`.
  - Web: relative same-origin bases (`/api`, `/media?key=`, `ws(s)://host/mqtt`);
    dev port moved to :3100; admin merged INTO the web app at `/admin`
    (apps/admin deleted).
  - Mobile: config derives one PUBLIC_HOST (`localhost` iOS sim /
    `10.0.2.2` Android emulator / env override) → `http://host:3000/api`,
    `ws://host:3000/mqtt`, `/media`.
- **Verified**: HTTP 200 for `/`, `/chat`, `/admin` via gateway; `/api/health`
  JSON; WS upgrade 101 with EMQX `server: Cowboy` header; full MQTT
  publish/receive round-trip over `ws://localhost:3000/mqtt`; PNG byte-perfect
  round-trip through `/api/uploads` + `/api/media`.

# Bug #19 — Identity switch left stale sender perspective

- **Symptom**: After switching users, event handling still compared messages
  against the PREVIOUS identity captured in a closure bound to the singleton
  realtime service — wrong message ownership/perspective until reload.
- **Root cause**: `handleEvent(envelope, identity.userId)` captured the
  bootstrap-time userId forever; switching only replaced localStorage.
- **Fix**: handlers read the active identity from the store AT EVENT TIME;
  `connect()` tears down any existing session before creating a new one for a
  different identity; `resetTransient()` drops all identity-scoped state
  (conversations/pending/typing/presence) when the stored identity changes.
  Regression-tested (chat-store suite).

# Bug #20 — E2E runs polluted development data

- **Symptom**: Every `pnpm test:e2e` run left `e2e-*` users, `e2e-group-*`
  conversations and smoke/bot messages inside the developer database and
  visible in real UIs (identity picker, sidebar).
- **Root cause**: suites ran against the dev stack/database directly with no
  isolation or cleanup.
- **Fix**:
  - Isolated E2E stack (`scripts/test-stack.mjs`, wired as `pnpm test:e2e`):
    dedicated database `mqtt_chat_test` (migrated+seeded per run), Redis db 1,
    API on :3011, own workers, MQTT topic namespace fence
    (`MQTT_TOPIC_NAMESPACE=chat/v1-e2e`, honored by contracts so test traffic
    is invisible to canonical clients by construction). Readiness-gated:
    suites start only after workers are subscribed.
  - Fixture lifecycle `scripts/lib/chat-fixture.mjs`: runtime ids, exact-ID
    cleanup in `finally`; API gained teardown endpoints
    (`DELETE /users/:id` refuses while messages exist, `DELETE
/conversations/:id` cascades).
  - One-time audited cleanup of the dev DB (`scripts/cleanup-dev-data.mjs`,
    dry-run by default): deleted exactly 10 test conversations, 8 test users,
    108 script-authored messages; seeded demo data untouched.

# Bug #21 — Web production build failed under ambient NODE_ENV=development

- **Symptom**: `next build` prerender crashed (`Cannot read properties of null
(reading 'useContext')` inside Next's LayoutRouter) even though the app was
  fine in dev and had built successfully previously.
- **Root cause**: the shell environment exported `NODE_ENV=development`;
  Next's production prerender then ran development React inside the build
  worker. Version pinning experiments were red herrings — HEAD failed
  identically.
- **Fix**: `apps/web` build script forces `NODE_ENV=production next build`,
  making builds deterministic regardless of the caller's shell. Verified:
  full monorepo build PASS with the variable present.

# Bug #22 — Mobile crash: `Cannot read property 'length' of undefined` (reactions)

- **Symptom**: Opening a conversation on React Native crashed ChatScreen with
  `Cannot read property 'length' of undefined` at `item.reactions.length`.
- **Root cause** (contract drift, not a rendering typo): the canonical
  `message.created` event NEVER carried `reactions` — the worker serializer
  (`toMessageEventData`) omitted the field and the contract schema didn't
  declare it. Web survived only because its event handler hardcoded
  `reactions: []` while building the UI model; mobile blind-cast the raw
  event payload (`data as unknown as ApiMessage`) straight into the FlatList.
- **Fix** (in dependency order):
  1. Contract: `messageEventDataSchema` gains `reactions` — optional on the
     wire (legacy outbox rows), REQUIRED after parse (`.default([])`).
  2. Producer: chat-worker `toMessageEventData` always emits `reactions`
     (fresh creates → `[]`); the bot-send path shares the same serializer.
  3. ONE boundary normalizer: `normalizeMessage()` in
     `@mqtt-chat/realtime-core` — shared by web and mobile — guarantees every
     UI message invariant (reactions array, null-safe reply/edited/deleted,
     senderName ← senderId fallback, safe type/senderType enums). Web's
     `handleEvent` and mobile's `useChatSession` now consume it; raw casts to
     the UI model are gone.
  4. Defensive render: ChatScreen derives `reactions = item.reactions ?? []`
     and logs a dev-only contract-drift warning; a malformed row can no
     longer crash the FlatList. Same-class sweep guarded store toggleReaction,
     mobile members accesses.
- **Regression tests**: vitest `normalize-message.test.ts` (8 cases: missing
  reactions → [], preserved, malformed entries filtered, legacy minimal row,
  metadata, timestamps, non-object input, bot path); mobile jest render test
  (react-test-renderer): message WITHOUT reactions field renders — no crash
  (10/10); web store: toggleReaction on malformed row restores the invariant,
  history+realtime merge keeps ONE canonical message.
- **Executed verification**: live MQTT probe — fresh `message.created` carries
  `reactions: []`; HTTP history 50/50 rows valid; web browser E2E 17/17 PASS;
  mobile typecheck + lint + jest green; iOS Simulator relaunch, no RedBox.

# Bug #23 — Group created on Web never appeared on Mobile (until reload); send in a fresh group stuck "Sending…"

- **Symptom**: A group created on Web did not show up on the Mobile
  conversation list until the app was restarted; opening the newly created
  group and sending could leave the bubble in an unresolved sending state.
- **Root cause** (traced end-to-end with a transport-level reproduction using
  the EXACT shared client): the broker DELIVERED `conversation.created` to the
  mobile client (all-events wildcard) — but the mobile event handler had **no
  case for any conversation lifecycle event**, so the payload was dropped on
  the floor. Discovery therefore depended on the bootstrap REST refetch
  (i.e. an app restart). The send path itself acks correctly (worker emitted
  the canonical `message.created` with `sequence=1` for a fresh group); the
  perceived stuck state came from the missing discovery UX plus the legacy
  bundle lacking the bounded queued/sending lifecycle rendering.
- **Fix**:
  1. `features/conversations/conversation-events.ts` — pure reducers
     (`applyConversationEvent`, `applyMessageActivity`, `sortByActivity`)
     implementing discovery, membership updates, monotonic summary updates
     and activity ordering.
  2. `useChatSession` handles conversation.created / updated /
     member-joined / member-left and reflects every new message onto the
     list in realtime — no reload, no refetch timers.
  3. Shared `normalizeConversation` + `upsertConversationInto` in
     realtime-core (ONE normalization path for web and mobile; members always
     an array; duplicates collapse to ONE entity).
- **Regression test (permanent)**: `scripts/web-mobile-discovery-e2e.mts` in
  the isolated E2E stack — dynamic runtime users, Web creates a group
  including the mobile identity, the mobile side (shared client + the REAL
  app reducer) must see it WITHOUT reload, open it, immediately send, reach a
  canonical ack within a bounded timeout, with EXACTLY ONE DB message.
  Plus 9 jest reducer cases (discovery, dedupe, member-left self/other,
  monotonic summary). Result: 7/7 isolated suites PASS.

# Bug #24 — Reactions made on any client never rendered in Mobile realtime (chips stale until reopen)

- **Symptom**: Tapping a reaction chip on Mobile did nothing visible; reactions
  added on Web appeared on Mobile only after leaving and reopening the
  conversation (history refetch). Even the actor's own reaction had no
  realtime feedback.
- **Root cause** (found by adversarial audit of fdb2970..2589523): a436b73
  shipped the full reaction UI + command senders on Mobile, but the
  `handleEvent` switch in `useChatSession` had NO case for canonical
  `reaction.added` / `reaction.removed` — the events (delivered via the
  all-events wildcard) were dropped on the floor, same failure class as #23.
  Web handled both events (`s.toggleReaction`); Mobile silently ignored them.
- **Fix**:
  1. `features/conversations/conversation-events.ts` — new pure reducer
     `applyReactionEvent(list, eventType, data)`: authoritative by event type
     (added ⇒ present, removed ⇒ absent), idempotent under QoS1 redelivery
     (re-applying never flips state — deliberately NOT a blind toggle),
     malformed payloads return the SAME reference.
  2. `useChatSession.handleEvent` gained `reaction.added`/`reaction.removed`
     cases applying the reducer across `messagesByConv`.
- **Regression test**: 5 jest cases (cross-client render, exact-pair removal,
  QoS1 idempotence incl. reference equality, malformed payloads, unknown
  message). Mobile jest 24/24, tsc PASS.
- **Executed verification**: full gates + isolated E2E re-run after the change.

# Bug #25 — Intermittent silent loss of MQTT commands in DEV: zombie test-stack workers held shared subscriptions

- **Symptom**: Browser E2E failed intermittently ("message delivered to second
  browser realtime" / "canonical message.created observed by broker observer"
  saw NOTHING) while earlier identical runs passed. Commands vanished with no
  row in ANY database and no canonical event.
- **Root cause**: `scripts/test-stack.mjs` spawned services as `pnpm → tsx
watch` trees but teardown killed only the DIRECT child (the pnpm wrapper).
  Grandchild tsx processes survived for HOURS attached to the shared EMQX,
  still members of the SAME `$share` command group on the dev namespace.
  One surviving worker even pointed at `mqtt_chat_test`. EMQX round-robins
  every `chat/v1/commands/...` message across group members, so each command
  had ~1/N chance of being dispatched to a poison pill that rejected it
  against the wrong database — silently (handler logs a warn, no NACK).
  Evidence at diagnosis: 3 chat-worker sessions in `emqx ctl clients list`
  (`chat-worker-63038-*` dev + orphans `chat-worker-31952-*` db=dev /
  `chat-worker-31958-*` db=test); failed-run commands present in NEITHER DB;
  `conversation.created` checks kept passing because the API writes its own
  outbox over HTTP and never touches the worker path.
- **Fix**:
  1. Remediation: killed the orphan processes (verified via per-PID env:
     DATABASE_URL/REDIS_URL/MQTT_TOPIC_NAMESPACE), after which browser E2E
     passed twice consecutively.
  2. Root cause in `scripts/test-stack.mjs`: services spawn `detached:true`
     (process-group leaders); teardown signals `-pid` (whole group) with
     SIGTERM→SIGKILL escalation. Suite children are NOT detached and are
     signalled singly (group-signalling them would kill the orchestrator).
- **Regression check**: full `pnpm test:e2e` run now leaks ZERO processes
  (worker process count and EMQX client count identical before/after).

# Bug #26 — Normal JPEG photos rejected ("Type image/jpg is not allowed")

- **Symptom**: Mobile Alert `Unsupported image — Type image/jpg is not allowed.`
  when picking ordinary photos (iOS PHPicker reports JPEG as `image/jpg`).
- **Root cause**: TWO raw allowlist comparisons with NO normalization —
  mobile `AppRoot.pickImage` (`ALLOWED_IMAGE_TYPES.includes(asset.type)`) AND
  server `uploads.controller` (`ALLOWED_CONTENT_TYPES.includes(file.mimetype)`).
  Platform MIME aliases (`image/jpg`, parameter suffixes, casing) died at
  either layer. Reproduced on the isolated stack: alias upload → 400.
- **Fix**: ONE canonical policy in `@mqtt-chat/mqtt-contracts/src/media.ts`
  (`normalizeMediaType` / `isAllowedMediaType` / `mediaTypeFromFilename` /
  `resolveMediaType`; aliases image/jpg|pjpeg|pipeg→image/jpeg; HEIC/HEIF
  deliberately NOT accepted — precise product error instead). Server
  normalizes before allowlist and stores the CANONICAL type; mobile resolves
  picker MIME (filename-extension fallback when MIME absent) before upload;
  document picker uses the same resolver.
- **Regression**: contracts vitest suite (17 cases incl. alias/params/case/
  heic/filename-fallback) + permanent `scripts/media-reply-e2e.mts`
  uploading REAL fixture bytes (`scripts/fixtures/pixel.jpg|png`) under
  `image/jpg` alias → 201 + canonical `image/jpeg` persisted + byte-perfect
  /media round-trip; HEIC → 400.

# Bug #27 — Reply pipeline: no Web reply UI, unfaithful retry, silent rejection

- **Findings** (reproduced end-to-end on the isolated stack):
  1. Web Composer hardcoded `replyToId: null` — replying was IMPOSSIBLE on
     Web despite the canonical backend path being correct (valid reply →
     `message.created` ack preserves `replyToId`).
  2. Web retry published a BARE command — a retried reply lost its target
     (and type/metadata were inferred from a 📎 content hack).
  3. chat-worker rejected invalid reply targets by SILENTLY dropping the
     command — clients waited out the 10s reconciliation timeout instead of
     failing deterministically (#19/#21).
- **Fix**: web reply UI (MessageBubble ↩ action → quoted preview in bubble +
  composer banner); PendingMessage carries type/metadata so retry
  republishes the identical logical message; NEW canonical event
  `message.rejected { clientMessageId, reason, conversationId }` emitted by
  the worker on every send rejection (unknown conversation, non-member,
  deleted conversation, bad reply target) — both clients mark the pending
  FAILED immediately on receipt.
- **Regression**: `scripts/media-reply-e2e.mts` — base→reply lifecycle with
  relation preserved in DB history after reload; invalid target receives
  canonical rejection in <5s; rejected message never created.

# Bug #28 — Groups had no complete lifecycle: Delete did not exist as a product capability

- **Before**: `DELETE /conversations/:id` was a hard physical cascade delete
  with NO permission check, NO canonical event, NO client surface — usable
  only by test scripts.
- **After (tombstone semantics, #13)**:
  - Prisma: `Conversation.deletedAt/deletedBy` (migration
    `20260824090000_conversation_tombstone`); history/sequence/receipts are
    preserved — nothing physically cascades.
  - API: admin-only (member role == ADMIN, #38) soft delete writing the row
    AND the canonical outbox event atomically; DIRECT conversations cannot be
    deleted (400); idempotent re-delete; tombstoned groups vanish from list/
    detail/membership endpoints (404s) and reject new members.
    KNOWN GAP (deliberate, follow-up): `GET /conversations/:id/messages`
    does not yet filter `deletedAt` — history stays readable by direct id;
    also a zero-member group hits the memberIds.min(1) zod guard on delete
    (500) because self-leave can empty a group first.
  - Contracts: `conversation.deleted` event carries the PRE-DELETE member
    snapshot so every relevant client removes the entity deterministically.
  - Worker: sends into a deleted conversation get deterministic
    `message.rejected`.
  - Web: DetailsPanel Danger Zone (admin-only) with two-step destructive
    confirmation; store.removeConversation clears list/cache/pending/typing
    and closes an open chat — no reload.
  - Mobile: GroupDetailsScreen Danger Zone + confirmation sheet; AppRoot
    safely exits chat/details screens when the entity disappears in realtime.
- **Regression**: permanent `scripts/group-lifecycle-e2e.mts` — create with
  3 runtime users → realtime discovery; non-admin delete → 403; DIRECT
  delete → 400; admin delete → canonical tombstone to ALL members without
  reload; fresh REST reads 404; post-delete send rejected canonically.

# Bug #29 — The isolated E2E harness was silently migrating/seeding the DEV database

- **Root cause**: `scripts/test-stack.mjs` `run()` expects options NESTED as
  `{ env: {...} }`, but `migrateAndSeed()` passed `{ DATABASE_URL }` FLAT —
  the key never reached the child process. Prisma CLI then fell back to the
  repo `.env` → **every test:e2e run migrated+seeded `mqtt_chat` (dev)**,
  masked by the api/workers receiving their env correctly through a properly
  nested call. Surfaced when env-immunity hardening (#42) removed the
  accidental fallback and prisma failed loudly with P1012.
- **Fix**: nested `{ env: { DATABASE_URL: TEST_DB } }` at every call site;
  PLUS env-immunity (delete inherited DATABASE_URL/REDIS_URL/
  MQTT_TOPIC_NAMESPACE from the orchestrator's own env before spawning) and
  a safety guard refusing TEST_DATABASE_URL values that look like the dev DB
  unless `ALLOW_UNSAFE_TEST_DB=1`. Verified via Datasource log line: all
  harness prisma calls now hit `mqtt_chat_test`.

# Bug #30 — Duplicate "Alice" / duplicate DIRECT conversations in the list

Two INDEPENDENT root causes produced the same user-visible symptom; both were
proven against live databases and fixed at every layer.

## (a) Legacy NULL-keyed DIRECT rows escaped every uniqueness guard

- **Symptom**: tapping "Message someone → Alice" created a SECOND direct
  conversation with the same peer; both appeared in the list.
- **Root cause**: `seed.ts` `ensureDirect` minted the demo DMs WITHOUT a
  `directPairKey`. SQL unique indexes treat NULLs as distinct, and the API's
  reuse fast-path `findUnique({ directPairKey })` can never match a NULL row —
  so creation fell through to `createWithOutboxEvent`, which inserted a keyed
  twin. Proven on a fresh test DB: seeded rows carried NULL keys while
  API-created rows had canonical keys.
- **Fix**:
  1. Seed stamps the canonical key at create AND heals legacy rows on re-seed
     (guarded — never steals a key another row owns).
  2. Migration `20260824150000_direct_pair_key_backfill` backfills NULL-keyed
     DIRECTs from their exact-two membership (`string_agg … COLLATE "C"`
     matches JS sort ordering); pairs that already have a keyed twin are
     skipped rather than violating the index.
  3. API defense-in-depth: createConversation ADOPTS a legacy twin — finds the
     NULL-keyed conversation whose members are exactly {a, b} (oldest first),
     stamps the key, returns it as `reused:true`; P2002 races reuse the winner.
- **Regression**: duplicate-direct-e2e inserts a REAL NULL-keyed row (raw SQL,
  exactly what the old seed produced) → POST for the same pair must return THE
  SAME id, and the pair keeps exactly ONE row.

## (b) Mobile rendered EVERYONE'S conversation list

- **Symptom**: on mobile, contacts appeared duplicated even with clean data —
  e.g. duong saw TWO entries labeled "Bob" (one was bob↔john).
- **Root cause**: `api.listConversations()` sent NO userId, and the server only
  filters by membership when userId is present — mobile consumed the GLOBAL
  list. Any other user's DM with a peer rendered as an extra entry labeled by
  that peer's display name.
- **Fix**: both mobile call sites pass the active identity's userId (web was
  already correct).

## Follow-on fixes discovered during the same investigation

- Mobile tore down + rebuilt its MQTT session on essentially EVERY inbound
  message: the client effect depended on `refreshPending`, which depended on
  `conversations`, which changes identity on every `message.created`. Fixed
  with a ref mirror; reconnect now also heals the conversation LIST.
- Web scroll model rewritten (open-at-latest, stick-to-bottom follow, unread
  pill, layout-effect prepend anchor); mobile gained the same model plus
  older-history pagination that had never been wired (hard-truncated to 50).
- Render-perf: web slice subscriptions, single-conversation store mutations,
  removal of duplicate conversation.* wildcard delivery; reaction handling
  scoped per conversation on mobile.

**Executed verification** (this tree): pnpm validate exit 0 · vitest 33/33 ·
mobile jest 24/24 · full isolated test:e2e ALL PASS (9 suites incl.
duplicate-direct with the new adoption section) · browser E2E 17/17 ×2 runs
(before/after perf work).

## 2026-08-24 — Session 4: FINAL release-candidate audit — first fix wave

A 12-dimension parallel audit swept every subsystem (code, architecture,
backend, web, mobile, realtime, UI/UX, motion, performance, tests, git).
Ten finders returned ~60 leads; every adversarial verifier died to API rate
limits, so each fix below was confirmed BY HAND against source before
committing. #31–#34 are correctness; #35–#37 are infra/gate hardening.
The remaining confirmed leads are tracked as OPEN ledger rows (P0-184+).

# Bug #31 — A storage fault mid-media-stream crashed the whole API process

- **Symptom**: any object-storage error while `GET /media` was streaming
  surfaced as an unhandled `'error'` event on the MinIO stream → uncaught
  exception → the API process died, taking every in-flight request with it.
  Client aborts leaked the upstream socket.
- **Root cause**: `object.stream.pipe(res)` with NO `'error'` listener and
  no teardown coupling between response and stream
  (`apps/api/src/controllers/media.controller.ts`).
- **Fix**: `stream.on('error')` → `res.destroy()` (headers already sent; the
  client sees a truncated body instead of a dead server) and
  `res.on('close')` → `stream.destroy()` (abort releases the socket).
- **Regression**: typecheck + targeted read; full gates green.

# Bug #32 — Mobile identities were permanently invisible: no presence announce, no LWT

- **Symptom**: mobile users never appeared online to anyone; an abrupt
  disconnect left their stale state until Redis TTL cleanup.
- **Root cause**: mobile built `ChatRealtimeClient` with NO `will` and never
  published `presence.set` — web announced itself, mobile did not (parity
  gap). Presence is written by chat-worker from commands/LWT only.
- **Fix** (`apps/mobile/src/hooks/useChatSession.ts`): mirror web exactly —
  LWT = canonical `presence.set {isOnline:false}` command envelope (so the
  worker validates it like any command), `onConnect` → announce online,
  graceful offline publish in teardown.
- **Regression**: mobile jest 24/24 + tsc. Transport-level regression still
  owed (jest covers reducers only) — see ledger.

# Bug #33 — Web reactions flip-flopped under QoS1 redelivery

- **Symptom**: tapping a reaction could visually UNDO itself seconds later;
  duplicated `reaction.added` deliveries toggled the state off.
- **Root cause**: BOTH `reaction.added` AND `reaction.removed` handlers
  called `toggleReaction` — a toggle is not idempotent, so QoS1
  redelivery (guaranteed by MQTT at-least-once) flipped state.
- **Fix**: authoritative application — new store mutator
  `applyReaction(messageId, emoji, userId, present)` (idempotent, same-ref
  no-op); the event handler passes the TARGET state named by the event.
  Web now matches mobile's `applyReactionEvent` semantics.
- **Regression**: 2 new chat-store cases incl. redelivery replaying
  `reaction.added` twice → exactly one reaction.

# Bug #34 — member-ADD had no boundary validation: unknown user → 500, DIRECT pair growable

- **Symptom**: `POST /conversations/:id/members` with an unknown userId hit
  the Prisma FK violation → raw 500 (invariant #12 breach); nothing stopped
  adding a third user to a DIRECT pair, corrupting the pair-key contract.
- **Root cause**: addMembers trusted `userIds` as existing users and never
  checked conversation type.
- **Fix** (`apps/api/src/controllers/chat.controller.ts`): type-validity
  FIRST (adding to a DIRECT conversation is 400 for ANY actor — validity
  precedes permissions), then unknown userIds → 404 naming them.
- **Regression**: §3b added to `scripts/group-lifecycle-e2e.mts`
  ("unknown userId → 404", "member-ADD into DIRECT pair → 400"); full
  isolated test:e2e exit 0.

# Bug #35 — Gateway ignored SIGTERM: restarts were abrupt kills

- **Symptom**: `docker compose restart` / deploy signals killed the gateway
  mid-request; open WebSocket upgrades never end on their own (invariant
  #15 breach). Env was also read raw from `process.env`.
- **Fix**: SIGTERM/SIGINT handler — stop accepting, close idle connections,
  bounded 5s drain, force-close all, exit 0; validated env via new
  `loadGatewayEnv()` zod schema (`packages/config`, new `GatewayEnv`);
  gateway now depends on `@mqtt-chat/config`.
- **Regression**: live probe — fresh instance :3998 → SIGTERM →
  "closed cleanly", exit 0; tsc green.

# Bug #36 — Quality gates had holes: .mts/.cts escaped prettier, eslint globbed a deleted app

- **Symptom**: the format gate silently skipped all `scripts/*.mts|*.cts`
  (three tracked E2E suites escaped it); `eslint.config.mjs` still globbed
  the deleted `apps/admin`.
- **Fix**: globs extended (verified the three suites already conform);
  stale admin glob removed.
- **Regression**: `prettier --check scripts/*.mts` pass; lint green.

# Bug #37 — Browser admin-feed probe could spuriously PASS on pre-existing traffic

- **Symptom**: the admin live-feed check asserted generic `"message.created"`
  text in the feed — ANY event on the broker (another tab, a worker) satisfied
  it even if OUR publish never landed (the spurious-pass class behind #25).
- **Fix** (`scripts/web-browser-e2e.mjs`): count occurrences before the
  publish (settle window), require an INCREASE afterwards — attribution by
  count delta, the strongest available proof since the feed renders event
  TYPES only.
- **Regression**: browser suite exit 0 ×2 (second run validates the hardened
  probe against a warm feed).

**Executed verification** (this tree): format+lint+typecheck+vitest exit 0 ·
mobile jest 24/24 · test:e2e exit 0 (incl. 2 NEW boundary checks) ·
browser E2E exit 0 ×2 · gateway SIGTERM drain verified live. NOT yet run this
session: standalone build / verify:all / verify:completion (tracked as the
audit's closing step).

## 2026-08-24 — Session 5: audit fix wave 2 — every CONFIRMED finding closed

The two confirmed P0s and all nine confirmed P1s from the wave-1 audit are
now fixed, each with its regression. Ledger rows P0-184/185 and P1-186..194
flip to VERIFIED; P0-044 returns to VERIFIED.

# Bug #38 — Offline flush corrupted queued media (P0-184)

- **Root cause**: `flushQueuedMessages()` rebuilt `message.send` from the
  optimistic bubble text — type via the 📎 heuristic, metadata hardcoded
  null — so an IMAGE queued offline reconnected as a metadata-less FILE
  bubble with no storage key. `PendingMessage` had carried type/metadata
  since #27; only the flush path ignored them.
- **Fix**: ONE shared `republishPayload(pending)` builder used by BOTH the
  manual retry button AND the reconnect flush — the paths cannot drift
  again. Legacy pre-type pendings keep the 📎 heuristic.
- **Regression**: queued IMAGE preserves type+storageKey; TEXT verbatim
  incl. replyToId; legacy fallback covered (chat-store.test.ts).

# Bug #39 — Commands were PUBACKed before processing (P0-185)

- **Root cause**: mqtt.js auto-PUBACKs on delivery BEFORE any consumer code;
  worker `stop()` waited without unsubscribing and processing early-returned
  once stopped → commands arriving in the shutdown window were acked then
  dropped forever. The "QoS1 redelivery covers crashes" comment was false
  post-ack.
- **Fix**: `packages/mqtt` gained a deferred-ack `handleMessage` option —
  PUBACK goes out only after the handler resolves; a REJECTION skips the ack
  so the broker redelivers (mqtt.js' internal done() ignores errors, so
  nacking cannot crash). ChatWorker routes deliveries through it; `stop()`
  leaves the $share group FIRST, drains, and nacks anything racing the
  window. Poison payloads still resolve+ack deliberately.
- **Verified LIVE**: 200 QoS1 commands under continuous traffic with TWO
  worker SIGTERMs mid-stream + respawn → 200/200 canonical events, exactly
  once each, zero loss/duplication/rejection.

# Bug #40 — smoke.mjs could pass with broken dedup/history (P1-186)

Exit code keyed off ONE check; dedup printed WARN and history printed FAIL
without failing the run. All checks thread one `failed` flag now; downstream
flows degrade to explicit FAIL(skipped).

# Bug #41 — member-REMOVE had no domain guards (P1-187/188/189)

- DIRECT pair self-leave stranded a membership-broken DM behind its pair key
  forever (add-guard blocks repair) → removing from a DIRECT is 400 for ANY
  actor.
- Last-member leave hit the member-left contract (`memberCount ≥ 1`) INSIDE
  the transaction → rollback → deterministic 500 loop → now 400 up front;
  ending a group belongs to the tombstone DELETE flow.
- Sole-admin removal orphaned an all-MEMBER group (every op ADMIN-gated) →
  the oldest remaining HUMAN member is promoted ADMIN in the SAME
  transaction; bots never inherit authority.

# Bug #42 — createConversation trusted its input (P1-190/189)

Unknown ids hit Prisma FK/P2002 as raw 500s; a creator outside memberIds
minted a zero-ADMIN group. Mirrors #34: existence first (404 naming them),
then structure (duplicates 400, creator-must-be-a-member 400). Seed aligns
conv-random (alice becomes ADMIN).

# Bug #43 — mobile typing spammed QoS1 commands (P1-192)

One command PER KEYSTROKE with no auto-stop. Now ≥1s throttle per
conversation + deterministic auto-stop after 2s silence + immediate stop on
submit — parity with web Composer.

# Bug #44 — web store errors were invisible; harness leaked on failure

- ErrorBanner renders the previously write-only `error` state (invariant
  #16); dismissible, auto-clears after 8s (P1-191).
- Mobile jest suite gated into `validate` via root `test:mobile` (P1-193).
- test-stack: SIGINT/SIGTERM run the real teardown (--keep persists);
  per-suite watchdog (default 120s); all four fixture suites register
  exact-ID cleanup thunks that run on success AND failure paths (P1-194,
  bug #25 class).

**Executed verification** (this tree): validate incl. build + both unit
suites · full test:e2e exit 0 (90 checks PASS incl. 9 new boundary/
regression checks) · live SIGTERM zero-loss probe PASS.
