-- Tenant-owned plant catalogs. Existing global rows remain organizationId NULL as
-- legacy sources; new application-created catalogs always have an organization.
ALTER TABLE "plant_catalogs" ADD COLUMN "organizationId" TEXT;

DROP INDEX "plant_catalogs_code_key";
CREATE UNIQUE INDEX "plant_catalogs_organizationId_code_key"
  ON "plant_catalogs"("organizationId", "code");
CREATE UNIQUE INDEX "plant_catalogs_legacy_code_key"
  ON "plant_catalogs"("code") WHERE "organizationId" IS NULL;
CREATE INDEX "plant_catalogs_organizationId_status_idx"
  ON "plant_catalogs"("organizationId", "status");

ALTER TABLE "plant_catalogs"
  ADD CONSTRAINT "plant_catalogs_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION plant_profile_catalog_matches_organization() RETURNS trigger AS $$
DECLARE catalog_organization_id TEXT;
BEGIN
  SELECT "organizationId" INTO catalog_organization_id
  FROM "plant_catalogs" WHERE "id" = NEW."plantCatalogId";
  IF catalog_organization_id IS NOT NULL AND catalog_organization_id <> NEW."organizationId" THEN
    RAISE EXCEPTION 'Plant catalog belongs to a different organization';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "plant_profiles_catalog_matches_organization"
  BEFORE INSERT OR UPDATE OF "plantCatalogId", "organizationId" ON "plant_profiles"
  FOR EACH ROW EXECUTE FUNCTION plant_profile_catalog_matches_organization();
