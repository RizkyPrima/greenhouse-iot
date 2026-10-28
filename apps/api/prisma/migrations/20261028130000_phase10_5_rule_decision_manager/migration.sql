-- Additive, dry-run-only rule and decision records. No actuator command is emitted.
CREATE TYPE "ZoneRuleSetStatus" AS ENUM ('DRAFT', 'APPROVED', 'RETIRED');
CREATE TYPE "ZoneDecisionStatus" AS ENUM ('DRY_RUN', 'BLOCKED', 'CONFLICT');
CREATE TYPE "ZoneCommandStatus" AS ENUM ('NOT_SENT', 'SENT', 'ACKNOWLEDGED', 'TIMEOUT', 'FAILED');

CREATE TABLE "zone_rule_sets" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "plantProfileVersionId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "ZoneRuleSetStatus" NOT NULL DEFAULT 'DRAFT',
  "definition" JSONB NOT NULL,
  "checksum" VARCHAR(64) NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "approvedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMP(3),
  CONSTRAINT "zone_rule_sets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "zone_rule_sets_version_check" CHECK ("version" > 0),
  CONSTRAINT "zone_rule_sets_checksum_check" CHECK ("checksum" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "zone_rule_sets_approval_check" CHECK (("status" = 'APPROVED') = ("approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL)),
  CONSTRAINT "zone_rule_sets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "zone_rule_sets_profileVersion_org_fkey" FOREIGN KEY ("plantProfileVersionId", "organizationId") REFERENCES "plant_profile_versions"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "zone_rule_sets_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "zone_rule_sets_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "zone_rule_sets_profileVersion_version_key" ON "zone_rule_sets"("plantProfileVersionId", "version");
CREATE UNIQUE INDEX "zone_rule_sets_id_organizationId_key" ON "zone_rule_sets"("id", "organizationId");
CREATE INDEX "zone_rule_sets_organizationId_status_createdAt_idx" ON "zone_rule_sets"("organizationId", "status", "createdAt");

CREATE TABLE "zone_decisions" (
  "id" TEXT NOT NULL,
  "decisionKey" VARCHAR(64) NOT NULL,
  "organizationId" TEXT NOT NULL,
  "zoneId" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "plantProfileVersionId" TEXT NOT NULL,
  "ruleSetId" TEXT NOT NULL,
  "deviceMqttId" TEXT NOT NULL,
  "telemetryAt" TIMESTAMP(3) NOT NULL,
  "status" "ZoneDecisionStatus" NOT NULL,
  "commandStatus" "ZoneCommandStatus" NOT NULL DEFAULT 'NOT_SENT',
  "candidates" JSONB NOT NULL,
  "selected" JSONB,
  "reasons" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "zone_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "zone_decisions_key_check" CHECK ("decisionKey" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "zone_decisions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "zone_decisions_ruleSet_org_fkey" FOREIGN KEY ("ruleSetId", "organizationId") REFERENCES "zone_rule_sets"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "zone_decisions_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "zone_decisions_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "zone_plant_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "zone_decisions_profileVersion_org_fkey" FOREIGN KEY ("plantProfileVersionId", "organizationId") REFERENCES "plant_profile_versions"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "zone_decisions_deviceMqttId_fkey" FOREIGN KEY ("deviceMqttId") REFERENCES "devices"("deviceId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "zone_decisions_decisionKey_key" ON "zone_decisions"("decisionKey");
CREATE INDEX "zone_decisions_organizationId_zoneId_createdAt_idx" ON "zone_decisions"("organizationId", "zoneId", "createdAt");
CREATE INDEX "zone_decisions_assignmentId_createdAt_idx" ON "zone_decisions"("assignmentId", "createdAt");

CREATE TABLE "zone_decision_feedback" (
  "id" TEXT NOT NULL,
  "decisionId" TEXT NOT NULL,
  "feedback" TEXT NOT NULL,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "zone_decision_feedback_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "zone_decision_feedback_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "zone_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "zone_decision_feedback_decisionId_createdAt_idx" ON "zone_decision_feedback"("decisionId", "createdAt");

CREATE FUNCTION zone_decisions_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Zone decisions and feedback are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "zone_decisions_append_only" BEFORE UPDATE OR DELETE ON "zone_decisions" FOR EACH ROW EXECUTE FUNCTION zone_decisions_append_only();
CREATE TRIGGER "zone_decision_feedback_append_only" BEFORE UPDATE OR DELETE ON "zone_decision_feedback" FOR EACH ROW EXECUTE FUNCTION zone_decisions_append_only();

CREATE FUNCTION zone_rule_sets_immutable_snapshot() RETURNS trigger AS $$
BEGIN
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
CREATE TRIGGER "zone_rule_sets_immutable_snapshot" BEFORE UPDATE OR DELETE ON "zone_rule_sets" FOR EACH ROW EXECUTE FUNCTION zone_rule_sets_immutable_snapshot();
