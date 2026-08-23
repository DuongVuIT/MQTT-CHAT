# Bot Rules

- Bot cannot bypass chat-worker: bots send bot.send commands only.
- Loop protection mandatory: ignore senderType == BOT unless rule opts in (allowBotMessages); max automation depth; correlation/causation IDs; cooldowns.
- Rule JSON always validated with bot-rules schemas; no arbitrary JS eval; no shell execution from rules.
- State scoped correctly (bot/conversation/user); transient in Redis, persistent in PostgreSQL.
- Actions traceable (ruleId, correlationId, causationId).
- http_request actions need sane timeout + error handling.
