# Development Guide

## Prerequisites

- Node.js 22 LTS
- pnpm 10 (`corepack enable` or `npm i -g pnpm`)
- Docker Desktop

## First Run

```bash
pnpm install
cp .env.example .env          # defaults work for local docker infra
docker compose up -d          # EMQX, PostgreSQL, Redis, MinIO
pnpm db:migrate               # prisma migrate dev
pnpm db:seed                  # users, conversations, bot + rules
pnpm dev                      # all apps with hot reload
```

| URL                          | What                          |
| ---------------------------- | ----------------------------- |
| http://localhost:3000        | Chat app                      |
| http://localhost:3001/health | API health                    |
| http://localhost:3002        | Admin dashboard               |
| http://localhost:18083       | EMQX dashboard (admin/public) |
| http://localhost:9001        | MinIO console                 |

## Scripts

```bash
pnpm dev           # turbo dev (all apps)
pnpm build         # build all
pnpm lint          # eslint
pnpm typecheck     # tsc --noEmit per package
pnpm test          # vitest unit tests
pnpm db:migrate    # prisma migrations
pnpm db:seed       # seed data
docker compose up -d / down   # infra lifecycle
```

Run a single app: `pnpm --filter web dev`, `pnpm --filter api start:dev`, etc.

## Environment Variables

See `.env.example`. All env is validated at startup by `packages/config`;
a missing/invalid variable fails fast with a clear error.

## Ports

web 3000 · api 3001 · admin 3002 · MQTT TCP 1883 · MQTT WS 8083 · EMQX dash 18083 · PG 5432 · Redis 6379 · MinIO 9000/9001

## Troubleshooting

| Problem                           | Fix                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------- |
| Web can't connect to MQTT         | Ensure EMQX container is up; check `NEXT_PUBLIC_MQTT_WS_URL=ws://localhost:8083` |
| API errors "P1001 can't reach DB" | Start postgres container; wait for healthcheck                                   |
| Bot doesn't reply                 | Check bot enabled + rule enabled in Admin → Bot; check bot-worker logs           |
| No notifications in logs          | Recipient must be offline (close their tabs) when message arrives                |
| Messages duplicated in UI         | Should not happen — dedupe by clientMessageId/eventId; report as bug             |
