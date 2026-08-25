# Regression Root Cause Report — 2026-08-25

Forensic audit → fix wave for the Web ↔ Mobile consistency cluster reported
after the phase-2 redesign / documentation round (session 6).

## Symptoms

1. **REG-01/03** — Web and Mobile showed divergent conversation/message state
   (last message, unread, read state) after realtime activity.
2. **REG-02** — Conversations stayed "unread" after being opened/read; badges
   healed only on reload/refetch; same user's devices did not converge.
3. **REG-04** — Mobile "can no longer switch user".
4. **REG-05** — Same user rendered different avatar colors/initials on Web vs
   Mobile.
5. **REG-06** — `pnpm dev` failed with tsx
   `"Previous process hasn't exited yet. Force killing…"`, Turbo
   `@mqtt-chat/web#dev ERROR … ELIFECYCLE exit code 1`, processes exiting 130.

## Last Known Good

`50243ca` — last commit before the phase-2 UI/state wave
(`2ddd6f0` mobile redesign, `74d4b61` shared theme, `6b04c36` web redesign +
store hardening, `6a7428d` scroll math).

## Regression Window

`50243ca..5761015` (HEAD at audit start). Working tree contained **no**
uncommitted source changes — only `HANDOFF.md`, the known
`apps/web/next-env.d.ts` artifact churn, and untracked docs
(`docs/SYSTEM_OVERVIEW_PRESENTATION.md`, `notion-export/`).
**The documentation round did not touch source** — correlation, not causation.
The real regression source is the phase-2 state-handling rewrite plus latent
gaps that the (green) automated gates never covered: the session-6 close
checklist itself lists "Web↔Mobile live cross-check" as PENDING/blocked.

---

## Root Causes

### RC-01 — Gateway drain window raced tsx watch's kill grace (REG-06)

**Problem.** Every watched-file restart of the gateway SIGKILLed instead of
restarting cleanly; teardowns printed force-kill messages.

**Evidence.**

```
/tmp/dev-audit.log:
@mqtt-chat/gateway:dev: 10:45:41 AM [tsx] change in ./src/index.ts Restarting...
@mqtt-chat/gateway:dev: 10:45:46 AM [tsx] Process didn't exit in 5s. Force killing...
```

- `tsx/dist/cli.mjs` (`killProcess`): SIGTERM → exactly **5000 ms** grace →
  SIGKILL with `Process didn't exit in 5s.`; its `relaySignal` prints
  `Previous process hasn't exited yet. Force killing…` when teardown arrives
  while a restart kill is still in flight.
- `apps/gateway/src/index.ts` shutdown used a **5000 ms** drain timer before
  `server.closeAllConnections()`. With any proxied HMR/MQTT websocket open
  (always true in dev), `server.close()` waited for the full drain ⇒ exit ≈
  5 s ⇒ guaranteed SIGKILL race.
- Live measurement: old gateway child survived ~6 s after restart-SIGTERM;
  after the fix it exits in ~2 s (`drain elapsed — exiting`).

A second REG-06 mechanism was reproduced verbatim: starting `pnpm dev` while
an earlier stack still held ports produced

```
@mqtt-chat/web:dev: Error: listen EADDRINUSE: address already in use :::3100
@mqtt-chat/web:dev:  ELIFECYCLE  Command failed with exit code 1.
@mqtt-chat/gateway:dev:  ELIFECYCLE  Command failed with exit code 130.
@mqtt-chat/web#dev:  ERROR  command … exited (1)
```

(Orphaned stacks survive terminal closure/Mac sleep — an example was found
running detached, PPID 1, holding :3000/:3001/:3100.)

**Files.** `apps/gateway/src/index.ts`, `package.json`,
`scripts/preflight-dev.mjs` (new).

**Why it caused the symptom.** Drain window == kill grace means every gateway
restart force-kills; port-holding leftovers make the next `pnpm dev` abort
mid-teardown, which surfaces as web#dev ELIFECYCLE errors and exit-130 noise.

**Fix.** Gateway drains 2000 ms, hard-exits at 3500 ms — always inside tsx's
grace. `pnpm dev` now runs a preflight port guard that refuses to boot and
names the offending PIDs when a stack is already running.

