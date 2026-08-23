# TypeScript Rules

- Strict mode always. No lazy `any`, no `@ts-ignore`, no lazy `eslint-disable` (if truly needed, justify with a comment).
- Prefer `unknown` + runtime validation/narrowing over `any`.
- Types inferred from Zod schemas at boundaries; never duplicate contract types.
- Validate every boundary: HTTP input, MQTT payloads, env vars, bot rule JSON, storage metadata.
