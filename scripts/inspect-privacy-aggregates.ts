import { PrismaClient } from "@prisma/client";
import { runtimeDatabaseUrl } from "../src/db/connectionUrl";

const REQUIRED_ACKNOWLEDGEMENT = "read-only-phase-2";

type AggregateRow = Record<string, unknown>;

const protectedFields = {
  Task: ["title", "description", "sourceText"],
  Note: ["title", "body", "summary", "sourceText"],
  Idea: ["title", "concept", "problem", "targetUser", "sourceText", "marketNotes"],
  StoredImage: ["fileName", "caption", "ocrText"],
  StudyResource: ["title", "body", "url", "fileName", "caption", "ocrText"],
  StudyResourceRevision: ["title", "body"],
} as const;

const searchableModels = ["Task", "Note", "Idea", "StoredImage", "StudyResource"] as const;

function assertInspectionBoundary(): void {
  if (process.env.THREADWISE_ALLOW_PRODUCTION_PRIVACY_INSPECTION !== REQUIRED_ACKNOWLEDGEMENT) {
    throw new Error("Phase 2 inspection acknowledgement is missing.");
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
}

function encryptionConfiguration() {
  const configuredMode = process.env.CONTENT_ENCRYPTION_MODE?.trim().toLowerCase();
  const key = process.env.CONTENT_ENCRYPTION_KEY?.trim();
  let keyShapeValid = false;
  if (key) {
    const decoded = Buffer.from(key, "base64");
    keyShapeValid = decoded.length === 32
      && decoded.toString("base64").replace(/=+$/u, "") === key.replace(/=+$/u, "");
  }
  return {
    configuredMode: configuredMode || "unset",
    effectiveMode: configuredMode === "write" ? "write" : "off",
    keyConfigured: Boolean(key),
    keyShapeValid,
  };
}

function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z][A-Za-z0-9]*$/u.test(value)) throw new Error("Unsafe inspection identifier.");
  return `"${value}"`;
}

async function query(tx: PrismaClient, sql: string): Promise<AggregateRow[]> {
  return tx.$queryRawUnsafe<AggregateRow[]>(sql);
}

function normalize(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object" && "toNumber" in value
    && typeof (value as { toNumber?: unknown }).toNumber === "function") {
    return (value as { toNumber: () => number }).toNumber();
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child)]));
  }
  return value;
}

