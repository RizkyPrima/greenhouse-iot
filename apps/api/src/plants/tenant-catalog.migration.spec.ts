import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../../prisma/migrations/20261016100000_tenant_plant_catalog/migration.sql', import.meta.url),
  'utf8',
);

describe('tenant catalog migration invariants', () => {
  it('preserves legacy rows while adding organization ownership and scoped uniqueness', () => {
    expect(migration).toContain('ADD COLUMN "organizationId" TEXT');
    expect(migration).toContain('"organizationId", "code"');
    expect(migration).toContain('WHERE "organizationId" IS NULL');
    expect(migration).toContain('REFERENCES "organizations"("id")');
    expect(migration).toContain('CREATE TRIGGER "plant_profiles_catalog_matches_organization"');
    expect(migration).toContain('catalog_organization_id <> NEW."organizationId"');
    expect(migration).not.toMatch(/UPDATE\s+"plant_catalogs"/i);
    expect(migration).not.toMatch(/DELETE\s+FROM\s+"plant_catalogs"/i);
  });
});
