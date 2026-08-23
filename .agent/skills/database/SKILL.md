# Skill: database

Checklist:

- schema change => migration
- unique constraints respected (clientMessageId, conversationId+sequence)
- cursor pagination for history
- no N+1
- outbox rows in same transaction as domain writes
