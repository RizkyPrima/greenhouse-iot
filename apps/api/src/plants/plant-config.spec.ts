import {
  buildParameterObjectSchema,
  configChecksum,
  validateCatalogConfiguration,
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

  it('validates catalog defaults, stage-template envelopes, stage configs, and edge compatibility independently', () => {
    const definitions = [
      { parameterKey: 'ph', valueSchema: { type: 'number', minimum: 5, maximum: 7 }, metadataSchema: { required: true } },
    ];
    const valid = {
      profileDefaults: { ph: 6 },
      stageTemplates: [{ code: 'vegetative', label: 'Vegetative', sequence: 1, config: {} }],
      edgeCompatibility: {
        mode: 'monitoring_only',
        controller: 'ESP32-S3',
        schema_version: 1,
        actuator_commands_enabled: false,
      },
    };
    expect(() => validateCatalogConfiguration(valid, definitions)).not.toThrow();
    expect(() => validateCatalogConfiguration({
      ...valid,
      profileDefaults: { ph: 6, cultivation_method: 'hydroponic_tower' },
    }, definitions)).toThrow(/profileDefaults: Invalid plant configuration/);
    expect(() => validateCatalogConfiguration({
      ...valid,
      stageTemplates: [{ code: 'vegetative', label: 'Vegetative', order: 1, config: {} }],
    }, definitions)).toThrow(/stageTemplates: Invalid plant configuration/);
    expect(() => validateCatalogConfiguration({
      ...valid,
      edgeCompatibility: { ...valid.edgeCompatibility, actuator_commands_enabled: true },
    }, definitions)).toThrow(/edgeCompatibility: Invalid plant configuration/);
    expect(() => validateCatalogConfiguration({
      ...valid,
      edgeCompatibility: { ...valid.edgeCompatibility, arbitrary: true },
    }, definitions)).toThrow(/edgeCompatibility: Invalid plant configuration/);
  });

  it('rejects duplicate stage codes and sequences without relaxing root properties', () => {
    const definitions = [{ parameterKey: 'ph', valueSchema: { type: 'number' } }];
    const template = { code: 'vegetative', label: 'Vegetative', sequence: 1, config: {} };
    expect(() => validateCatalogConfiguration({
      profileDefaults: {},
      stageTemplates: [template, { ...template, sequence: 2 }],
    }, definitions)).toThrow(/stageTemplates\/1\/code must be unique/);
    expect(() => validateCatalogConfiguration({
      profileDefaults: {},
      stageTemplates: [template, { ...template, code: 'flowering' }],
    }, definitions)).toThrow(/stageTemplates\/1\/sequence must be unique/);
  });

  it('accepts a corrected version of the stored Tomat Hidroponik Tower draft without inventing parameter values', () => {
    const storedTemplates = [
      { code: 'seedling', label: 'Bibit', sequence: 1, config: {} },
      { code: 'vegetative', label: 'Vegetatif', sequence: 2, config: {} },
      { code: 'flowering', label: 'Berbunga', sequence: 3, config: {} },
      { code: 'fruiting', label: 'Berbuah', sequence: 4, config: {} },
      { code: 'harvesting', label: 'Panen', sequence: 5, config: {} },
    ];
    expect(() => validateCatalogConfiguration({
      profileDefaults: {},
      stageTemplates: storedTemplates,
      edgeCompatibility: {
        mode: 'monitoring_only',
        controller: 'ESP32-S3',
        schema_version: 1,
        actuator_commands_enabled: false,
      },
    }, [])).not.toThrow();
    expect(() => validateCatalogConfiguration({
      profileDefaults: {
        cultivation_method: 'hydroponic_tower',
        monitoring_parameters: ['ph', 'tds', 'water_temperature', 'air_temperature', 'air_humidity'],
      },
      stageTemplates: storedTemplates.map(({ sequence, ...template }) => ({ ...template, order: sequence })),
      edgeCompatibility: {
        mode: 'monitoring_only',
        controller: 'ESP32-S3',
        schema_version: 1,
        actuator_commands_enabled: false,
      },
    }, [])).toThrow(/profileDefaults: Invalid plant configuration: .*additional properties.*additional properties/);
  });

  it('generates checksums independent of object key order', () => {
    expect(configChecksum({ a: 1, b: { c: 2 } })).toBe(configChecksum({ b: { c: 2 }, a: 1 }));
    expect(configChecksum({ a: 1 })).not.toBe(configChecksum({ a: 2 }));
  });
});