async function inspect(): Promise<void> {
  assertInspectionBoundary();
  const databaseUrl = runtimeDatabaseUrl(process.env.DATABASE_URL!, {
    connectionLimit: 1,
    poolTimeoutSeconds: 15,
  });
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  try {
    const aggregates = await prisma.$transaction(async (transaction) => {
      const tx = transaction as unknown as PrismaClient;
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '15000ms'");
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '2000ms'");

      const transactionState = await query(tx, `
        SELECT current_setting('transaction_read_only') AS "transactionReadOnly",
               current_setting('server_version_num') AS "serverVersionNumber"
      `);

      const encryptionCoverage: AggregateRow[] = [];
      for (const [model, fields] of Object.entries(protectedFields)) {
        for (const field of fields) {
          const tableName = quoteIdentifier(model);
          const fieldName = quoteIdentifier(field);
          const exactPrefix = `twenc:v1:${model}:${field}:`;
          const validPattern = `^twenc:v1:${model}:${field}:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{16,}:[A-Za-z0-9_-]*$`;
          const [row] = await query(tx, `
            SELECT '${model}' AS model, '${field}' AS field,
                   COUNT(*) AS "rowCount",
                   COUNT(${fieldName}) AS "nonNullCount",
                   COUNT(*) FILTER (WHERE ${fieldName} LIKE '${exactPrefix}%') AS "encryptedPrefixCount",
                   COUNT(*) FILTER (WHERE ${fieldName} ~ '${validPattern}') AS "validEnvelopeCount",
                   COUNT(*) FILTER (WHERE ${fieldName} LIKE 'twenc:v1:%' AND ${fieldName} NOT LIKE '${exactPrefix}%') AS "wrongEnvelopeCount",
                   COUNT(*) FILTER (WHERE ${fieldName} IS NOT NULL AND ${fieldName} NOT LIKE 'twenc:v1:%') AS "plaintextCount",
                   COALESCE(SUM(octet_length(${fieldName})), 0) AS "storedBytes",
                   COALESCE(MAX(octet_length(${fieldName})), 0) AS "maxStoredBytes"
            FROM ${tableName}
          `);
          if (row) encryptionCoverage.push(row);
        }
      }

      const blindSearchTokens: AggregateRow[] = [];
      for (const model of searchableModels) {
        const tableName = quoteIdentifier(model);
        const [row] = await query(tx, `
          WITH token_counts AS (
            SELECT cardinality("searchTokens") AS token_count,
                   cardinality("searchTokens") - (
                     SELECT COUNT(DISTINCT token) FROM unnest("searchTokens") AS token
                   ) AS duplicate_count
            FROM ${tableName}
          )
          SELECT '${model}' AS model,
                 COUNT(*) AS "rowCount",
                 COUNT(*) FILTER (WHERE token_count = 0) AS "zeroTokens",
                 COUNT(*) FILTER (WHERE token_count BETWEEN 1 AND 10) AS "tokens1To10",
                 COUNT(*) FILTER (WHERE token_count BETWEEN 11 AND 50) AS "tokens11To50",
                 COUNT(*) FILTER (WHERE token_count BETWEEN 51 AND 100) AS "tokens51To100",
                 COUNT(*) FILTER (WHERE token_count BETWEEN 101 AND 500) AS "tokens101To500",
                 COUNT(*) FILTER (WHERE token_count > 500) AS "tokensOver500",
                 COALESCE(ROUND(AVG(token_count)::numeric, 2), 0)::double precision AS "averageTokens",
                 COALESCE(MAX(token_count), 0) AS "maxTokens",
                 COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY token_count), 0) AS "p50Tokens",
                 COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY token_count), 0) AS "p95Tokens",
                 COUNT(*) FILTER (WHERE duplicate_count > 0) AS "rowsWithDuplicateTokens",
                 COALESCE(SUM(duplicate_count), 0)::bigint AS "duplicateTokenEntries"
          FROM token_counts
        `);
        if (row) blindSearchTokens.push(row);
      }

      const aiStorage = {
        studyAnalysisJobs: await query(tx, `
          SELECT status::text, mode::text, COUNT(*) AS "jobCount",
                 COUNT(*) FILTER (WHERE "createdAt" >= now() - interval '1 day') AS "ageUnder1Day",
                 COUNT(*) FILTER (WHERE "createdAt" < now() - interval '1 day' AND "createdAt" >= now() - interval '7 days') AS "age1To7Days",
                 COUNT(*) FILTER (WHERE "createdAt" < now() - interval '7 days' AND "createdAt" >= now() - interval '30 days') AS "age8To30Days",
                 COUNT(*) FILTER (WHERE "createdAt" < now() - interval '30 days' AND "createdAt" >= now() - interval '90 days') AS "age31To90Days",
                 COUNT(*) FILTER (WHERE "createdAt" < now() - interval '90 days') AS "ageOver90Days",
                 COALESCE(SUM(pg_column_size("evidenceJson")), 0) AS "evidenceBytes",
                 COALESCE(SUM(octet_length(prompt)), 0) AS "promptBytes",
                 COALESCE(SUM(pg_column_size(result)), 0) AS "resultBytes",
                 COALESCE(SUM(octet_length(error)), 0) AS "errorBytes",
                 COALESCE(MAX(pg_column_size("evidenceJson")), 0) AS "maxEvidenceBytes",
                 COALESCE(MAX(octet_length(prompt)), 0) AS "maxPromptBytes",
                 COALESCE(MAX(pg_column_size(result)), 0) AS "maxResultBytes"
          FROM "GeminiStudyAnalysisJob" GROUP BY status, mode ORDER BY status, mode
        `),
        noteEditSuggestions: await query(tx, `
          SELECT status::text, COUNT(*) AS "suggestionCount",
                 COUNT(*) FILTER (WHERE "createdAt" >= now() - interval '1 day') AS "ageUnder1Day",
                 COUNT(*) FILTER (WHERE "createdAt" < now() - interval '1 day' AND "createdAt" >= now() - interval '7 days') AS "age1To7Days",
                 COUNT(*) FILTER (WHERE "createdAt" < now() - interval '7 days' AND "createdAt" >= now() - interval '30 days') AS "age8To30Days",
                 COUNT(*) FILTER (WHERE "createdAt" < now() - interval '30 days' AND "createdAt" >= now() - interval '90 days') AS "age31To90Days",
                 COUNT(*) FILTER (WHERE "createdAt" < now() - interval '90 days') AS "ageOver90Days",
                 COALESCE(SUM(octet_length("originalBody")), 0) AS "originalBodyBytes",
                 COALESCE(SUM(octet_length("suggestedBody")), 0) AS "suggestedBodyBytes",
                 COALESCE(SUM(octet_length(rationale)), 0) AS "rationaleBytes",
                 COALESCE(SUM(octet_length("appliedBody")), 0) AS "appliedBodyBytes",
                 COALESCE(MAX(octet_length("originalBody")), 0) AS "maxOriginalBodyBytes",
                 COALESCE(MAX(octet_length("suggestedBody")), 0) AS "maxSuggestedBodyBytes"
          FROM "StudyNoteEditSuggestion" GROUP BY status ORDER BY status
        `),
        ideaJobs: await query(tx, `
          SELECT status::text, action, COUNT(*) AS "jobCount",
                 COUNT(*) FILTER (WHERE "createdAt" >= now() - interval '1 day') AS "ageUnder1Day",
                 COUNT(*) FILTER (WHERE "createdAt" < now() - interval '1 day' AND "createdAt" >= now() - interval '30 days') AS "age1To30Days",
                 COUNT(*) FILTER (WHERE "createdAt" < now() - interval '30 days') AS "ageOver30Days",
                 COALESCE(SUM(octet_length(prompt)), 0) AS "promptBytes",
                 COALESCE(SUM(octet_length("finalResponse")), 0) AS "responseBytes",
                 COALESCE(SUM(octet_length(error)), 0) AS "errorBytes",
                 COALESCE(MAX(octet_length(prompt)), 0) AS "maxPromptBytes",
                 COALESCE(MAX(octet_length("finalResponse")), 0) AS "maxResponseBytes"
          FROM "GeminiIdeaJob" GROUP BY status, action ORDER BY status, action
        `),
      };

      const studyStorage = {
        resources: await query(tx, `
          SELECT kind::text, COUNT(*) AS "rowCount",
                 COALESCE(SUM(octet_length(body)), 0) AS "bodyBytes",
                 COALESCE(SUM(octet_length("ocrText")), 0) AS "ocrBytes",
                 COALESCE(SUM("fileSize"), 0) AS "declaredFileBytes",
                 COALESCE(MAX(octet_length(body)), 0) AS "maxBodyBytes",
                 COALESCE(MAX(octet_length("ocrText")), 0) AS "maxOcrBytes",
                 COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY COALESCE(octet_length(body), 0)), 0) AS "p95BodyBytes",
                 COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY COALESCE(octet_length("ocrText"), 0)), 0) AS "p95OcrBytes"
          FROM "StudyResource" GROUP BY kind ORDER BY kind
        `),
        revisions: await query(tx, `
          WITH revision_counts AS (
            SELECT "resourceId", COUNT(*) AS revision_count
            FROM "StudyResourceRevision" GROUP BY "resourceId"
          ), revision_summary AS (
            SELECT COALESCE(MAX(revision_count), 0) AS max_revisions_per_resource FROM revision_counts
          )
          SELECT COUNT(*) AS "rowCount", COUNT(DISTINCT "resourceId") AS "resourceCount",
                 COALESCE(SUM(octet_length(body)), 0) AS "bodyBytes",
                 COALESCE(MAX(octet_length(body)), 0) AS "maxBodyBytes",
                 COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY octet_length(body)), 0) AS "p50BodyBytes",
                 COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY octet_length(body)), 0) AS "p95BodyBytes",
                 (SELECT max_revisions_per_resource FROM revision_summary) AS "maxRevisionsPerResource"
          FROM "StudyResourceRevision"
        `),
        canvasMaterials: await query(tx, `
          SELECT kind::text, COUNT(*) AS "rowCount",
                 COALESCE(SUM(octet_length("extractedText")), 0) AS "extractedTextBytes",
                 COALESCE(SUM("byteSize"), 0) AS "declaredFileBytes",
                 COALESCE(MAX(octet_length("extractedText")), 0) AS "maxExtractedTextBytes",
                 COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY COALESCE(octet_length("extractedText"), 0)), 0) AS "p95ExtractedTextBytes"
          FROM "StudyCanvasMaterial" GROUP BY kind ORDER BY kind
        `),
        pendingCaptures: await query(tx, `
          SELECT COUNT(*) AS "rowCount",
                 COUNT(*) FILTER (WHERE "expiresAt" < now()) AS "expiredRows",
                 COALESCE(SUM(octet_length("sourceText")), 0) AS "sourceTextBytes",
                 COALESCE(SUM(octet_length("ocrText")), 0) AS "ocrBytes",
                 COALESCE(MAX(octet_length("ocrText")), 0) AS "maxOcrBytes"
          FROM "StudyPendingCapture"
        `),
        storedImages: await query(tx, `
          SELECT COUNT(*) AS "rowCount", COALESCE(SUM(octet_length("ocrText")), 0) AS "ocrBytes",
                 COALESCE(MAX(octet_length("ocrText")), 0) AS "maxOcrBytes",
                 COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY COALESCE(octet_length("ocrText"), 0)), 0) AS "p95OcrBytes"
          FROM "StoredImage"
        `),
      };

      const crossWorkspaceAnomalies = await query(tx, `
        SELECT * FROM (
          SELECT 'StudyWorkspace.activeModule' AS relationship, COUNT(*) AS "anomalyCount"
          FROM "StudyWorkspace" w JOIN "StudyModule" m ON m.id = w."activeModuleId" WHERE m."workspaceId" <> w.id
          UNION ALL SELECT 'StudyWorkspace.activeOrigin', COUNT(*)
          FROM "StudyWorkspace" w JOIN "StudyLocationOrigin" o ON o.id = w."activeOriginId" WHERE o."workspaceId" <> w.id
          UNION ALL SELECT 'StudyItem.module', COUNT(*)
          FROM "StudyItem" i JOIN "StudyModule" m ON m.id = i."moduleId" WHERE m."workspaceId" <> i."workspaceId"
          UNION ALL SELECT 'StudyItem.week', COUNT(*)
          FROM "StudyItem" i JOIN "StudyWeek" w ON w.id = i."weekId" WHERE w."workspaceId" <> i."workspaceId"
          UNION ALL SELECT 'StudySession.module', COUNT(*)
          FROM "StudySession" s JOIN "StudyModule" m ON m.id = s."moduleId" WHERE m."workspaceId" <> s."workspaceId"
          UNION ALL SELECT 'StudySession.item', COUNT(*)
          FROM "StudySession" s JOIN "StudyItem" i ON i.id = s."itemId" WHERE i."workspaceId" <> s."workspaceId"
          UNION ALL SELECT 'StudyMistake.module', COUNT(*)
          FROM "StudyMistake" x JOIN "StudyModule" m ON m.id = x."moduleId" WHERE m."workspaceId" <> x."workspaceId"
          UNION ALL SELECT 'StudyMistake.item', COUNT(*)
          FROM "StudyMistake" x JOIN "StudyItem" i ON i.id = x."itemId" WHERE i."workspaceId" <> x."workspaceId"
          UNION ALL SELECT 'StudyScheduleBlock.module', COUNT(*)
          FROM "StudyScheduleBlock" b JOIN "StudyModule" m ON m.id = b."moduleId" WHERE m."workspaceId" <> b."workspaceId"
          UNION ALL SELECT 'StudyScheduleBlock.defaultOrigin', COUNT(*)
          FROM "StudyScheduleBlock" b JOIN "StudyLocationOrigin" o ON o.id = b."defaultOriginId" WHERE o."workspaceId" <> b."workspaceId"
          UNION ALL SELECT 'StudyResource.module', COUNT(*)
          FROM "StudyResource" r JOIN "StudyModule" m ON m.id = r."moduleId" WHERE m."workspaceId" <> r."workspaceId"
          UNION ALL SELECT 'StudyResourceRevision.resource', COUNT(*)
          FROM "StudyResourceRevision" v JOIN "StudyResource" r ON r.id = v."resourceId" WHERE r."workspaceId" <> v."workspaceId"
          UNION ALL SELECT 'StudyNoteLink.source', COUNT(*)
          FROM "StudyNoteLink" l JOIN "StudyResource" r ON r.id = l."sourceResourceId" WHERE r."workspaceId" <> l."workspaceId"
          UNION ALL SELECT 'StudyNoteLink.target', COUNT(*)
          FROM "StudyNoteLink" l JOIN "StudyResource" r ON r.id = l."targetResourceId" WHERE r."workspaceId" <> l."workspaceId"
          UNION ALL SELECT 'StudySessionResource.workspace', COUNT(*)
          FROM "StudySessionResource" sr JOIN "StudySession" s ON s.id = sr."sessionId"
          JOIN "StudyResource" r ON r.id = sr."resourceId" WHERE s."workspaceId" <> r."workspaceId"
          UNION ALL SELECT 'StudyPendingCapture.module', COUNT(*)
          FROM "StudyPendingCapture" c JOIN "StudyModule" m ON m.id = c."moduleId" WHERE m."workspaceId" <> c."workspaceId"
          UNION ALL SELECT 'StudyCanvasCourseModule.module', COUNT(*)
          FROM "StudyCanvasCourseModule" c JOIN "StudyModule" m ON m.id = c."moduleId" WHERE m."workspaceId" <> c."workspaceId"
          UNION ALL SELECT 'StudyCanvasMaterial.module', COUNT(*)
          FROM "StudyCanvasMaterial" c JOIN "StudyModule" m ON m.id = c."moduleId" WHERE m."workspaceId" <> c."workspaceId"
          UNION ALL SELECT 'StudyCanvasMaterial.courseModule', COUNT(*)
          FROM "StudyCanvasMaterial" c JOIN "StudyCanvasCourseModule" m ON m.id = c."courseModuleId" WHERE m."workspaceId" <> c."workspaceId"
          UNION ALL SELECT 'StudyCanvasAssignment.module', COUNT(*)
          FROM "StudyCanvasAssignment" a JOIN "StudyModule" m ON m.id = a."moduleId" WHERE m."workspaceId" <> a."workspaceId"
          UNION ALL SELECT 'StudyCanvasAssignment.item', COUNT(*)
          FROM "StudyCanvasAssignment" a JOIN "StudyItem" i ON i.id = a."itemId" WHERE i."workspaceId" <> a."workspaceId"
          UNION ALL SELECT 'GeminiStudyAnalysisJob.module', COUNT(*)
          FROM "GeminiStudyAnalysisJob" j JOIN "StudyModule" m ON m.id = j."moduleId" WHERE m."workspaceId" <> j."workspaceId"
          UNION ALL SELECT 'StudyNoteEditSuggestion.module', COUNT(*)
          FROM "StudyNoteEditSuggestion" s JOIN "StudyModule" m ON m.id = s."moduleId" WHERE m."workspaceId" <> s."workspaceId"
          UNION ALL SELECT 'StudyNoteEditSuggestion.job', COUNT(*)
          FROM "StudyNoteEditSuggestion" s JOIN "GeminiStudyAnalysisJob" j ON j.id = s."analysisJobId" WHERE j."workspaceId" <> s."workspaceId"
          UNION ALL SELECT 'StudyNoteEditSuggestion.resource', COUNT(*)
          FROM "StudyNoteEditSuggestion" s JOIN "StudyResource" r ON r.id = s."resourceId" WHERE r."workspaceId" <> s."workspaceId"
          UNION ALL SELECT 'StudyWorkspace.owner', COUNT(*)
          FROM "StudyWorkspace" w JOIN "User" u ON u.id = w."ownerUserId" WHERE u."telegramId" <> w."ownerTelegramId"
        ) anomalies ORDER BY relationship
      `);

      return {
        transactionState,
        encryptionCoverage,
        blindSearchTokens,
        aiStorage,
        studyStorage,
        crossWorkspaceAnomalies,
      };
    }, { isolationLevel: "RepeatableRead", timeout: 90_000, maxWait: 10_000 });

    process.stdout.write(`${JSON.stringify(normalize({
      generatedAt: new Date().toISOString(),
      inspectionBoundary: "aggregate-only; transaction read-only",
      encryptionConfiguration: encryptionConfiguration(),
      aggregates,
    }), null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void inspect().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown aggregate inspection failure.";
  process.stderr.write(`Phase 2 aggregate inspection failed: ${message}\n`);
  process.exitCode = 1;
});
