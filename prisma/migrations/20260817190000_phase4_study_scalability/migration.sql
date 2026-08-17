ALTER TABLE "StudyResource"
ADD COLUMN "analysisExcerpt" TEXT,
ADD COLUMN "analysisExcerptReady" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "analysisExcerptTruncated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "captionPreview" TEXT,
ADD COLUMN "ocrPreview" TEXT,
ADD COLUMN "ocrPreviewTruncated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "wikiLookupKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "StudyCanvasMaterial"
ADD COLUMN "analysisExcerpt" TEXT,
ADD COLUMN "analysisExcerptReady" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "StudyResource_wikiLookupKeys_idx"
ON "StudyResource" USING GIN ("wikiLookupKeys");
