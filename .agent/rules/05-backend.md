# Backend Rules

- Thin controllers: controller → service/use case → repository/domain.
- Consistent error format: { error: { code, message, details, requestId } }; no raw stack traces.
- REST validation required on every endpoint (Zod).
- Pagination mandatory for message history (cursor-based); no full-table reads.
- Health endpoints check app + database + redis + MQTT where relevant.
- Structured logging with correlation IDs (requestId, messageId, conversationId, userId, botId, ruleId).
