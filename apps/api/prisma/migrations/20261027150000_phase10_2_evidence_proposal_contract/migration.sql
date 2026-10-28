-- Phase 10.2: additive scientific evidence and AI proposal contract persistence.
-- No existing catalog or research-source rows are changed.
CREATE TYPE "ScientificEvidenceVerificationStatus" AS ENUM ('UNKNOWN', 'UNVERIFIED', 'VERIFIED');
CREATE TYPE "PlantAiProposalStatus" AS ENUM ('REQUESTED', 'RESEARCH_PENDING', 'PROPOSED', 'NEEDS_REVIEW', 'INVALID', 'APPROVED', 'REJECTED');

CREATE TABLE "plant_scientific_evidence" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT,
  "verificationStatus" "ScientificEvidenceVerificationStatus" NOT NULL DEFAULT 'UNKNOWN',
  "contract" JSONB NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "plant_scientific_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plant_scientific_evidence_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "research_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "plant_scientific_evidence_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "plant_scientific_evidence_sourceId_idx" ON "plant_scientific_evidence"("sourceId");
CREATE INDEX "plant_scientific_evidence_verificationStatus_createdAt_idx" ON "plant_scientific_evidence"("verificationStatus", "createdAt");

CREATE TABLE "plant_ai_proposals" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "plantCatalogId" TEXT NOT NULL,
  "targetCatalogVersionId" TEXT,
  "status" "PlantAiProposalStatus" NOT NULL DEFAULT 'REQUESTED',
  "contract" JSONB NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "plant_ai_proposals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plant_ai_proposals_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "plant_ai_proposals_plantCatalogId_fkey" FOREIGN KEY ("plantCatalogId") REFERENCES "plant_catalogs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "plant_ai_proposals_targetCatalogVersionId_fkey" FOREIGN KEY ("targetCatalogVersionId") REFERENCES "plant_catalog_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "plant_ai_proposals_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "plant_ai_proposals_organizationId_status_createdAt_idx" ON "plant_ai_proposals"("organizationId", "status", "createdAt");
CREATE INDEX "plant_ai_proposals_plantCatalogId_createdAt_idx" ON "plant_ai_proposals"("plantCatalogId", "createdAt");
CREATE INDEX "plant_ai_proposals_targetCatalogVersionId_idx" ON "plant_ai_proposals"("targetCatalogVersionId");

CREATE TABLE "plant_ai_proposal_evidence" (
  "proposalId" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  CONSTRAINT "plant_ai_proposal_evidence_pkey" PRIMARY KEY ("proposalId", "evidenceId"),
  CONSTRAINT "plant_ai_proposal_evidence_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "plant_ai_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "plant_ai_proposal_evidence_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "plant_scientific_evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "plant_ai_proposal_evidence_evidenceId_idx" ON "plant_ai_proposal_evidence"("evidenceId");
