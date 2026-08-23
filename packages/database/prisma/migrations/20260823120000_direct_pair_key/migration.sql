-- Canonical uniqueness for DIRECT conversations.
-- directPairKey = sorted "userIdA:userIdB" (see directPairKeyFor in
-- packages/database/src/index.ts). NULL for GROUP conversations (Postgres
-- UNIQUE indexes allow multiple NULLs).

-- Backfill existing DIRECT rows. Legacy seed rows may carry a third
-- (system-bot) member, so the key uses the two lexicographically first
-- member ids — which for a 2-member direct conversation is exactly the pair.
-- If duplicate pairs already exist, the UNIQUE constraint below FAILS
-- LOUDLY: legacy duplicates require an explicit data audit/repair, never a
-- silent delete.
ALTER TABLE "Conversation" ADD COLUMN "directPairKey" TEXT;

UPDATE "Conversation" c
SET "directPairKey" = array_to_string(pair.first_two, ':')
FROM (
  SELECT cm."conversationId" AS cid,
         (array_agg(cm."userId" ORDER BY cm."userId"))[1:2] AS first_two
  FROM "ConversationMember" cm
  JOIN "Conversation" c2 ON c2.id = cm."conversationId" AND c2.type = 'DIRECT'
  GROUP BY cm."conversationId"
  HAVING COUNT(*) >= 2
) pair
WHERE c.id = pair.cid
  AND c."directPairKey" IS NULL;

ALTER TABLE "Conversation"
  ADD CONSTRAINT "Conversation_directPairKey_key" UNIQUE ("directPairKey");