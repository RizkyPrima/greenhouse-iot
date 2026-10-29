import { PlantProfileVersionStatus, PlantVersionStatus, ScientificEvidenceVerificationStatus, UserRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PlantAiRecommendationService } from './plant-ai-recommendation.service.js';

const actor = { id: 'user-a' } as AuthenticatedUser;

function harness(evidence: unknown[] = [], configuredProvider = false, parameterDefinitions = [{
  parameterKey: 'air_temperature', label: 'Air temperature', dataType: 'number', unit: '°C',
  valueSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'number' },
}]) {
  const prisma = {
    plantProfileVersion: { findFirst: vi.fn().mockResolvedValue({
      id: 'profile-version-a', organizationId: 'org-a', status: PlantProfileVersionStatus.VALIDATED,
      plantProfile: { plantCatalog: { id: 'catalog-a', scientificName: 'Solanum lycopersicum', commonName: 'tomato' } },
      sourceCatalogVersion: { status: PlantVersionStatus.PUBLISHED, profileDefaults: { air_temperature: 21 }, stageTemplates: [{ code: 'vegetative', label: 'Vegetative', sequence: 1, config: { air_temperature: 22 } }], edgeCompatibility: {}, parameterDefinitions },
      growthStages: [{ id: 'stage-a', code: 'vegetative', label: 'Vegetative', parameterConfig: { config: {} } }],
    }) },
    plantScientificEvidence: { findMany: vi.fn().mockResolvedValue(evidence) },
  };
  const authorization = { requireRole: vi.fn().mockResolvedValue({ role: UserRole.OWNER }) };
  const proposals = { create: vi.fn().mockResolvedValue({ id: 'proposal-a' }) };
  const provider = { isConfigured: vi.fn().mockReturnValue(configuredProvider), getName: vi.fn().mockReturnValue('test-provider'), getModel: vi.fn().mockReturnValue('test-model'), generateJson: vi.fn(), generateJsonWithMetadata: vi.fn() };
  provider.generateJsonWithMetadata.mockImplementation(async (input, schema) => ({
    output: await provider.generateJson(input, schema),
    provider: { name: 'actual-provider', model: 'actual-model' },
  }));
  const service = new PlantAiRecommendationService(prisma as never, authorization as never, proposals as never, provider as never);
  return { service, prisma, authorization, proposals, provider };
}

