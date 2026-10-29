CREATE OR REPLACE FUNCTION plant_cascade_delete_is_enabled() RETURNS BOOLEAN AS $$
BEGIN
  RETURN current_setting('app.allow_plant_cascade_delete', true) = 'on';
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION plant_reject_published_catalog_version_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND plant_cascade_delete_is_enabled() THEN
    RETURN OLD;
  END IF;
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

CREATE OR REPLACE FUNCTION plant_parameter_definition_requires_draft() RETURNS trigger AS $$
DECLARE
  version_id TEXT;
  version_status "PlantVersionStatus";
BEGIN
  IF TG_OP = 'DELETE' AND plant_cascade_delete_is_enabled() THEN
    RETURN OLD;
  END IF;
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

CREATE OR REPLACE FUNCTION plant_reject_validated_profile_version_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND plant_cascade_delete_is_enabled() THEN
    RETURN OLD;
  END IF;
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

CREATE OR REPLACE FUNCTION plant_growth_stage_requires_draft() RETURNS trigger AS $$
DECLARE
  version_id TEXT;
  version_status "PlantProfileVersionStatus";
BEGIN
  IF TG_OP = 'DELETE' AND plant_cascade_delete_is_enabled() THEN
    RETURN OLD;
  END IF;
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

CREATE OR REPLACE FUNCTION plant_stage_config_requires_draft() RETURNS trigger AS $$
DECLARE
  stage_id TEXT;
  version_status "PlantProfileVersionStatus";
BEGIN
  IF TG_OP = 'DELETE' AND plant_cascade_delete_is_enabled() THEN
    RETURN OLD;
  END IF;
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

CREATE OR REPLACE FUNCTION plant_assignment_version_must_be_validated() RETURNS trigger AS $$
DECLARE profile_status "PlantProfileVersionStatus";
BEGIN
  IF TG_OP = 'DELETE' AND plant_cascade_delete_is_enabled() THEN
    RETURN OLD;
  END IF;
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

CREATE OR REPLACE FUNCTION plant_zone_override_schema_matches_assignment() RETURNS trigger AS $$
DECLARE expected_schema_version TEXT;
BEGIN
  IF TG_OP = 'DELETE' AND plant_cascade_delete_is_enabled() THEN
    RETURN OLD;
  END IF;
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

CREATE OR REPLACE FUNCTION zone_decisions_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND plant_cascade_delete_is_enabled() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Zone decisions and feedback are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION zone_rule_sets_immutable_snapshot() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND plant_cascade_delete_is_enabled() THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Rule set snapshots are immutable; create a new version';
  END IF;
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
    OR NEW."plantProfileVersionId" IS DISTINCT FROM OLD."plantProfileVersionId"
    OR NEW."version" IS DISTINCT FROM OLD."version"
    OR NEW."definition" IS DISTINCT FROM OLD."definition"
    OR NEW."checksum" IS DISTINCT FROM OLD."checksum"
    OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
    OR OLD."status" <> 'DRAFT'
    OR NEW."status" NOT IN ('APPROVED', 'RETIRED') THEN
    RAISE EXCEPTION 'Rule set snapshots are immutable; create a new version';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
