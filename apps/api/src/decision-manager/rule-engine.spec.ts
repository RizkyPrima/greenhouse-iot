import { evaluateRules, type RuleCandidate, type RuleSetDefinition } from './rule-engine.js';
import { resolveDecision } from './decision-manager.js';

const definition: RuleSetDefinition = {
  maxTelemetryAgeMs: 10_000,
  rules: [{ id: 'climate-high', domain: 'climate', enabled: true, priority: 10, conditions: [{ sensorCode: 'air_temp', parameterKey: 'air_temperature', operator: 'GT' }], action: { actuatorCode: 'fan', command: 'ON' } }],
};

describe('Phase 10.5 pure rule evaluation', () => {
  it('evaluates a fresh telemetry condition into an explained candidate', () => {
    const result = evaluateRules(definition, { deviceMqttId: 'ctrl-1', telemetryAt: new Date(1000).toISOString(), standardParameters: { air_temperature: { value: 20, unit: 'C' } }, sensors: { air_temp: { value: 21, unit: 'C', timestamp: new Date(1000).toISOString() } } }, 2000);
    expect(result.status).toBe('EVALUATED');
    expect(result.candidates[0]).toMatchObject({ id: 'climate-high', explanation: 'air_temp GT 20 C (Plant Standard air_temperature)', sourceTelemetryAt: new Date(1000).toISOString() });
  });

  it('blocks stale or incomplete inputs before evaluating any rule', () => {
    expect(evaluateRules(definition, { deviceMqttId: 'ctrl-1', telemetryAt: new Date(1000).toISOString(), standardParameters: { air_temperature: { value: 20, unit: 'C' } }, sensors: {} }, 2000).status).toBe('BLOCKED');
    expect(evaluateRules(definition, { deviceMqttId: 'ctrl-1', telemetryAt: new Date(1000).toISOString(), standardParameters: { air_temperature: { value: 20, unit: 'C' } }, sensors: { air_temp: { value: 21, unit: 'C', timestamp: new Date(1000).toISOString() } } }, 20_000).reasons).toContain('TELEMETRY_STALE');
    expect(evaluateRules(definition, { deviceMqttId: 'ctrl-1', telemetryAt: new Date(1000).toISOString(), standardParameters: {}, sensors: { air_temp: { value: 21, unit: 'C', timestamp: new Date(1000).toISOString() } } }, 2000).reasons[0]).toContain('PLANT_STANDARD_VALUE_MISSING');
    expect(evaluateRules(definition, { deviceMqttId: 'ctrl-1', telemetryAt: new Date(1000).toISOString(), standardParameters: { air_temperature: { value: 20, unit: 'F' } }, sensors: { air_temp: { value: 21, unit: 'C', timestamp: new Date(1000).toISOString() } } }, 2000).reasons[0]).toContain('SENSOR_UNIT_MISMATCH');
  });

  it('requires explicit online/manual-stop/actuator safety state and blocks critical class conflicts', () => {
    const candidate: RuleCandidate = { ...definition.rules[0], sourceTelemetryAt: new Date(1000).toISOString(), explanation: 'fixture' };
    expect(resolveDecision([candidate], { deviceOnline: true, manualStop: null, enabledActuatorCodes: ['fan'] }).status).toBe('BLOCKED');
    const safety = { ...candidate, id: 'safety-off', domain: 'safety' as const, action: { actuatorCode: 'fan', command: 'OFF' as const } };
    const emergency = { ...candidate, domain: 'emergency' as const };
    expect(resolveDecision([safety, emergency], { deviceOnline: true, manualStop: false, enabledActuatorCodes: ['fan'] })).toMatchObject({ status: 'CONFLICT', selected: null, reasons: ['EMERGENCY_SAFETY_CONFLICT:fan'] });
    expect(resolveDecision([candidate, safety], { deviceOnline: true, manualStop: false, enabledActuatorCodes: ['fan'] })).toMatchObject({ status: 'DRY_RUN', selected: { id: 'safety-off' } });
  });
});
