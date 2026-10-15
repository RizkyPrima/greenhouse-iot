-- Phase 10.4.2: metadata-only publication registry and ingestion job history.
-- Additive: existing plant catalog lifecycle and configuration tables are untouched.

ALTER TYPE "PlatformPermission" ADD VALUE 'RESEARCH_SOURCE_ADMIN';

CREATE TYPE "ResearchJobType" AS ENUM ('MANUAL_REGISTRATION', 'METADATA_SEARCH');
CREATE TYPE "ResearchJobStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');
CREATE TYPE "ResearchAccessStatus" AS ENUM ('UNKNOWN', 'OPEN', 'RESTRICTED', 'CLOSED');
CREATE TYPE "ResearchLicenseStatus" AS ENUM ('UNKNOWN', 'OPEN_LICENSE', 'RESTRICTED_LICENSE', 'ALL_RIGHTS_RESERVED');

CREATE TABLE "research_sources" (
  "id" TEXT NOT NULL,
  "doiNormalized" TEXT,
  "alternateIdentifierType" TEXT,
  "alternateIdentifier" TEXT,
  "crossrefId" TEXT,
  "openAlexId" TEXT,
  "title" TEXT NOT NULL,
  "authors" JSONB NOT NULL DEFAULT '[]',
  "publicationYear" INTEGER,
  "journal" TEXT,
  "publisher" TEXT,
  "abstract" TEXT,
  "abstractLicenseStatus" "ResearchLicenseStatus" NOT NULL DEFAULT 'UNKNOWN',
  "sourceUrl" TEXT,
  "metadataProvider" TEXT,
  "providerMetadata" JSONB NOT NULL DEFAULT '{}',
  "metadataFetchedAt" TIMESTAMP(3),
  "accessStatus" "ResearchAccessStatus" NOT NULL DEFAULT 'UNKNOWN',
  "licenseStatus" "ResearchLicenseStatus" NOT NULL DEFAULT 'UNKNOWN',
  "licenseUrl" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "research_sources_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "research_sources_publicationYear_check" CHECK ("publicationYear" IS NULL OR ("publicationYear" BETWEEN 1000 AND 9999)),
  CONSTRAINT "research_sources_doi_normalized_check" CHECK ("doiNormalized" IS NULL OR ("doiNormalized" = LOWER("doiNormalized") AND "doiNormalized" ~ '^10[.][0-9]{4,9}/[^[:space:]]+$')),
  CONSTRAINT "research_sources_alternate_identifier_type_check" CHECK ("alternateIdentifierType" IS NULL OR "alternateIdentifierType" = LOWER("alternateIdentifierType"))
);
CREATE UNIQUE INDEX "research_sources_doiNormalized_ci_key" ON "research_sources"(LOWER("doiNormalized")) WHERE "doiNormalized" IS NOT NULL;
CREATE UNIQUE INDEX "research_sources_alternateIdentifierType_alternateIdentifier_key" ON "research_sources"("alternateIdentifierType", "alternateIdentifier");
CREATE UNIQUE INDEX "research_sources_crossrefId_ci_key" ON "research_sources"(LOWER("crossrefId")) WHERE "crossrefId" IS NOT NULL;
CREATE UNIQUE INDEX "research_sources_openAlexId_ci_key" ON "research_sources"(LOWER("openAlexId")) WHERE "openAlexId" IS NOT NULL;
CREATE INDEX "research_sources_publicationYear_idx" ON "research_sources"("publicationYear");
CREATE INDEX "research_sources_metadataProvider_metadataFetchedAt_idx" ON "research_sources"("metadataProvider", "metadataFetchedAt");
ALTER TABLE "research_sources" ADD CONSTRAINT "research_sources_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "research_jobs" (
  "id" TEXT NOT NULL,
  "type" "ResearchJobType" NOT NULL,
  "provider" TEXT,
  "query" TEXT,
  "status" "ResearchJobStatus" NOT NULL,
  "resultCount" INTEGER NOT NULL DEFAULT 0,
  "summary" JSONB NOT NULL DEFAULT '{}',
  "safeErrorCode" TEXT,
  "actorUserId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "research_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "research_jobs_resultCount_check" CHECK ("resultCount" >= 0)
);
CREATE INDEX "research_jobs_actorUserId_startedAt_idx" ON "research_jobs"("actorUserId", "startedAt");
CREATE INDEX "research_jobs_type_status_startedAt_idx" ON "research_jobs"("type", "status", "startedAt");
ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "research_job_sources" (
  "jobId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "research_job_sources_pkey" PRIMARY KEY ("jobId", "sourceId", "provider")
);
CREATE INDEX "research_job_sources_sourceId_retrievedAt_idx" ON "research_job_sources"("sourceId", "retrievedAt");
ALTER TABLE "research_job_sources" ADD CONSTRAINT "research_job_sources_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "research_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_job_sources" ADD CONSTRAINT "research_job_sources_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "research_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
