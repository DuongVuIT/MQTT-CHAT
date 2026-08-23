# Database Rules

- Prisma schema is the single source of truth; migrations required for every schema change.
- No N+1 queries; no full history reads; cursor pagination.
- Unique constraints: Message.clientMessageId and (conversationId, sequence).
- Transactional outbox rows written in the same transaction as domain changes.
- No destructive resets as a default solution.
