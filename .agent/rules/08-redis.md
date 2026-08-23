# Redis Rules

- All keys via builders in packages/redis/src/keys.ts; never hardcode keys in apps.
- Presence: multi-device sets; user offline only when connection count = 0.
- Typing: ephemeral TTL keys (never persisted to PostgreSQL).
- Bot transient state + cooldowns in Redis; persistent config/history in PostgreSQL.
- Distributed locks via SET NX EX helpers.
