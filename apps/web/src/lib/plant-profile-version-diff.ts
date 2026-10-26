import type { GrowthStage, PlantProfileVersion } from '@/types';

export type VersionDiffKind = 'added' | 'removed' | 'changed' | 'invalid';
export type VersionDiffEntry = {
  section: 'Profile configuration' | 'Growth stages';
  path: string;
  kind: VersionDiffKind;
  before: unknown;
  after: unknown;
};

export type ComparableProfileVersion = Pick<PlantProfileVersion, 'version'> & {
  profileConfig?: unknown;
  growthStages?: unknown;
};

const MISSING = Symbol('missing');
type Value = unknown | typeof MISSING;
const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function equal(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => equal(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && equal(left[key], right[key]));
}

function flatten(value: Record<string, unknown>, prefix = ''): Map<string, unknown> {
  const result = new Map<string, unknown>();
  const entries = Object.entries(value).sort(([left], [right]) => compareText(left, right));
  if (entries.length === 0 && prefix) result.set(prefix, {});
  for (const [key, nested] of entries) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isRecord(nested)) {
      const flattened = flatten(nested, path);
      for (const [nestedPath, nestedValue] of flattened) result.set(nestedPath, nestedValue);
    } else {
      result.set(path, nested);
    }
  }
  return result;
}

function describe(section: VersionDiffEntry['section'], path: string, before: Value, after: Value): VersionDiffEntry {
  const kind: VersionDiffKind = before === MISSING ? 'added' : after === MISSING ? 'removed' : 'changed';
  return {
    section,
    path,
    kind,
    before: before === MISSING ? undefined : before,
    after: after === MISSING ? undefined : after,
  };
}

function invalid(section: VersionDiffEntry['section'], path: string, before: unknown, after: unknown): VersionDiffEntry {
  return { section, path, kind: 'invalid', before, after };
}

function diffObjects(
  section: VersionDiffEntry['section'],
  path: string,
  before: unknown,
  after: unknown,
): VersionDiffEntry[] {
  if (!isRecord(before) || !isRecord(after)) {
    return [invalid(section, path, isRecord(before) ? before : 'Data missing/invalid', isRecord(after) ? after : 'Data missing/invalid')];
  }
  const left = flatten(before);
  const right = flatten(after);
  const paths = [...new Set([...left.keys(), ...right.keys()])].sort(compareText);
  return paths.flatMap((fieldPath) => {
    const oldValue = left.has(fieldPath) ? left.get(fieldPath)! : MISSING;
    const newValue = right.has(fieldPath) ? right.get(fieldPath)! : MISSING;
    if (oldValue !== MISSING && newValue !== MISSING && equal(oldValue, newValue)) return [];
    return [describe(section, path ? `${path}.${fieldPath}` : fieldPath, oldValue, newValue)];
  });
}

function readStages(value: unknown): { stages: Map<string, GrowthStage>; invalidEntries: VersionDiffEntry[] } {
  const invalidEntries: VersionDiffEntry[] = [];
  const stages = new Map<string, GrowthStage>();
  if (!Array.isArray(value)) {
    invalidEntries.push(invalid('Growth stages', 'growthStages', 'Data missing/invalid', 'Data missing/invalid'));
    return { stages, invalidEntries };
  }

  const counts = new Map<string, number>();
  for (const candidate of value) {
    if (!isRecord(candidate) || typeof candidate.code !== 'string' || candidate.code.trim() === '') continue;
    const code = candidate.code.trim();
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }

  const reportedDuplicateCodes = new Set<string>();
  value.forEach((candidate, index) => {
    if (!isRecord(candidate)) {
      invalidEntries.push(invalid('Growth stages', `growthStages[${index}]`, candidate, 'Stage data invalid'));
      return;
    }
    if (typeof candidate.code !== 'string' || candidate.code.trim() === '') {
      invalidEntries.push(invalid('Growth stages', `growthStages[${index}].code`, candidate.code, 'Stage code missing/invalid'));
      return;
    }
    const code = candidate.code.trim();
    if ((counts.get(code) ?? 0) > 1) {
      if (!reportedDuplicateCodes.has(code)) {
        invalidEntries.push(invalid('Growth stages', `growthStages[code=${JSON.stringify(code)}]`, 'Duplicate code', 'Duplicate code'));
        reportedDuplicateCodes.add(code);
      }
      return;
    }

    const stagePath = `growthStages[code=${JSON.stringify(code)}]`;
    if (typeof candidate.label !== 'string' || candidate.label.trim() === '') {
      invalidEntries.push(invalid('Growth stages', `${stagePath}.label`, candidate.label ?? 'Data missing/invalid', 'Expected non-empty string'));
    }
    if (typeof candidate.sequence !== 'number' || !Number.isInteger(candidate.sequence)) {
      invalidEntries.push(invalid('Growth stages', `${stagePath}.sequence`, candidate.sequence ?? 'Data missing/invalid', 'Expected integer'));
    }
    for (const field of ['minDurationDays', 'maxDurationDays']) {
      const duration = candidate[field];
      if (duration !== null && (typeof duration !== 'number' || !Number.isFinite(duration))) {
        invalidEntries.push(invalid('Growth stages', `${stagePath}.${field}`, duration ?? 'Data missing/invalid', 'Expected number or null'));
      }
    }
    if (candidate.transitionCriteria !== null && !isRecord(candidate.transitionCriteria)) {
      invalidEntries.push(invalid('Growth stages', `${stagePath}.transitionCriteria`, candidate.transitionCriteria ?? 'Data missing/invalid', 'Expected object or null'));
    }
    if (!isRecord(candidate.parameterConfig) || !isRecord(candidate.parameterConfig.config)) {
      invalidEntries.push(invalid('Growth stages', `${stagePath}.parameterConfig.config`, 'Data missing/invalid', 'Data missing/invalid'));
    }
    stages.set(code, candidate as unknown as GrowthStage);
  });
  return { stages, invalidEntries };
}

function stageFields(stage: GrowthStage): Record<string, unknown> {
  const config = isRecord(stage.parameterConfig) ? stage.parameterConfig.config : undefined;
  return {
    code: stage.code,
    label: stage.label,
    sequence: stage.sequence,
    minDurationDays: stage.minDurationDays,
    maxDurationDays: stage.maxDurationDays,
    transitionCriteria: stage.transitionCriteria,
    parameterConfig: { config },
  };
}

export function diffPlantProfileVersions(before: ComparableProfileVersion, after: ComparableProfileVersion): VersionDiffEntry[] {
  const entries = diffObjects('Profile configuration', 'profileConfig', before.profileConfig, after.profileConfig);
  const left = readStages(before.growthStages);
  const right = readStages(after.growthStages);
  entries.push(...left.invalidEntries, ...right.invalidEntries);

  const codes = [...new Set([...left.stages.keys(), ...right.stages.keys()])].sort(compareText);
  for (const code of codes) {
    const oldStage = left.stages.get(code);
    const newStage = right.stages.get(code);
    if (!oldStage || !newStage) {
      entries.push(describe('Growth stages', `growthStages[code=${JSON.stringify(code)}]`, oldStage ?? MISSING, newStage ?? MISSING));
      continue;
    }
    const stagePath = `growthStages[code=${JSON.stringify(code)}]`;
    const changes = diffObjects('Growth stages', stagePath, stageFields(oldStage), stageFields(newStage));
    entries.push(...changes);
  }

  return entries.sort((a, b) => compareText(a.section, b.section) || compareText(a.path, b.path) || compareText(a.kind, b.kind));
}
