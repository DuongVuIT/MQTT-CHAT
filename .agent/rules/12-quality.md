# Quality Rules

- Before completion run: pnpm lint && pnpm typecheck && pnpm test && pnpm build.
- Self-review checklist: architecture fit, race conditions, MQTT duplicates, DB transactions, memory leaks, subscription cleanup, React rerenders, error paths, dead code, hardcoded topics/keys, any/ts-ignore/eslint-disable, console.log (only allowed in ConsoleNotificationProvider/dev tooling).
- No TODO/FIXME/placeholder left behind.
- If a command fails, fix it — never ignore errors to make gates green.
