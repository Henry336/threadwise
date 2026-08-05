-- A pending edit belongs to the actor's current interaction session, while the
-- edited row may still belong to a preserved pre-supergroup owner record.
ALTER TABLE "PendingItemEdit" ADD COLUMN "itemOwnerUserId" TEXT;
