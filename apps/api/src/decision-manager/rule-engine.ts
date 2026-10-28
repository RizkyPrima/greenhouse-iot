export const RULE_DOMAINS = ['irrigation', 'fan', 'valve', 'fertigation', 'climate', 'safety', 'emergency'] as const;
export type RuleDomain = typeof RULE_DOMAINS[number];
export type Comparison = 'GT' | 'GTE' | 'LT' | 'LTE' | 'EQ' | 'NE';

export interface RuleCondition {
  sensorCode: string;
  parameterKey: string;
  operator: Comparison;
}

export interface RuleDefinition {
  id: string;
  domain: RuleDomain;
  enabled: boolean;
  priority: number;
  conditions: RuleCondition[];
  action: { actuatorCode: string; command: 'ON' | 'OFF' };
}

export interface RuleSetDefinition {
  maxTelemetryAgeMs: number;
  rules: RuleDefinition[];
}

export interface RuleTelemetry {
  deviceMqttId: string;
  telemetryAt: string;
  sequence?: number;
  sensors: Record<string, { value: number; unit: string | null; timestamp: string }>;
  standardParameters: Record<string, { value: number; unit: string | null }>;
}

export interface RuleCandidate extends RuleDefinition {
  sourceTelemetryAt: string;
  explanation: string;
}

export interface RuleEvaluation {
  status: 'EVALUATED' | 'BLOCKED';
  candidates: RuleCandidate[];
  reasons: string[];
}

function test(value: number, operator: Comparison, bound: number): boolean {
  switch (operator) {
    case 'GT': return value > bound;
    case 'GTE': return value >= bound;
    case 'LT': return value < bound;
    case 'LTE': return value <= bound;
    case 'EQ': return value === bound;
    case 'NE': return value !== bound;
  }
}

export function evaluateRules(definition: RuleSetDefinition, telemetry: RuleTelemetry, now = Date.now()): RuleEvaluation {
  const telemetryTime = Date.parse(telemetry.telemetryAt);
  if (!Number.isFinite(telemetryTime) || telemetryTime > now || !Number.isInteger(definition.maxTelemetryAgeMs) || definition.maxTelemetryAgeMs <= 0) {
    return { status: 'BLOCKED', candidates: [], reasons: ['TELEMETRY_TIMESTAMP_OR_FRESHNESS_POLICY_INVALID'] };
  }
  if (now - telemetryTime > definition.maxTelemetryAgeMs) {
    return { status: 'BLOCKED', candidates: [], reasons: ['TELEMETRY_STALE'] };
  }
  const enabled = definition.rules.filter((rule) => rule.enabled);
  const requiredCodes = new Set(enabled.flatMap((rule) => rule.conditions.map((condition) => condition.sensorCode)));
  const requiredParameters = new Set(enabled.flatMap((rule) => rule.conditions.map((condition) => condition.parameterKey)));
  for (const parameterKey of requiredParameters) {
    const standard = telemetry.standardParameters[parameterKey];
    if (!standard || !Number.isFinite(standard.value)) return { status: 'BLOCKED', candidates: [], reasons: [`PLANT_STANDARD_VALUE_MISSING_OR_INVALID:${parameterKey}`] };
  }
  const values = new Map<string, { value: number; unit: string | null; timestamp: number }>();
  for (const code of requiredCodes) {
    const sensor = telemetry.sensors[code];
    const timestamp = Date.parse(sensor?.timestamp ?? '');
    if (!sensor || !Number.isFinite(sensor.value) || !Number.isFinite(timestamp) || timestamp > now || now - timestamp > definition.maxTelemetryAgeMs) {
      return { status: 'BLOCKED', candidates: [], reasons: [`SENSOR_MISSING_INVALID_OR_STALE:${code}`] };
    }
    values.set(code, { value: sensor.value, unit: sensor.unit, timestamp });
  }
  for (const rule of enabled) {
    for (const condition of rule.conditions) {
      if (telemetry.standardParameters[condition.parameterKey].unit !== values.get(condition.sensorCode)?.unit) {
        return { status: 'BLOCKED', candidates: [], reasons: [`SENSOR_UNIT_MISMATCH:${condition.sensorCode}:${condition.parameterKey}`] };
      }
    }
  }

  const candidates: RuleCandidate[] = [];
  for (const rule of enabled) {
    if (rule.conditions.length === 0) continue;
    const matching = rule.conditions.every((condition) => {
      const reading = values.get(condition.sensorCode)!;
      const standard = telemetry.standardParameters[condition.parameterKey];
      return test(reading.value, condition.operator, standard.value);
    });
    if (matching) candidates.push({ ...rule, sourceTelemetryAt: telemetry.telemetryAt, explanation: rule.conditions.map((condition) => `${condition.sensorCode} ${condition.operator} ${telemetry.standardParameters[condition.parameterKey].value} ${telemetry.standardParameters[condition.parameterKey].unit ?? ''} (Plant Standard ${condition.parameterKey})`).join(' AND ') });
  }
  return { status: 'EVALUATED', candidates, reasons: candidates.length ? [] : ['NO_RULE_MATCHED'] };
}
