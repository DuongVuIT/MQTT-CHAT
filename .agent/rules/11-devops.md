# DevOps Rules

- docker compose runs infra only (EMQX, PostgreSQL, Redis, MinIO); apps run via pnpm dev for hot reload.
- .env.example documents all variables; secrets never committed; env validated at startup via packages/config.
- Ports: web 3000, api 3001, admin 3002, MQTT 1883/8083, EMQX dashboard 18083, PG 5432, Redis 6379, MinIO 9000/9001.
- Graceful shutdown everywhere; health checks per service.
