# Architecture Rules

- Server-authoritative chat: clients publish commands only; canonical events come exclusively from chat-worker via transactional outbox → EMQX.
- Commands ≠ Events: commands request actions; events report completed facts.
- Outbox for all canonical domain events; publisher is retryable; consumers idempotent.
- Monotonic per-conversation sequence generated trans- Monotonic per-conversation sequence generated trans- Monotonic per-conversation sequence generated trans- Monotonic per-conversation sequence generated trans- Monotonic per-conversation sequence generated trans- Monotonic per-conversation sequence generated trans- Monotonic per-conversation sequence generated trans- Monotonic per-conversation sequence generated trans- Monotonic per-conversation sequence generated trans- Monotonic per-conversation sequence generated trans- Monotonic per-conversation sequence generated trans- Monotonic per-conversation sequence generated trans- M strict; Node 22 LTS.
