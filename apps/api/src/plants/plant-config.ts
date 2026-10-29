import { createHash } from 'node:crypto';
import { Ajv2020 } from 'ajv/dist/2020.js';

export const PLANT_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';
export const PLANT_CONFIG_SCHEMA_VERSION = 'plant-config/v1';

const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });

type JsonSchema = Record<string, unknown>;

const STAGE_TEMPLATES_SCHEMA: JsonSchema = {
  $schema: PLANT_SCHEMA_DIALECT,
  type: 'array',
  items: {
    type: 'object',
    properties: {
      code: { type: 'string', minLength: 1 },
      label: { type: 'string', minLength: 1 },
      sequence: { type: 'integer', minimum: 1 },
      config: { type: 'object' },
    },
    required: ['code', 'label', 'sequence'],
    additionalProperties: false,
  },
};

const EDGE_COMPATIBILITY_SCHEMA: JsonSchema = {
  $schema: PLANT_SCHEMA_DIALECT,
  type: 'object',
  properties: {
    mode: { const: 'monitoring_only' },
    controller: { type: 'string', minLength: 1 },
    schema_version: { type: 'integer', minimum: 1 },
    actuator_commands_enabled: { const: false },
  },
  additionalProperties: false,
};

/** RFC 8785-compatible canonicalization for JSON values representable by JSON.parse/stringify. */
export function canonicalJson(value: unknown): string {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('Canonical JSON cannot contain non-finite numbers');
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError('Value is not representable as JSON');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

export function configChecksum(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

export function plantParameterDefinitionChecksum(definition: {
  parameterKey: string;
  label: string;
  dataType: string;
  unit: string | null;
  valueSchema: unknown;
  metadataSchema: unknown;
}): string {
  return configChecksum({
    parameterKey: definition.parameterKey,
    label: definition.label,
    dataType: definition.dataType,
    unit: definition.unit,
    valueSchema: definition.valueSchema,
    metadataSchema: definition.metadataSchema,
  });
}

export function assertSchema2020(schema: JsonSchema): void {
  if (schema.$schema !== PLANT_SCHEMA_DIALECT) {
    throw new Error(`Schema must declare ${PLANT_SCHEMA_DIALECT}`);
  }
  ajv.compile(schema);
}

export function validateConfig(schema: JsonSchema, value: unknown): void {
  assertSchema2020(schema);
  const validate = ajv.compile(schema);
  if (!validate(value)) {
    const details = (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
    throw new Error(`Invalid plant configuration: ${details}`);
  }
}

export function mergePlantConfig(...layers: Array<Record<string, unknown>>): Record<string, unknown> {
  const effective: Record<string, unknown> = {};
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      effective[key] = value;
    }
  }
  return effective;
}

export function buildParameterObjectSchema(
  definitions: Array<{ parameterKey: string; valueSchema: unknown; metadataSchema?: unknown }>,
  options: { partial?: boolean } = {},
): JsonSchema {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const definition of definitions) {
    const schema = definition.valueSchema;
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      throw new Error(`Parameter ${definition.parameterKey} must have a JSON Schema object`);
    }
    const metadata = definition.metadataSchema && typeof definition.metadataSchema === 'object'
      ? definition.metadataSchema as { nullable?: boolean; required?: boolean }
      : {};
    properties[definition.parameterKey] = metadata.nullable ? { anyOf: [schema, { type: 'null' }] } : schema;
    if (metadata.required) required.push(definition.parameterKey);
  }
  return {
    $schema: PLANT_SCHEMA_DIALECT,
    type: 'object',
    properties,
    ...(options.partial || required.length === 0 ? {} : { required }),
    additionalProperties: false,
  };
}

export function validatePlantLayer(layer: Record<string, unknown>, schema: JsonSchema): void {
  validateConfig(schema, layer);
}

export function validateCatalogConfiguration(
  version: { profileDefaults: unknown; stageTemplates: unknown; edgeCompatibility?: unknown },
  definitions: Array<{ parameterKey: string; valueSchema: unknown; metadataSchema?: unknown }>,
): void {
  const schema = buildParameterObjectSchema(definitions);
  const partialSchema = buildParameterObjectSchema(definitions, { partial: true });

  if (!version.profileDefaults || typeof version.profileDefaults !== 'object' || Array.isArray(version.profileDefaults)) {
    throw new Error('profileDefaults must be a JSON object');
  }
  try {
    validatePlantLayer(version.profileDefaults as Record<string, unknown>, partialSchema);
  } catch (error) {
    throw new Error(`profileDefaults: ${error instanceof Error ? error.message : 'configuration is invalid'}`);
  }

  try {
    validateConfig(STAGE_TEMPLATES_SCHEMA, version.stageTemplates);
  } catch (error) {
    throw new Error(`stageTemplates: ${error instanceof Error ? error.message : 'configuration is invalid'}`);
  }

  const templates = version.stageTemplates as Array<Record<string, unknown>>;
  const codes = new Set<string>();
  const sequences = new Set<number>();
  for (const [index, template] of templates.entries()) {
    if (codes.has(template.code as string)) throw new Error(`stageTemplates/${index}/code must be unique`);
    if (sequences.has(template.sequence as number)) throw new Error(`stageTemplates/${index}/sequence must be unique`);
    codes.add(template.code as string);
    sequences.add(template.sequence as number);
    const config = template.config ?? {};
    try {
      validatePlantLayer(config as Record<string, unknown>, partialSchema);
      validatePlantLayer(mergePlantConfig(version.profileDefaults as Record<string, unknown>, config as Record<string, unknown>), schema);
    } catch (error) {
      throw new Error(`stageTemplates/${index}/config: ${error instanceof Error ? error.message : 'configuration is invalid'}`);
    }
  }
  if (templates.length === 0) {
    try {
      validatePlantLayer(version.profileDefaults as Record<string, unknown>, schema);
    } catch (error) {
      throw new Error(`profileDefaults: ${error instanceof Error ? error.message : 'configuration is invalid'}`);
    }
  }

  if (version.edgeCompatibility === undefined || version.edgeCompatibility === null) return;
  try {
    validateConfig(EDGE_COMPATIBILITY_SCHEMA, version.edgeCompatibility);
  } catch (error) {
    throw new Error(`edgeCompatibility: ${error instanceof Error ? error.message : 'configuration is invalid'}`);
  }
}
