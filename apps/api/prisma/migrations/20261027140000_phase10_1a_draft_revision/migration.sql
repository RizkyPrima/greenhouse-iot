-- Phase 10.1A.1: optimistic concurrency token for editable plant profile drafts.
-- Existing versions start at revision 1; this additive change does not touch config data.
ALTER TABLE "plant_profile_versions"
  ADD COLUMN "draftRevision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "plant_profile_versions"
  ADD CONSTRAINT "plant_profile_versions_draftRevision_check"
  CHECK ("draftRevision" > 0);