**Regression test.** Live probe protocol (documented here): touch
`apps/gateway/src/index.ts` under `pnpm dev`; log must show
`SIGTERM received — draining 2s…` and reach a clean exit with no tsx
force-kill line. Preflight refusal verified live (exit 1 with PID list).

### RC-02 — receipt.read fanned out to everyone except the reader (REG-02)

**Problem.** Reading on one device never cleared unread on the SAME user's
other device/client until a refetch.

**Evidence.** `apps/chat-worker/src/handlers/receipts.ts` built recipients as
`conversationMember.findMany({ where: { conversationId, userId: { not: userId } } })`
— the actor was excluded from its own read event. Unread on every client is
derived from the reader's own watermark
(`lastSequence − myRead`: `apps/web/src/components/Sidebar.tsx:263`,
`apps/mobile/src/screens/ConversationListScreen.tsx:59`), so only a fresh
bootstrap could heal it.

**Files.** `apps/chat-worker/src/handlers/receipts.ts`.

**Why it caused the symptom.** Cross-device convergence requires the canonical
event to reach all subscribers of `chat/v1/users/{reader}/events/receipt/read`;
the filter removed precisely the reader.

**Fix.** Fan out to ALL members including the actor; clients merge through
the shared monotonic watermark helper so self-delivery is idempotent.

**Regression test.** `scripts/receipt-convergence-e2e.mts` (permanent suite):
two devices of one user must both receive `receipt.read`; REST bootstrap must
carry the advanced watermark; stale receipts must not regress it.

### RC-03 — Clients merged receipts with a blind SET; neither advanced its own watermark locally (REG-02)

**Problem.** After publishing a read receipt, a client's own badge stayed
stale until refetch, and a QoS1 redelivery/out-of-order event could move a
watermark backwards.

**Evidence.**
`apps/web/src/store/chat-store.ts` `applyReadReceipt` assigned
`{ …m, lastReadSequence }` unconditionally (no monotonic guard); nothing in
web or mobile advanced the local member watermark when publishing
(`apps/web/src/components/MessageList.tsx` read-effect published without a
store update; mobile's only publish site was inside `openConversation`,
`apps/mobile/src/hooks/useChatSession.ts`). Server treats the field as a
monotonic high-water mark (`receipts.ts: "stale/out-of-order — idempotent"`)
— clients violated the same invariant.

**Files.** `packages/realtime-core/src/read-watermark.ts` (new),
`packages/realtime-core/src/index.ts`, `apps/web/src/store/chat-store.ts`,
`apps/web/src/components/MessageList.tsx`,
`apps/mobile/src/features/conversations/conversation-events.ts`,
`apps/mobile/src/hooks/useChatSession.ts`.

**Why it caused the symptom.** Badge = derived state; the derivation input
(my watermark) only moved server-side, and merges could regress it.

