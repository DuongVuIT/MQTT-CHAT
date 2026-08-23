# Frontend / UI-UX Rules

- Responsive: 3-column desktop, list→chat navigation on mobile.
- Every important surface has loading / empty / error / offline / reconnecting states.
- Every visible button works; no dead UI, no fake buttons.
- MQTT access via RealtimeService layer only — never connect in components.
- Optimistic send with pending/failed/retry; no auto-scroll that breaks reading position.
- Accessible: keyboard nav, focus states, aria labels on icon-only buttons, semantic HTML.
- Consistent design toke- Consistent design toon- Consistent design toke- Consistent design toon- Consistent design toke- Consistent design toon- Consistent design toke- Consistent design toon- Consistent design toke- Consistent design toon- Consistent design toke- Consistent design toon- Consistent design toke- Consistent design toon- Consistent design toke- Consistent design toon- Consistent design toke- Consistent design toon- Consistent design toke- Consistent design t+ MQTT where relevant.
- Structured logging with correlation IDs (requestId, messageId, conversationId, userId, botId, ruleId).
