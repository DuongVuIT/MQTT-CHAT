-- Backfill canonical directPairKey on LEGACY DIRECT rows (duplicate-Alice
-- root cause, phase 2). Rows created before the pair-key contract — notably
-- the seeded demo DMs (ensureDirect) — carry a NULL key. NULL never matches
-- the API reuse fast-path and the UNIQUE index cannot dedupe it, so tapping
-- the same peer in a picker minted a SECOND direct conversation for the same
-- pair. Stamp each such row with the same canonical key the API derives
-- (directPairKeyFor = [a, b].sort().join(":"); COLLATE "C" matches JS
-- code-unit ordering for these ids).
--
-- Safety: pairs that ALREADY have a keyed row are skipped — stamping a twin
-- would violate the unique index; those stray legacy rows remain (visible as
-- duplicates until removed by an operator) rather than destroying history.

UPDATE "Conversation" c
SET "directPairKey" = k.pair_key
FROM (
  SELECT
    cm."conversationId" AS cid,
    string_agg(cm."userId", ':' ORDER BY cm."userId" COLLATE "C") AS pair_key
  FROM "ConversationMember" cm
  WHERE cm."conversationId" IN (
    SELECT id FROM "Conversation" WHERE type = 'DIRECT'
  )
  GROUP BY cm."conversationId"
  HAVING COUNT(*) = 2
) k
WHERE c.id = k.cid
  AND c.type = 'DIRECT'
  AND c."directPairKey" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Conversation" t WHERE t."directPairKey" = k.pair_key
  );
