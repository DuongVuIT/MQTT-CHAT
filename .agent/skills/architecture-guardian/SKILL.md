# Skill: architecture-guardian

Before any large feature, answer:

- Which app owns this?
- Which package owns reusable code?
- Does this create circular dependency?
- Does this bypass canonical flow (chat-worker/outbox)?
- Does this duplicate contracts?
- Does it violate server-authoritative architecture?
