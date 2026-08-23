# Skill: repo-overview

1. Scan repository structure (list files, read package.json/turbo/tsconfig).
2. Read entrypoints of each app/package.
3. Build dependency graph (apps -> packages).
4. Locate contracts, DB schema, Redis keys.
5. Trace data flow: command -> worker -> outbox -> event -> consumers.
6. Never guess; create an overview doc before large changes.
