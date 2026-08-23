# MQTT Rules

- Topics only from @mqtt-chat/mqtt-contracts builders; never hardcode or hand-concatenate.
- QoS intentional: message/receipt/reaction commands+events QoS 1; typing QoS 0.
- Payloads always schema-validated; never trust MQTT input.
- Idempotency: dedupe by clientMessageId; consumers tolerate QoS 1 redelivery.
- Workers scale via shared subscriptions ($share/<group>/...).
- No binary uploads via MQTT — media goes through presigned URLs to MinIO/R2.
- Clients subscribe only needed topics; no "#" in client apps.
- Reconnect must resubscribe + fetch sequence gap + restore presence.
