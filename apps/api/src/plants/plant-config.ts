import { createHash } from 'node:crypto';
import { Ajv2020 } from 'ajv/dist/2020.js';

export const PLANT_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';
export const PLANT_CONFIG_SCHEMA_VERSION = 'plant-config/v1';

const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });

type JsonSchema = Record<string, unknown>;

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
