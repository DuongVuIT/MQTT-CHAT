# Monorepo Rules

- apps → packages allowed; packages → apps forbidden. No circular dependencies.
- Each package exposes its public API via src/index.ts only; no deep imports.
- Contracts (topics, schemas, types) live in @mqtt-chat/mqtt-contracts; never duplicate.
- Do not create packages "for beauty" — extract only when shared.
- pnpm workspace + Turborepo; TypeScript strict; Node 22 LTS.
