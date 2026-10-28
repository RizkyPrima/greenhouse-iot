-- Add organization-scoped evidence and explicit verification provenance.
-- The Phase 2 migration is retained unchanged because its deployment state is unknown.
ALTER TYPE "PlatformPermission" ADD VALUE 'SCIENTIFIC_EVIDENCE_CURATOR';

ALTER TABLE "plant_scientific_evidence"
  ADD COLUMN "organizationId" TEXT,
  ADD COLUMN "verifiedByUserId" TEXT,
  ADD COLUMN "verifiedAt" TIMESTAMP(3);

ALTER TABLE "plant_scientific_evidence"
  ADD CONSTRAINT "plant_scientific_evidence_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "plant_scientific_evidence_verifiedByUserId_fkey"
    FOREIGN KEY ("verifiedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "plant_scientific_evidence_verification_provenance_check"
    CHECK (("verifiedByUserId" IS NULL) = ("verifiedAt" IS NULL)
      AND ("verificationStatus" = 'VERIFIED') = ("verifiedByUserId" IS NOT NULL AND "verifiedAt" IS NOT NULL)),
  ADD CONSTRAINT "plant_scientific_evidence_contract_status_check"
    CHECK ("contract"->>'verificationStatus' IS NOT NULL
      AND "contract"->>'verificationStatus' = "verificationStatus"::text);

CREATE INDEX "plant_scientific_evidence_organizationId_verificationStatus_createdAt_idx"
  ON "plant_scientific_evidence"("organizationId", "verificationStatus", "createdAt");

-- Composite keys make tenant/catalog and catalog/version pairings database-enforced.
CREATE UNIQUE INDEX "plant_catalogs_id_organizationId_key" ON "plant_catalogs"("id", "organizationId");

ALTER TABLE "plant_ai_proposals"
  DROP CONSTRAINT "plant_ai_proposals_plantCatalogId_fkey",
  ADD CONSTRAINT "plant_ai_proposals_plantCatalogId_organizationId_fkey"
    FOREIGN KEY ("plantCatalogId", "organizationId")
    REFERENCES "plant_catalogs"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  DROP CONSTRAINT "plant_ai_proposals_targetCatalogVersionId_fkey",
  ADD CONSTRAINT "plant_ai_proposals_target_version_catalog_fkey"
    FOREIGN KEY ("targetCatalogVersionId", "plantCatalogId")
    REFERENCES "plant_catalog_versions"("id", "plantCatalogId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "plant_ai_proposals_contract_status_check"
    CHECK ("contract"->>'status' IS NOT NULL AND "contract"->>'status' = "status"::text);
