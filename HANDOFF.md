# HANDOFF.md — Session context (2026-08-25, session 7 — REGRESSION RECOVERY)

> **Context only. Source code + git are the source of truth.**
> Durable state: repair-log #52–#55 + PROJECT_STATUS ledger P0-202..204,
> P1-205. Root-cause analysis: docs/REGRESSION_ROOT_CAUSE_2026-08-25.md.
> This file is untracked by design.

## 1. What session 7 did (forensic audit → fix wave)

Reported cluster after the phase-2/documentation round: web↔mobile data
divergence, read/unread wrong, mobile switch-user suspicion, avatar mismatch,
`pnpm dev` force-kill chaos. Git forensics exonerated the docs round (untracked
files only); regression window `50243ca..5761015` (phase-2 state rewrite) with
latent gaps the green gates never covered.

| Root cause                                                                                                                                                                                                         | Fix                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| RC-01 gateway drain (5s) == tsx kill grace (5s) ⇒ SIGKILL/"Force killing" on every watched restart; orphaned stacks made the next `pnpm dev` die EADDRINUSE (web#dev ERROR exit 1, exit 130 — reproduced verbatim) | drain 2s + hard exit 3.5s; `pnpm dev` preflight port guard names offending PIDs (`scripts/preflight-dev.mjs`)                            |
| RC-02 receipt.read fanned to everyone EXCEPT the reader ⇒ same user's other devices never converged                                                                                                                | worker fans to ALL members; self-delivery is idempotent by design                                                                        |
| RC-03 clients blind-SET merged receipts and never self-advanced own watermark ⇒ stale badge until refetch; redelivery could regress                                                                                | ONE monotonic `advanceMemberWatermark` in realtime-core; web store + MessageList self-advance; mobile pure reducer `applyReadReceipt`    |
| RC-04 mobile had NO receipt.read handler and only marked read at open time                                                                                                                                         | receipt.read case + `markVisibleRead` viewing catch-up (web parity)                                                                      |
| RC-05 two avatar algorithms (web hashed display name/hash*31/tailwind vs mobile djb2/own palette/title keys)                                                                                                       | canonical `userPresentation` in realtime-core keyed by userId/conversationId; web Avatar REQUIRES colorKey; mobile adapter parity-tested |
| RC-06 mobile identity switch kept prior user's React state                                                                                                                                                         | identity-boundary effect clears every cache + timers before re-bootstrap                                                                 |
| probe:leak counted pre-existing operator/simulator clients as its own (baseline snapshot captured but never used)                                                                                                  | filter by pre-pick baseline ids; probe ALL PASS again                                                                                    |

## 2. Verification at close

- `pnpm validate` exit 0 (format/lint/typecheck/vitest 107/mobile jest 51/build)
- `pnpm test:e2e` exit 0 — 10 suites incl. NEW `receipt-convergence-e2e.mts`
  (cross-device receipt delivery, REST watermark persistence, stale-receipt
  immutability — 5/5 PASS)
- `pnpm test:browser` exit 0 (18 PASS) · `pnpm probe:leak` ALL PASS ·
  `pnpm probe:scroll` ALL PASS (300-msg contract)
- LIVE cross-client: script sent as duong → simulator (Alice, General open)
  received realtime and AUTO-marked read via the new path; REST watermark
  advanced 309→310. Avatar colors on the simulator picker match the canonical
  palette exactly (duong #db2777 / alice #ea580c / bob #2563eb / john #16a34a).
- Dev runtime: gateway restart now exits ~2s inside tsx grace ("drain elapsed
  — exiting", no force-kill); preflight refuses double-start with PIDs.

## 3. Remaining / notes for next session

- In-simulator TAP walkthrough is partially blocked again: Simulator window
  clamps to 417×895 on this display, so the /tmp/simtap 1:1 calibration
  formula (window {402,902}) no longer holds; System Events clicks DO land
  (mapping screen=(109+0.992dx, 72+0.992dy) at position {100,44}) but focus
  is flaky. Switch/read paths are covered by probe:leak + e2e + live test
  instead. Re-derive a calibration tool before the next interactive pass.
- `notion-export/` stays untracked (raw export artifacts).
- Dev stack left RUNNING as before.
