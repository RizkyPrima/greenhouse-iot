-- Phase 10.1: plant catalog, immutable configuration versions, tenant profiles,
-- per-zone activation, and append-only audit. Additive; does not alter MQTT/device tables.

CREATE TYPE "PlantCatalogStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "PlantVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');
CREATE TYPE "PlantProfileStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "PlantProfileVersionStatus" AS ENUM ('DRAFT', 'VALIDATED', 'RETIRED');
CREATE TYPE "ZonePlantAssignmentStatus" AS ENUM ('ACTIVE', 'ENDED', 'CANCELLED');
CREATE TYPE "PlatformPermission" AS ENUM ('PLANT_CATALOG_ADMIN');

CREATE TABLE "platform_admin_grants" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "permission" "PlatformPermission" NOT NULL,
  "grantedByUserId" TEXT,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "platform_admin_grants_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "platform_admin_grants_userId_permission_idx" ON "platform_admin_grants"("userId", "permission");
CREATE UNIQUE INDEX "platform_admin_grants_active_user_permission_key" ON "platform_admin_grants"("userId", "permission") WHERE "revokedAt" IS NULL;
ALTER TABLE "platform_admin_grants" ADD CONSTRAINT "platform_admin_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "platform_admin_grants" ADD CONSTRAINT "platform_admin_grants_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "plant_catalogs" (
  "id" TEXT NOT NULL, "code" TEXT NOT NULL, "scientificName" TEXT NOT NULL,
  "commonName" TEXT NOT NULL, "cultivar" TEXT,
  "status" "PlantCatalogStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "plant_catalogs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "plant_catalogs_code_key" ON "plant_catalogs"("code");

CREATE TABLE "plant_catalog_versions" (
  "id" TEXT NOT NULL, "plantCatalogId" TEXT NOT NULL, "version" INTEGER NOT NULL,
  "status" "PlantVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "configSchemaVersion" TEXT NOT NULL DEFAULT 'plant-config/v1',
  "profileDefaults" JSONB NOT NULL DEFAULT '{}', "stageTemplates" JSONB NOT NULL DEFAULT '[]',
  "edgeCompatibility" JSONB, "checksumAlgorithm" TEXT NOT NULL DEFAULT 'SHA-256/JCS-RFC8785',
  "checksum" TEXT, "createdByUserId" TEXT NOT NULL, "publishedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "publishedAt" TIMESTAMP(3),
  CONSTRAINT "plant_catalog_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plant_catalog_versions_version_check" CHECK ("version" > 0),
  CONSTRAINT "plant_catalog_versions_publication_check" CHECK (("status" = 'DRAFT' AND "publishedAt" IS NULL) OR ("status" <> 'DRAFT' AND "publishedAt" IS NOT NULL AND "checksum" IS NOT NULL))
);
CREATE UNIQUE INDEX "plant_catalog_versions_plantCatalogId_version_key" ON "plant_catalog_versions"("plantCatalogId", "version");
CREATE UNIQUE INDEX "plant_catalog_versions_id_plantCatalogId_key" ON "plant_catalog_versions"("id", "plantCatalogId");
CREATE INDEX "plant_catalog_versions_status_publishedAt_idx" ON "plant_catalog_versions"("status", "publishedAt");
ALTER TABLE "plant_catalog_versions" ADD CONSTRAINT "plant_catalog_versions_plantCatalogId_fkey" FOREIGN KEY ("plantCatalogId") REFERENCES "plant_catalogs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plant_catalog_versions" ADD CONSTRAINT "plant_catalog_versions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plant_catalog_versions" ADD CONSTRAINT "plant_catalog_versions_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "plant_parameter_definitions" (
  "id" TEXT NOT NULL, "plantCatalogVersionId" TEXT NOT NULL, "parameterKey" TEXT NOT NULL,
  "label" TEXT NOT NULL, "dataType" TEXT NOT NULL, "unit" TEXT,
  "metadataSchema" JSONB NOT NULL DEFAULT '{}', "valueSchema" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plant_parameter_definitions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "plant_parameter_definitions_version_key_key" ON "plant_parameter_definitions"("plantCatalogVersionId", "parameterKey");
CREATE INDEX "plant_parameter_definitions_version_idx" ON "plant_parameter_definitions"("plantCatalogVersionId");
ALTER TABLE "plant_parameter_definitions" ADD CONSTRAINT "plant_parameter_definitions_plantCatalogVersionId_fkey" FOREIGN KEY ("plantCatalogVersionId") REFERENCES "plant_catalog_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Candidate keys used by tenant-safe composite foreign keys.
CREATE UNIQUE INDEX "greenhouses_id_organizationId_key" ON "greenhouses"("id", "organizationId");
CREATE UNIQUE INDEX "zones_id_greenhouseId_key" ON "zones"("id", "greenhouseId");

CREATE TABLE "plant_profiles" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "plantCatalogId" TEXT NOT NULL,
  "code" TEXT NOT NULL, "name" TEXT NOT NULL,
  "status" "PlantProfileStatus" NOT NULL DEFAULT 'ACTIVE', "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "plant_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "plant_profiles_organizationId_code_key" ON "plant_profiles"("organizationId", "code");
CREATE UNIQUE INDEX "plant_profiles_id_organizationId_plantCatalogId_key" ON "plant_profiles"("id", "organizationId", "plantCatalogId");
ALTER TABLE "plant_profiles" ADD CONSTRAINT "plant_profiles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plant_profiles" ADD CONSTRAINT "plant_profiles_plantCatalogId_fkey" FOREIGN KEY ("plantCatalogId") REFERENCES "plant_catalogs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plant_profiles" ADD CONSTRAINT "plant_profiles_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "plant_profile_versions" (
  "id" TEXT NOT NULL, "plantProfileId" TEXT NOT NULL, "organizationId" TEXT NOT NULL,
  "plantCatalogId" TEXT NOT NULL, "version" INTEGER NOT NULL, "sourceCatalogVersionId" TEXT NOT NULL,
  "adoptedFromVersionId" TEXT, "status" "PlantProfileVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "configSchemaVersion" TEXT NOT NULL, "profileConfig" JSONB NOT NULL DEFAULT '{}',
  "checksumAlgorithm" TEXT NOT NULL DEFAULT 'SHA-256/JCS-RFC8785', "checksum" TEXT,
  "createdByUserId" TEXT NOT NULL, "validatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "validatedAt" TIMESTAMP(3),
  CONSTRAINT "plant_profile_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plant_profile_versions_version_check" CHECK ("version" > 0),
  CONSTRAINT "plant_profile_versions_publication_check" CHECK (("status" = 'DRAFT' AND "validatedAt" IS NULL) OR ("status" <> 'DRAFT' AND "validatedAt" IS NOT NULL AND "checksum" IS NOT NULL))
);
CREATE UNIQUE INDEX "plant_profile_versions_profile_version_key" ON "plant_profile_versions"("plantProfileId", "version");
CREATE UNIQUE INDEX "plant_profile_versions_id_org_key" ON "plant_profile_versions"("id", "organizationId");
CREATE UNIQUE INDEX "plant_profile_versions_id_profile_key" ON "plant_profile_versions"("id", "plantProfileId");
CREATE INDEX "plant_profile_versions_org_status_idx" ON "plant_profile_versions"("organizationId", "status");
ALTER TABLE "plant_profile_versions" ADD CONSTRAINT "plant_profile_versions_plantProfileId_organizationId_plant_fkey" FOREIGN KEY ("plantProfileId", "organizationId", "plantCatalogId") REFERENCES "plant_profiles"("id", "organizationId", "plantCatalogId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plant_profile_versions" ADD CONSTRAINT "plant_profile_versions_sourceCatalogVersionId_plantCatalog_fkey" FOREIGN KEY ("sourceCatalogVersionId", "plantCatalogId") REFERENCES "plant_catalog_versions"("id", "plantCatalogId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plant_profile_versions" ADD CONSTRAINT "plant_profile_versions_adoptedFromVersionId_plantProfileId_fkey" FOREIGN KEY ("adoptedFromVersionId", "plantProfileId") REFERENCES "plant_profile_versions"("id", "plantProfileId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plant_profile_versions" ADD CONSTRAINT "plant_profile_versions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plant_profile_versions" ADD CONSTRAINT "plant_profile_versions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plant_profile_versions" ADD CONSTRAINT "plant_profile_versions_validatedByUserId_fkey" FOREIGN KEY ("validatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE FUNCTION plant_profile_version_schema_matches_catalog() RETURNS trigger AS $$
DECLARE
  source_schema_version TEXT;
  source_status "PlantVersionStatus";
BEGIN
  SELECT "configSchemaVersion", "status" INTO source_schema_version, source_status FROM "plant_catalog_versions" WHERE "id" = NEW."sourceCatalogVersionId";
  IF source_schema_version IS DISTINCT FROM NEW."configSchemaVersion" THEN
    RAISE EXCEPTION 'Plant profile schema version must match its source catalog version';
  END IF;
  IF source_status IS DISTINCT FROM 'PUBLISHED' THEN
    RAISE EXCEPTION 'Plant profile versions must use a published catalog version';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "plant_profile_versions_schema_matches_source" BEFORE INSERT OR UPDATE OF "sourceCatalogVersionId", "configSchemaVersion" ON "plant_profile_versions" FOR EACH ROW EXECUTE FUNCTION plant_profile_version_schema_matches_catalog();

CREATE TABLE "growth_stages" (
  "id" TEXT NOT NULL, "plantProfileVersionId" TEXT NOT NULL, "code" TEXT NOT NULL,
  "label" TEXT NOT NULL, "sequence" INTEGER NOT NULL, "minDurationDays" INTEGER,
  "maxDurationDays" INTEGER, "transitionCriteria" JSONB,
  CONSTRAINT "growth_stages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "growth_stages_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "growth_stages_duration_check" CHECK (("minDurationDays" IS NULL OR "minDurationDays" >= 0) AND ("maxDurationDays" IS NULL OR "maxDurationDays" >= 0) AND ("minDurationDays" IS NULL OR "maxDurationDays" IS NULL OR "minDurationDays" <= "maxDurationDays"))
);
CREATE UNIQUE INDEX "growth_stages_version_code_key" ON "growth_stages"("plantProfileVersionId", "code");
CREATE UNIQUE INDEX "growth_stages_version_sequence_key" ON "growth_stages"("plantProfileVersionId", "sequence");
CREATE UNIQUE INDEX "growth_stages_id_version_key" ON "growth_stages"("id", "plantProfileVersionId");
ALTER TABLE "growth_stages" ADD CONSTRAINT "growth_stages_plantProfileVersionId_fkey" FOREIGN KEY ("plantProfileVersionId") REFERENCES "plant_profile_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "stage_parameter_configs" (
  "id" TEXT NOT NULL, "growthStageId" TEXT NOT NULL, "config" JSONB NOT NULL DEFAULT '{}',
  "configSchemaVersion" TEXT NOT NULL, "checksumAlgorithm" TEXT NOT NULL DEFAULT 'SHA-256/JCS-RFC8785',
  "checksum" TEXT,
  CONSTRAINT "stage_parameter_configs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stage_parameter_configs_growthStageId_key" ON "stage_parameter_configs"("growthStageId");
ALTER TABLE "stage_parameter_configs" ADD CONSTRAINT "stage_parameter_configs_growthStageId_fkey" FOREIGN KEY ("growthStageId") REFERENCES "growth_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION plant_stage_config_schema_matches_profile() RETURNS trigger AS $$
DECLARE expected_schema_version TEXT;
BEGIN
  SELECT p."configSchemaVersion" INTO expected_schema_version
    FROM "growth_stages" s JOIN "plant_profile_versions" p ON p."id" = s."plantProfileVersionId"
    WHERE s."id" = NEW."growthStageId";
  IF expected_schema_version IS DISTINCT FROM NEW."configSchemaVersion" THEN
    RAISE EXCEPTION 'Growth-stage schema version must match its plant profile version';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "stage_parameter_configs_schema_matches_profile" BEFORE INSERT OR UPDATE OF "growthStageId", "configSchemaVersion" ON "stage_parameter_configs" FOR EACH ROW EXECUTE FUNCTION plant_stage_config_schema_matches_profile();

CREATE TABLE "zone_plant_assignments" (
  "id" TEXT NOT NULL, "zoneId" TEXT NOT NULL, "greenhouseId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL, "plantProfileVersionId" TEXT NOT NULL, "growthStageId" TEXT NOT NULL,
  "status" "ZonePlantAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "endedAt" TIMESTAMP(3),
  "assignedByUserId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "zone_plant_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "zone_plant_assignments_state_check" CHECK (("status" = 'ACTIVE' AND "endedAt" IS NULL) OR ("status" <> 'ACTIVE' AND "endedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "zone_plant_assignments_one_active_per_zone" ON "zone_plant_assignments"("zoneId") WHERE "status" = 'ACTIVE';
CREATE INDEX "zone_plant_assignments_org_zone_status_idx" ON "zone_plant_assignments"("organizationId", "zoneId", "status");
CREATE INDEX "zone_plant_assignments_profile_version_idx" ON "zone_plant_assignments"("plantProfileVersionId");
ALTER TABLE "zone_plant_assignments" ADD CONSTRAINT "zone_plant_assignments_zoneId_greenhouseId_fkey" FOREIGN KEY ("zoneId", "greenhouseId") REFERENCES "zones"("id", "greenhouseId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zone_plant_assignments" ADD CONSTRAINT "zone_plant_assignments_greenhouseId_organizationId_fkey" FOREIGN KEY ("greenhouseId", "organizationId") REFERENCES "greenhouses"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zone_plant_assignments" ADD CONSTRAINT "zone_plant_assignments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zone_plant_assignments" ADD CONSTRAINT "zone_plant_assignments_plantProfileVersionId_organizationI_fkey" FOREIGN KEY ("plantProfileVersionId", "organizationId") REFERENCES "plant_profile_versions"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zone_plant_assignments" ADD CONSTRAINT "zone_plant_assignments_growthStageId_plantProfileVersionId_fkey" FOREIGN KEY ("growthStageId", "plantProfileVersionId") REFERENCES "growth_stages"("id", "plantProfileVersionId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zone_plant_assignments" ADD CONSTRAINT "zone_plant_assignments_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION plant_assignment_version_must_be_validated() RETURNS trigger AS $$
DECLARE profile_status "PlantProfileVersionStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Zone plant assignment history cannot be deleted';
  END IF;
  SELECT "status" INTO profile_status FROM "plant_profile_versions" WHERE "id" = NEW."plantProfileVersionId";
  IF (TG_OP = 'INSERT' OR NEW."status" = 'ACTIVE') AND profile_status IS DISTINCT FROM 'VALIDATED' THEN
    RAISE EXCEPTION 'Only validated plant profile versions can be assigned to zones';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    OLD."zoneId" IS DISTINCT FROM NEW."zoneId" OR
    OLD."greenhouseId" IS DISTINCT FROM NEW."greenhouseId" OR
    OLD."organizationId" IS DISTINCT FROM NEW."organizationId" OR
    OLD."plantProfileVersionId" IS DISTINCT FROM NEW."plantProfileVersionId" OR
    OLD."growthStageId" IS DISTINCT FROM NEW."growthStageId" OR
    OLD."assignedByUserId" IS DISTINCT FROM NEW."assignedByUserId" OR
    OLD."activatedAt" IS DISTINCT FROM NEW."activatedAt" OR
    OLD."createdAt" IS DISTINCT FROM NEW."createdAt"
  ) THEN
    RAISE EXCEPTION 'Zone plant assignment identity is immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD."status" <> 'ACTIVE' OR NEW."status" NOT IN ('ENDED', 'CANCELLED')) THEN
    RAISE EXCEPTION 'Active assignments can only transition to ended or cancelled';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "zone_plant_assignments_validated_version_and_history" BEFORE INSERT OR UPDATE OR DELETE ON "zone_plant_assignments" FOR EACH ROW EXECUTE FUNCTION plant_assignment_version_must_be_validated();

CREATE TABLE "zone_parameter_overrides" (
  "id" TEXT NOT NULL, "assignmentId" TEXT NOT NULL, "revision" INTEGER NOT NULL,
  "overrideConfig" JSONB NOT NULL DEFAULT '{}', "configSchemaVersion" TEXT NOT NULL,
  "checksumAlgorithm" TEXT NOT NULL DEFAULT 'SHA-256/JCS-RFC8785', "checksum" TEXT,
  "createdByUserId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "supersededAt" TIMESTAMP(3),
  CONSTRAINT "zone_parameter_overrides_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "zone_parameter_overrides_revision_check" CHECK ("revision" > 0)
);
CREATE UNIQUE INDEX "zone_parameter_overrides_assignment_revision_key" ON "zone_parameter_overrides"("assignmentId", "revision");
CREATE UNIQUE INDEX "zone_parameter_overrides_one_current_per_assignment" ON "zone_parameter_overrides"("assignmentId") WHERE "supersededAt" IS NULL;
CREATE INDEX "zone_parameter_overrides_assignment_superseded_idx" ON "zone_parameter_overrides"("assignmentId", "supersededAt");
ALTER TABLE "zone_parameter_overrides" ADD CONSTRAINT "zone_parameter_overrides_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "zone_plant_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "zone_parameter_overrides" ADD CONSTRAINT "zone_parameter_overrides_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION plant_zone_override_schema_matches_assignment() RETURNS trigger AS $$
DECLARE expected_schema_version TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Zone override revisions cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'supersededAt') IS DISTINCT FROM (to_jsonb(OLD) - 'supersededAt') OR
       OLD."supersededAt" IS NOT NULL OR NEW."supersededAt" IS NULL THEN
      RAISE EXCEPTION 'Zone override revisions are immutable and can only be superseded once';
    END IF;
    RETURN NEW;
  END IF;
  SELECT p."configSchemaVersion" INTO expected_schema_version
    FROM "zone_plant_assignments" a JOIN "plant_profile_versions" p ON p."id" = a."plantProfileVersionId"
    WHERE a."id" = NEW."assignmentId" AND a."status" = 'ACTIVE';
  IF expected_schema_version IS DISTINCT FROM NEW."configSchemaVersion" THEN
    RAISE EXCEPTION 'Zone override schema version must match its active assignment';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "zone_parameter_overrides_valid_schema_and_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "zone_parameter_overrides" FOR EACH ROW EXECUTE FUNCTION plant_zone_override_schema_matches_assignment();

CREATE TABLE "plant_config_audit_events" (
  "id" TEXT NOT NULL, "organizationId" TEXT, "actorUserId" TEXT, "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL, "entityId" TEXT NOT NULL, "fromChecksum" TEXT, "toChecksum" TEXT,
  "details" JSONB, "requestId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plant_config_audit_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "plant_config_audit_events_org_created_idx" ON "plant_config_audit_events"("organizationId", "createdAt");
CREATE INDEX "plant_config_audit_events_entity_created_idx" ON "plant_config_audit_events"("entityType", "entityId", "createdAt");
CREATE INDEX "plant_config_audit_events_actor_created_idx" ON "plant_config_audit_events"("actorUserId", "createdAt");
ALTER TABLE "plant_config_audit_events" ADD CONSTRAINT "plant_config_audit_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plant_config_audit_events" ADD CONSTRAINT "plant_config_audit_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Published snapshots are immutable. Retirement changes only lifecycle metadata.
CREATE FUNCTION plant_reject_published_catalog_version_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'DRAFT' AND
     (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'Published plant catalog versions are immutable';
  END IF;
  IF OLD."status" <> 'DRAFT' AND NEW."status" NOT IN ('PUBLISHED', 'RETIRED') THEN
    RAISE EXCEPTION 'Invalid plant catalog version lifecycle transition';
  END IF;
  IF OLD."status" = 'RETIRED' AND NEW."status" <> 'RETIRED' THEN
    RAISE EXCEPTION 'Retired catalog versions cannot be republished';
  END IF;
  IF OLD."status" <> 'DRAFT' AND TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Published plant catalog versions cannot be deleted';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "plant_catalog_versions_immutable" BEFORE UPDATE OR DELETE ON "plant_catalog_versions" FOR EACH ROW EXECUTE FUNCTION plant_reject_published_catalog_version_mutation();

CREATE FUNCTION plant_parameter_definition_requires_draft() RETURNS trigger AS $$
DECLARE
  version_id TEXT;
  version_status "PlantVersionStatus";
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."plantCatalogVersionId" IS DISTINCT FROM NEW."plantCatalogVersionId" THEN
    RAISE EXCEPTION 'Parameter definitions cannot be moved between catalog versions';
  END IF;
  version_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."plantCatalogVersionId" ELSE NEW."plantCatalogVersionId" END;
  SELECT "status" INTO version_status FROM "plant_catalog_versions" WHERE "id" = version_id;
  IF version_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Parameter definitions of published catalog versions are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "plant_parameter_definitions_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "plant_parameter_definitions" FOR EACH ROW EXECUTE FUNCTION plant_parameter_definition_requires_draft();

CREATE FUNCTION plant_reject_validated_profile_version_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'DRAFT' AND TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Validated plant profile versions cannot be deleted';
  END IF;
  IF OLD."status" <> 'DRAFT' AND
     (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'Validated plant profile versions are immutable';
  END IF;
  IF OLD."status" <> 'DRAFT' AND NEW."status" NOT IN ('VALIDATED', 'RETIRED') THEN
    RAISE EXCEPTION 'Invalid plant profile version lifecycle transition';
  END IF;
  IF OLD."status" = 'RETIRED' AND NEW."status" <> 'RETIRED' THEN
    RAISE EXCEPTION 'Retired profile versions cannot be revalidated';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "plant_profile_versions_immutable" BEFORE UPDATE OR DELETE ON "plant_profile_versions" FOR EACH ROW EXECUTE FUNCTION plant_reject_validated_profile_version_mutation();

CREATE FUNCTION plant_growth_stage_requires_draft() RETURNS trigger AS $$
DECLARE
  version_id TEXT;
  version_status "PlantProfileVersionStatus";
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."plantProfileVersionId" IS DISTINCT FROM NEW."plantProfileVersionId" THEN
    RAISE EXCEPTION 'Growth stages cannot be moved between profile versions';
  END IF;
  version_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."plantProfileVersionId" ELSE NEW."plantProfileVersionId" END;
  SELECT "status" INTO version_status FROM "plant_profile_versions" WHERE "id" = version_id;
  IF version_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Growth stages of validated plant profile versions are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "growth_stages_immutable_after_validation" BEFORE INSERT OR UPDATE OR DELETE ON "growth_stages" FOR EACH ROW EXECUTE FUNCTION plant_growth_stage_requires_draft();

CREATE FUNCTION plant_stage_config_requires_draft() RETURNS trigger AS $$
DECLARE
  stage_id TEXT;
  version_status "PlantProfileVersionStatus";
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."growthStageId" IS DISTINCT FROM NEW."growthStageId" THEN
    RAISE EXCEPTION 'Stage configurations cannot be moved between stages';
  END IF;
  stage_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."growthStageId" ELSE NEW."growthStageId" END;
  SELECT p."status" INTO version_status
    FROM "growth_stages" s JOIN "plant_profile_versions" p ON p."id" = s."plantProfileVersionId"
    WHERE s."id" = stage_id;
  IF version_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Stage configuration of validated plant profile versions is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "stage_parameter_configs_immutable_after_validation" BEFORE INSERT OR UPDATE OR DELETE ON "stage_parameter_configs" FOR EACH ROW EXECUTE FUNCTION plant_stage_config_requires_draft();

CREATE FUNCTION plant_config_audit_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Plant configuration audit events are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "plant_config_audit_events_append_only" BEFORE UPDATE OR DELETE ON "plant_config_audit_events" FOR EACH ROW EXECUTE FUNCTION plant_config_audit_events_append_only();

-- Zone deletion must be blocked when any assignment history exists.
CREATE FUNCTION plant_zone_assignment_history_restrict_delete() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "zone_plant_assignments" WHERE "zoneId" = OLD."id") THEN
    RAISE EXCEPTION 'Zone with plant assignment history cannot be deleted';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "zones_plant_assignment_restrict_delete" BEFORE DELETE ON "zones" FOR EACH ROW EXECUTE FUNCTION plant_zone_assignment_history_restrict_delete();

CREATE FUNCTION plant_zone_active_assignment_restrict_soft_delete() RETURNS trigger AS $$
BEGIN
  IF OLD."deletedAt" IS NULL AND NEW."deletedAt" IS NOT NULL AND
     EXISTS (SELECT 1 FROM "zone_plant_assignments" WHERE "zoneId" = OLD."id" AND "status" = 'ACTIVE') THEN
    RAISE EXCEPTION 'Zone with an active plant assignment cannot be deleted';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "zones_active_plant_assignment_restrict_soft_delete" BEFORE UPDATE OF "deletedAt" ON "zones" FOR EACH ROW EXECUTE FUNCTION plant_zone_active_assignment_restrict_soft_delete();

CREATE FUNCTION plant_greenhouse_active_assignment_restrict_soft_delete() RETURNS trigger AS $$
BEGIN
  IF OLD."deletedAt" IS NULL AND NEW."deletedAt" IS NOT NULL AND
     EXISTS (
       SELECT 1 FROM "zone_plant_assignments" a JOIN "zones" z ON z."id" = a."zoneId"
       WHERE z."greenhouseId" = OLD."id" AND a."status" = 'ACTIVE'
     ) THEN
    RAISE EXCEPTION 'Greenhouse containing an active plant assignment cannot be deleted';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "greenhouses_active_plant_assignment_restrict_soft_delete" BEFORE UPDATE OF "deletedAt" ON "greenhouses" FOR EACH ROW EXECUTE FUNCTION plant_greenhouse_active_assignment_restrict_soft_delete();
