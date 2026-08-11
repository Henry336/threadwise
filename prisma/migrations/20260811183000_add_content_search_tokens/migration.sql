ALTER TABLE "StudyResource" ADD COLUMN "searchTokens" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Idea" ADD COLUMN "searchTokens" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Task" ADD COLUMN "searchTokens" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Note" ADD COLUMN "searchTokens" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "StoredImage" ADD COLUMN "searchTokens" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- PostgreSQL's GIN array index keeps keyed-token lookups logarithmic instead
-- of forcing a scan over every encrypted record.
CREATE INDEX "StudyResource_searchTokens_idx" ON "StudyResource" USING GIN ("searchTokens");
CREATE INDEX "Idea_searchTokens_idx" ON "Idea" USING GIN ("searchTokens");
CREATE INDEX "Task_searchTokens_idx" ON "Task" USING GIN ("searchTokens");
CREATE INDEX "Note_searchTokens_idx" ON "Note" USING GIN ("searchTokens");
CREATE INDEX "StoredImage_searchTokens_idx" ON "StoredImage" USING GIN ("searchTokens");
