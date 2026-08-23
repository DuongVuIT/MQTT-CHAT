# Skill: testing

Process:

- unit tests for pure logic (parser, conditions, topics, keys)
- integration tests for repos/outbox/idempotency
- E2E multi-client flows
- Always run: pnpm lint && pnpm typecheck && pnpm test && pnpm build