describe('PlantAiRecommendationService', () => {
  it('reports insufficient evidence without calling a provider or creating a proposal', async () => {
    const h = harness();
    const result = await h.service.recommend('org-a', 'profile-a', 'profile-version-a', 'stage-a', actor);
    expect(result.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.proposal).toBeNull();
    expect(h.proposals.create).not.toHaveBeenCalled();
    expect(h.provider.generateJson).not.toHaveBeenCalled();
    expect(h.authorization.requireRole).toHaveBeenCalledWith('user-a', 'org-a', [UserRole.OWNER, UserRole.ADMIN]);
  });

  it('only retrieves organization records and verified global records and requires a validated profile version', async () => {
    const h = harness();
    await h.service.recommend('org-a', 'profile-a', 'profile-version-a', 'stage-a', actor);
    expect(h.prisma.plantProfileVersion.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: PlantProfileVersionStatus.VALIDATED, organizationId: 'org-a' }),
    }));
    expect(h.prisma.plantScientificEvidence.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [
          { organizationId: 'org-a' },
          { organizationId: null, verificationStatus: ScientificEvidenceVerificationStatus.VERIFIED },
        ],
      }),
    }));
  });

  it('explains that a pinned published standard with zero parameters cannot produce a proposal', async () => {
    const h = harness([], true, []);
    const result = await h.service.recommend('org-a', 'profile-a', 'profile-version-a', 'stage-a', actor);
    expect(result.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.findings[0]).toMatchObject({ code: 'NO_PUBLISHED_PARAMETERS' });
    expect(result.findings[0].explanation).toContain('create and validate a profile version');
    expect(h.prisma.plantScientificEvidence.findMany).not.toHaveBeenCalled();
    expect(h.provider.generateJson).not.toHaveBeenCalled();
    expect(h.proposals.create).not.toHaveBeenCalled();
  });

  it('reports the exact unit mismatch instead of sending mismatched evidence to the provider', async () => {
    const h = harness([{
      id: 'mismatched-unit-evidence', verificationStatus: ScientificEvidenceVerificationStatus.VERIFIED,
      contract: {
        crop: { state: 'VALUE', value: 'Solanum lycopersicum' },
        cultivar: { state: 'UNKNOWN' }, growthStage: { state: 'VALUE', value: 'vegetative' },
        parameterKey: { state: 'VALUE', value: 'air_temperature' }, reportedValue: { state: 'VALUE', value: 23 },
        unit: { state: 'VALUE', value: 'fahrenheit' }, title: { state: 'VALUE', value: 'Verified study' },
      },
    }]);
    const result = await h.service.recommend('org-a', 'profile-a', 'profile-version-a', 'stage-a', actor);
    expect(result.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.findings.some((finding) => finding.code === 'EVIDENCE_UNIT_MISMATCH')).toBe(true);
    expect(h.provider.generateJson).not.toHaveBeenCalled();
    expect(h.proposals.create).not.toHaveBeenCalled();
  });

  it('rejects verified evidence with a crop, stage, or parameter mismatch', async () => {
    const cases = [
      { code: 'EVIDENCE_CROP_MISMATCH', crop: 'Solanum tuberosum', stage: 'vegetative', key: 'air_temperature' },
      { code: 'EVIDENCE_STAGE_MISMATCH', crop: 'Solanum lycopersicum', stage: 'fruiting', key: 'air_temperature' },
      { code: 'EVIDENCE_PARAMETER_MISMATCH', crop: 'Solanum lycopersicum', stage: 'vegetative', key: 'unregistered_parameter' },
    ];
    for (const testCase of cases) {
      const h = harness([{
        id: 'mismatched-evidence', verificationStatus: ScientificEvidenceVerificationStatus.VERIFIED,
        contract: {
          crop: { state: 'VALUE', value: testCase.crop },
          cultivar: { state: 'UNKNOWN' }, growthStage: { state: 'VALUE', value: testCase.stage },
          parameterKey: { state: 'VALUE', value: testCase.key }, reportedValue: { state: 'VALUE', value: 23 },
          unit: { state: 'VALUE', value: '°C' }, title: { state: 'VALUE', value: 'Verified study' },
        },
      }]);
      const result = await h.service.recommend('org-a', 'profile-a', 'profile-version-a', 'stage-a', actor);
      expect(result.status).toBe('INSUFFICIENT_EVIDENCE');
      expect(result.findings.some((finding) => finding.code === testCase.code)).toBe(true);
      expect(h.provider.generateJson).not.toHaveBeenCalled();
      expect(h.proposals.create).not.toHaveBeenCalled();
    }
  });

  it('returns a structured provider configuration error without fabricating a proposal', async () => {
    const h = harness([{
      id: 'evidence-a', verificationStatus: ScientificEvidenceVerificationStatus.VERIFIED,
      contract: {
        crop: { state: 'VALUE', value: 'Solanum lycopersicum' },
        cultivar: { state: 'UNKNOWN' }, growthStage: { state: 'VALUE', value: 'vegetative' },
        parameterKey: { state: 'VALUE', value: 'air_temperature' }, reportedValue: { state: 'VALUE', value: 23 },
        unit: { state: 'VALUE', value: '°C' }, title: { state: 'VALUE', value: 'Verified study' },
      },
    }]);
    await expect(h.service.recommend('org-a', 'profile-a', 'profile-version-a', 'stage-a', actor)).rejects.toMatchObject({
      status: 503,
      response: { code: 'LLM_PROVIDER_NOT_CONFIGURED' },
    });
    expect(h.proposals.create).not.toHaveBeenCalled();
  });

  it('creates a review proposal for a source-reported value and preserves proposal review context', async () => {
    const h = harness([{
      id: 'evidence-a', verificationStatus: ScientificEvidenceVerificationStatus.VERIFIED,
      contract: {
        crop: { state: 'VALUE', value: 'Solanum lycopersicum' },
        cultivar: { state: 'UNKNOWN' }, growthStage: { state: 'VALUE', value: 'vegetative' },
        parameterKey: { state: 'VALUE', value: 'air_temperature' }, reportedValue: { state: 'VALUE', value: 23 },
        unit: { state: 'VALUE', value: '°C' }, title: { state: 'VALUE', value: 'Verified study' },
      },
    }], true);
    h.provider.generateJson.mockResolvedValue({ recommendations: [{ parameterKey: 'air_temperature', reportedRecommendation: 23, unit: '°C', evidenceReferences: ['evidence-a'], uncertainty: 'MODERATE', rationale: 'This source reports the same value.' }] });
    const result = await h.service.recommend('org-a', 'profile-a', 'profile-version-a', 'stage-a', actor);
    expect(result.status).toBe('PROPOSAL_CREATED');
    expect(h.proposals.create).toHaveBeenCalledOnce();
    const payload = h.proposals.create.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.provider).toEqual({ name: 'actual-provider', model: 'actual-model' });
    expect((payload.stageTemplates as Array<{ config: Record<string, unknown> }>)[0].config.air_temperature).toBe(23);
    expect((payload.validationFindings as Array<{ code: string }>).some((finding) => finding.code === 'MISSING_APPLICABILITY')).toBe(true);
  });

  it('does not apply an air-temperature candidate supported only by evidence for another parameter', async () => {
    const evidence = [
      {
        id: 'air-evidence', verificationStatus: ScientificEvidenceVerificationStatus.VERIFIED,
        contract: {
          crop: { state: 'VALUE', value: 'Solanum lycopersicum' },
          cultivar: { state: 'UNKNOWN' }, growthStage: { state: 'VALUE', value: 'vegetative' },
          parameterKey: { state: 'VALUE', value: 'air_temperature' }, reportedValue: { state: 'VALUE', value: 21 },
          unit: { state: 'VALUE', value: '°C' }, title: { state: 'VALUE', value: 'Temperature study' },
        },
      },
      {
        id: 'humidity-evidence', verificationStatus: ScientificEvidenceVerificationStatus.VERIFIED,
        contract: {
          crop: { state: 'VALUE', value: 'Solanum lycopersicum' },
          cultivar: { state: 'UNKNOWN' }, growthStage: { state: 'VALUE', value: 'vegetative' },
          parameterKey: { state: 'VALUE', value: 'relative_humidity' }, reportedValue: { state: 'VALUE', value: 23 },
          unit: { state: 'VALUE', value: '%' }, title: { state: 'VALUE', value: 'Humidity study' },
        },
      },
    ];
    const parameters = [
      { parameterKey: 'air_temperature', label: 'Air temperature', dataType: 'number', unit: '°C', valueSchema: { type: 'number' } },
      { parameterKey: 'relative_humidity', label: 'Relative humidity', dataType: 'number', unit: '%', valueSchema: { type: 'number' } },
    ];
    const h = harness(evidence, true, parameters);
    h.provider.generateJson.mockResolvedValue({
      recommendations: [{
        parameterKey: 'air_temperature', reportedRecommendation: 23, unit: '°C',
        evidenceReferences: ['air-evidence', 'humidity-evidence'], uncertainty: 'MODERATE',
        rationale: 'This value appears in the cited evidence.',
      }],
    });

    await expect(h.service.recommend('org-a', 'profile-a', 'profile-version-a', 'stage-a', actor)).rejects.toMatchObject({
      status: 502,
      response: { code: 'LLM_RECOMMENDATION_REJECTED' },
    });

    expect(h.proposals.create).not.toHaveBeenCalled();
  });

  it('keeps an inferred candidate for human review without changing the standard configuration', async () => {
    const h = harness([{
      id: 'evidence-a', verificationStatus: ScientificEvidenceVerificationStatus.VERIFIED,
      contract: {
        crop: { state: 'VALUE', value: 'Solanum lycopersicum' },
        cultivar: { state: 'UNKNOWN' }, growthStage: { state: 'VALUE', value: 'vegetative' },
        parameterKey: { state: 'VALUE', value: 'air_temperature' }, reportedValue: { state: 'VALUE', value: 21 },
        unit: { state: 'VALUE', value: '°C' }, title: { state: 'VALUE', value: 'Verified study' },
      },
    }], true);
    h.provider.generateJson.mockResolvedValue({
      recommendations: [{
        parameterKey: 'air_temperature', reportedRecommendation: 23, unit: '°C',
        evidenceReferences: ['evidence-a'], uncertainty: 'MODERATE',
        rationale: 'A candidate derived from the verified study.',
      }],
    });

    await h.service.recommend('org-a', 'profile-a', 'profile-version-a', 'stage-a', actor);

    const payload = h.proposals.create.mock.calls[0][1] as {
      stageTemplates: Array<{ config: Record<string, unknown> }>;
      parameterDefinitions: Array<{ biologicalRecommendation?: { summary: string }; reviewStatus: string }>;
    };
    expect(payload.stageTemplates[0].config.air_temperature).toBe(22);
    expect(payload.parameterDefinitions[0].biologicalRecommendation?.summary).toContain('not applied to the standard configuration');
    expect(payload.parameterDefinitions[0].reviewStatus).toBe('NEEDS_REVIEW');
  });
});
