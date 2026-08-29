-- Private Personal Today ordering. Polymorphic entry ids deliberately do not
-- reference Task or StudyItem because one private agenda can contain both.

CREATE TABLE "DailyAgendaOrderState" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "localDate" DATE NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailyAgendaOrderState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DailyAgendaOrderItem" (
  "id" TEXT NOT NULL,
  "stateId" TEXT NOT NULL,
  "entryId" TEXT NOT NULL,
  "rank" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailyAgendaOrderItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyAgendaOrderState_ownerUserId_localDate_key"
  ON "DailyAgendaOrderState"("ownerUserId", "localDate");
CREATE INDEX "DailyAgendaOrderState_localDate_updatedAt_idx"
  ON "DailyAgendaOrderState"("localDate", "updatedAt");
CREATE UNIQUE INDEX "DailyAgendaOrderItem_stateId_entryId_key"
  ON "DailyAgendaOrderItem"("stateId", "entryId");
CREATE INDEX "DailyAgendaOrderItem_stateId_rank_idx"
  ON "DailyAgendaOrderItem"("stateId", "rank");

ALTER TABLE "DailyAgendaOrderState"
  ADD CONSTRAINT "DailyAgendaOrderState_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DailyAgendaOrderItem"
  ADD CONSTRAINT "DailyAgendaOrderItem_stateId_fkey"
  FOREIGN KEY ("stateId") REFERENCES "DailyAgendaOrderState"("id") ON DELETE CASCADE ON UPDATE CASCADE;
