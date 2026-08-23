# Skill: mqtt-realtime

Must know:

- topics from contracts
- commands vs events
- QoS policy (1 for durable, 0 for typing)
- shared subscriptions for workers
- LWT for presence
- reconnect = resubscribe + gap fetch + presence restore
- duplicates tolerated via clientMessageId dedupe
- ordering via monotonic sequence
