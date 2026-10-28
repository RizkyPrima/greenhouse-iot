-- RenameIndex
ALTER INDEX "growth_stages_id_version_key" RENAME TO "growth_stages_id_plantProfileVersionId_key";

-- RenameIndex
ALTER INDEX "growth_stages_version_code_key" RENAME TO "growth_stages_plantProfileVersionId_code_key";

-- RenameIndex
ALTER INDEX "growth_stages_version_sequence_key" RENAME TO "growth_stages_plantProfileVersionId_sequence_key";

-- RenameIndex
ALTER INDEX "plant_config_audit_events_actor_created_idx" RENAME TO "plant_config_audit_events_actorUserId_createdAt_idx";

-- RenameIndex
ALTER INDEX "plant_config_audit_events_entity_created_idx" RENAME TO "plant_config_audit_events_entityType_entityId_createdAt_idx";

-- RenameIndex
ALTER INDEX "plant_config_audit_events_org_created_idx" RENAME TO "plant_config_audit_events_organizationId_createdAt_idx";

-- RenameIndex
ALTER INDEX "plant_parameter_definitions_version_idx" RENAME TO "plant_parameter_definitions_plantCatalogVersionId_idx";

-- RenameIndex
ALTER INDEX "plant_parameter_definitions_version_key_key" RENAME TO "plant_parameter_definitions_plantCatalogVersionId_parameter_key";

-- RenameIndex
ALTER INDEX "plant_profile_versions_id_org_key" RENAME TO "plant_profile_versions_id_organizationId_key";

-- RenameIndex
ALTER INDEX "plant_profile_versions_id_profile_key" RENAME TO "plant_profile_versions_id_plantProfileId_key";

-- RenameIndex
ALTER INDEX "plant_profile_versions_org_status_idx" RENAME TO "plant_profile_versions_organizationId_status_idx";

-- RenameIndex
ALTER INDEX "plant_profile_versions_profile_version_key" RENAME TO "plant_profile_versions_plantProfileId_version_key";

-- RenameIndex
ALTER INDEX "plant_scientific_evidence_organizationId_verificationStatus_cre" RENAME TO "plant_scientific_evidence_organizationId_verificationStatus_idx";

-- RenameIndex
ALTER INDEX "research_sources_alternateIdentifierType_alternateIdentifier_ke" RENAME TO "research_sources_alternateIdentifierType_alternateIdentifie_key";

-- RenameIndex
ALTER INDEX "zone_parameter_overrides_assignment_revision_key" RENAME TO "zone_parameter_overrides_assignmentId_revision_key";

-- RenameIndex
ALTER INDEX "zone_parameter_overrides_assignment_superseded_idx" RENAME TO "zone_parameter_overrides_assignmentId_supersededAt_idx";

-- RenameIndex
ALTER INDEX "zone_plant_assignments_org_zone_status_idx" RENAME TO "zone_plant_assignments_organizationId_zoneId_status_idx";

-- RenameIndex
ALTER INDEX "zone_plant_assignments_profile_version_idx" RENAME TO "zone_plant_assignments_plantProfileVersionId_idx";
