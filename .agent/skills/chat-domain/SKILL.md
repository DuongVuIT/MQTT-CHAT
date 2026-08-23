# Skill: chat-domain

Message lifecycle:
send command -> validate -> dedupe -> sequence -> tx(save message + outbox) -> publish canonical event.
Receipts via lastReadSequence watermark. Typing ephemeral in Redis. Media metadata-only over MQTT.
