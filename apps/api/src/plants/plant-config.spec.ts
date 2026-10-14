import {
  buildParameterObjectSchema,
  configChecksum,
  mergePlantConfig,
  PLANT_SCHEMA_DIALECT,
  validateConfig,
} from './plant-config.js';

describe('plant configuration', () => {
  const schema = buildParameterObjectSchema([
    { parameterKey: 'ph', valueSchema: { type: 'number', minimum: 5, maximum: 7 } },
    { parameterKey: 'mode', valueSchema: { enum: ['manual', 'automatic'] } },
  ]);

  it('validates against JSON Schema Draft 2020-12 and rejects unknown keys and boundaries', () => {
    expect(() => validateConfig(schema, { ph: 6, mode: 'manual' })).not.toThrow();
    expect(() => validateConfig(schema, { ph: 8 })).toThrow(/Invalid plant configuration/);
    expect(() => validateConfig(schema, { unknown: 1 })).toThrow(/Invalid plant configuration/);
  });

  it('requires parameter schemas to explicitly use Draft 2020-12', () => {
    expect(() => validateConfig({ $schema: 'http://json-schema.org/draft-07/schema#', type: 'object' }, {})).toThrow(
      PLANT_SCHEMA_DIALECT,
    );
  });

  it('merges by parameter key in profile, stage, zone order and rejects null', () => {
    expect(mergePlantConfig({ ph: 6, ec: 1 }, { ph: 6.2 }, { ec: 1.2 })).toEqual({ ph: 6.2, ec: 1.2 });
    expect(() => validateConfig(schema, { ph: null })).toThrow(/Invalid plant configuration/);
  });

  it('generates checksums independent of object key order', () => {
    expect(configChecksum({ a: 1, b: { c: 2 } })).toBe(configChecksum({ b: { c: 2 }, a: 1 }));
    expect(configChecksum({ a: 1 })).not.toBe(configChecksum({ a: 2 }));
  });
});
