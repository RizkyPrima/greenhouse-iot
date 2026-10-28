import type { RuleCandidate } from './rule-engine.js';

export type EvaluationOutcome = 'DRY_RUN' | 'BLOCKED' | 'CONFLICT';
export interface DecisionResult {
  status: EvaluationOutcome;
  selected: RuleCandidate | null;
  reasons: string[];
}
export interface SafetyContext {
  deviceOnline: boolean;
  manualStop: boolean | null;
  enabledActuatorCodes: string[];
}

const DOMAIN_RANK: Record<RuleCandidate['domain'], number> = {
  emergency: 700,
  safety: 600,
  climate: 500,
  irrigation: 500,
  fan: 500,
  valve: 500,
  fertigation: 500,
};

/** Emergency/safety are fixed classes; ordinary rule priority only arbitrates within its class. */
export function resolveDecision(candidates: RuleCandidate[], safety: SafetyContext): DecisionResult {
  if (!candidates.length) return { status: 'DRY_RUN', selected: null, reasons: ['NO_ACTION_CANDIDATE'] };
  if (!safety.deviceOnline) return { status: 'BLOCKED', selected: null, reasons: ['DEVICE_OFFLINE'] };
  if (safety.manualStop !== false) return { status: 'BLOCKED', selected: null, reasons: ['MANUAL_STOP_STATE_UNKNOWN_OR_ACTIVE'] };
  const unavailable = candidates.find((candidate) => !safety.enabledActuatorCodes.includes(candidate.action.actuatorCode));
  if (unavailable) return { status: 'BLOCKED', selected: null, reasons: [`ACTUATOR_UNAVAILABLE:${unavailable.action.actuatorCode}`] };

  const targets = new Set(candidates.map((candidate) => candidate.action.actuatorCode));
  const eligible: RuleCandidate[] = [];
  for (const target of targets) {
    const forTarget = candidates.filter((candidate) => candidate.action.actuatorCode === target);
    const criticalClasses = new Set(forTarget.filter(({ domain }) => domain === 'emergency' || domain === 'safety').map(({ domain }) => domain));
    if (criticalClasses.has('emergency') && criticalClasses.has('safety')) {
      return { status: 'CONFLICT', selected: null, reasons: [`EMERGENCY_SAFETY_CONFLICT:${target}`] };
    }
    const rank = Math.max(...forTarget.map((candidate) => DOMAIN_RANK[candidate.domain] + (candidate.domain === 'emergency' || candidate.domain === 'safety' ? 0 : candidate.priority)));
    const top = forTarget.filter((candidate) => DOMAIN_RANK[candidate.domain] + (candidate.domain === 'emergency' || candidate.domain === 'safety' ? 0 : candidate.priority) === rank);
    if (new Set(top.map(({ action }) => action.command)).size > 1) {
      return { status: 'CONFLICT', selected: null, reasons: [`EQUAL_PRIORITY_CONFLICT:${target}`] };
    }
    eligible.push(top[0]);
  }
  if (eligible.length > 1) return { status: 'CONFLICT', selected: null, reasons: ['MULTIPLE_ACTUATOR_ACTIONS_REQUIRE_SEPARATE_DECISIONS'] };
  return { status: 'DRY_RUN', selected: eligible[0], reasons: ['DRY_RUN_ONLY_NO_ACTUATOR_COMMAND_SENT'] };
}

export interface ActuatorCommandAdapter {
  readonly mode: 'DISABLED';
  submit(): Promise<{
    status: 'NOT_SENT' | 'SENT' | 'ACKNOWLEDGED' | 'TIMEOUT' | 'FAILED';
    commandId?: string;
    reason?: string;
    acknowledgedAt?: string;
  }>;
}

export class DisabledActuatorCommandAdapter implements ActuatorCommandAdapter {
  readonly mode = 'DISABLED' as const;
  async submit() {
    return { status: 'NOT_SENT' as const, reason: 'PHYSICAL_ACTUATION_NOT_CONFIGURED' as const };
  }
}
