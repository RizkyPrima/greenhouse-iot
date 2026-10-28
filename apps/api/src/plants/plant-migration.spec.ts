import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../../prisma/migrations/20261014100000_phase10_1_plant_standardization/migration.sql', import.meta.url),
  'utf8',
);

describe('Phase 10.1 catalog source migration invariant', () => {
  const functionMatch = migration.match(
    /CREATE FUNCTION plant_profile_version_schema_matches_catalog\(\) RETURNS trigger AS \$\$(.*?)\$\$ LANGUAGE plpgsql;/s,
  );
  const triggerMatch = migration.match(
    /CREATE TRIGGER "plant_profile_versions_schema_matches_source"\s+(.*?)\s+EXECUTE FUNCTION plant_profile_version_schema_matches_catalog\(\);/s,
  );

  it('validates published status and schema compatibility for inserts and relevant updates', () => {
    expect(functionMatch).not.toBeNull();
    expect(triggerMatch).not.toBeNull();

    const functionBody = functionMatch?.[1] ?? '';
    const triggerDefinition = triggerMatch?.[1] ?? '';

    expect(triggerDefinition).toContain('BEFORE INSERT OR UPDATE OF "sourceCatalogVersionId", "configSchemaVersion"');
    expect(functionBody).toContain('source_schema_version IS DISTINCT FROM NEW."configSchemaVersion"');
    expect(functionBody).toContain("source_status IS DISTINCT FROM 'PUBLISHED'");
    expect(functionBody).not.toMatch(/TG_OP\s*=\s*'INSERT'\s+AND\s+source_status/i);
  });
});

describe('Phase 10.1A.1 draft revision migration invariant', () => {
  const migration = readFileSync(
    new URL('../../prisma/migrations/20261027140000_phase10_1a_draft_revision/migration.sql', import.meta.url),
    'utf8',
  );

  it('adds a positive non-null draft revision with a compatible default', () => {
    expect(migration).toContain('ADD COLUMN "draftRevision" INTEGER NOT NULL DEFAULT 1');
    expect(migration).toContain('CHECK ("draftRevision" > 0)');
    expect(migration).not.toMatch(/DROP\s+COLUMN|UPDATE\s+"plant_profile_versions"|DELETE\s+FROM/i);
  });
});

describe('Phase 10.1B zone activation idempotency migration invariant', () => {
  const migration = readFileSync(
    new URL('../../prisma/migrations/20261028110000_phase10_1b_zone_activation_idempotency/migration.sql', import.meta.url),
    'utf8',
  );

  it('adds a tenant-scoped unique request ledger with immutable response snapshots', () => {
    expect(migration).toContain('CREATE TABLE "zone_activation_requests"');
    expect(migration).toContain('"organizationId", "operation", "idempotencyKey"');
    expect(migration).toContain('CREATE TRIGGER "zone_activation_requests_append_only"');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "zone_activation_requests"');
    expect(migration).not.toMatch(/DROP\s+TABLE|DELETE\s+FROM|TRUNCATE/i);
  });
});
