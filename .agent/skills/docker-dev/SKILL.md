# Skill: docker-dev

docker compose up -d starts EMQX/PG/Redis/MinIO only. Apps run with pnpm dev. First run: cp .env.example .env, docker compose up -d, pnpm db:migrate, pnpm db:seed, then pnpm dev.
