# Testing Rules

- Never say "should work" without verification.
- Unit tests for: command parser, rule matcher, condition operators, topic builders, schemas, Redis key builders, loop protection.
- Integration tests for: message creation, idempotency, outbox, read state, rule execution.
- E2E (Playwright) for critical flows incl. multi-client realtime, typing, read receipts, bot commands.
- Quality gates at end of every task: pnpm lint && pnpm typecheck && pnpm test && pnpm build.