**Fix.** One canonical merge `advanceMemberWatermark()` (monotonic max,
generic over member type) exported from `@mqtt-chat/realtime-core`; web store
and mobile reducer both route receipts through it; both clients advance their
OWN watermark immediately after publishing; mobile gained a `markVisibleRead`
viewing catch-up (parity with web's transcript effect) so messages arriving
while a conversation stays open get marked read.

**Regression tests.** `packages/realtime-core/src/read-watermark.test.ts`
(idempotency, no-regress, unknown-member, non-finite),
`apps/web/src/store/chat-store.test.ts` (badge clears instantly; peer ticks;
no regress; missing-members defense),
`apps/mobile/src/features/conversations/__tests__/conversation-events.test.ts`
(`applyReadReceipt` suite incl. reference-stability).

### RC-04 — Mobile dropped receipt.read entirely (REG-01/02)

**Problem.** Peer read ticks (✓✓) never advanced live on mobile; mobile had
no path to learn about ANY receipt event.

**Evidence.** Event switch in `apps/mobile/src/hooks/useChatSession.ts`
handled conversation.*, message.*, reaction.*, typing.*, presence.* — no
`receipt.read`/`receipt.delivered` case existed (compare web
`apps/web/src/app/chat/page.tsx:451`). The subscription was fine
(`ChatRealtimeClient` subscribes `userEventsWildcardTopic(identity.userId)`
for both platforms, `packages/realtime-core/src/index.ts:340`) — events were
received and discarded by the default case.

**Files.** `apps/mobile/src/hooks/useChatSession.ts` (new `receipt.read` case
delegating to the pure reducer), `apps/mobile/src/features/conversations/conversation-events.ts`.

**Why it caused the symptom.** Received-but-unhandled events = silent state
divergence between clients.

**Fix + test.** Canonical case added; covered by the mobile jest suite above
plus the E2E suite (RC-02).

### RC-05 — Two different avatar algorithms (REG-05)

**Problem.** Same identity wore different colors/initials per platform.

**Evidence.**

| | Web `packages/ui/src/components/Avatar.tsx` | Mobile `apps/mobile/src/theme/tokens.ts` |
|---|---|---|
| hash | `hash*31+c` unsigned | djb2 signed `(h<<5)+h+c\|0` |
| key | display name | display title (DM rows) / conv id / userId |
| palette | tailwind classes (6) | `AVATAR_PAIRS` hexes (8) |
| initials | initials of name words | `title.slice(0,1..2)` |

Mobile also keyed DM avatars by peer display title
(`ConversationListScreen`) and chat headers by title (`ChatScreen:593`) —
colors drifted whenever names changed and differed from web by construction.

**Files.** `packages/realtime-core/src/user-presentation.ts` (new canonical
module), `packages/ui/src/components/Avatar.tsx` (+ package dep),
`apps/web/src/app/page.tsx`, `apps/web/src/app/chat/page.tsx`,
`apps/web/src/components/Sidebar.tsx`, `apps/web/src/components/DetailsPanel.tsx`,
`apps/mobile/src/theme/tokens.ts`, `apps/mobile/src/screens/ConversationListScreen.tsx`,
`apps/mobile/src/screens/ChatScreen.tsx`, `apps/mobile/src/app/AppRoot.tsx`.

**Why it caused the symptom.** Two independent implementations of
"deterministic fallback" with different inputs/palettes cannot agree.

**Fix.** ONE canonical algorithm in the shared runtime package both apps
already consume: unsigned djb2 over a stable key (**userId** for people,
**conversationId** for conversation avatars — §20: identity never derives
from display names), one 600-weight hex palette (white fg readable on both
themes), one initials rule. Web Avatar takes a REQUIRED `colorKey`; mobile's
`avatarColorFor` is a thin adapter onto the same helper.

**Regression tests.** `packages/realtime-core/src/user-presentation.test.ts`
(key-only color, palette bounds, determinism, initials),
`apps/mobile/src/theme/__tests__/tokens.test.ts` (adapter parity guard —
mobile bg MUST equal `avatarColorHex`).

### RC-06 — Mobile identity switch kept prior user's React state (REG-04 hardening)

**Problem.** Switch profile existed (ProfileSheet → `setIdentity(null)` →
picker; connection effect tears the client down per identity — leak-probe
verified) but the hook's React state (transcripts, typing, presence,
pagination flags, read throttles) survived across identities, so the next
user could inherit stale cached data mid-bootstrap.

**Evidence.** `useChatSession` state holders (`messagesByConv`,
`typingByConv`, `presence`, `hasMoreByConv`, …) reset only via replacement
during bootstrap; refs (`typingSeenRef`, presence-grace timers) persisted.

**Files.** `apps/mobile/src/hooks/useChatSession.ts`.

**Why it caused the symptom.** Identity boundary must re-key ALL client state
(cross-user bleed class — same root family as the historical duplicate-Alice
P0s).

**Fix.** Identity-boundary effect clears every cache + cancels grace/typing
timers before bootstrap refetch; MQTT teardown remains the existing
per-identity effect.

**Regression tests.** Existing suites cover the pure reducers; switch flow
verified in the manual walkthrough (TEST 3).

---

## Validation

See terminal summary. Gate ladder: format/lint/typecheck/vitest/mobile-jest/
build → isolated E2E (incl. new receipt-convergence suite) → browser E2E →
probes → live walkthrough.
