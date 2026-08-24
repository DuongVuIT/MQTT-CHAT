-- Soft-delete tombstone for conversations (repair-log #28).
-- Deleted groups keep their history (sequence/receipts/audit intact)
-- but vanish from lists and reject further sends.
ALTER TABLE "Conversation" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Conversation" ADD COLUMN "deletedBy" TEXT;
