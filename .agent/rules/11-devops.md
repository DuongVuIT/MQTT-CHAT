# DevOps Rules

- docker compose runs infra only (EMQX, PostgreSQL, Redis, MinIO); apps run via pnpm dev for hot reload.
- .env.example documents all variables; secrets never committed; env validated at startup via packages/config.
- Ports: gateway 3000 (single public origin — `/`, `/chat`, `/admin`, `/api/*`, `/media*`, ws `/mqtt`), web 3100 + api 3001 (internal, never user-facing), MQTT 1883/8083, EMQX dashboard 18083, PG 5432, Redis 6379, MinIO 9000/9001. Isolated E2E stack: api 3011, DB `mqtt_chat_test`, Redis db 1, topic fence `chat/v1-e2e`.
- Graceful shutdown everywhere; health checks per service.
