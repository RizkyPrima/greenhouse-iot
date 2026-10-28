import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PlantSetupService } from './plant-setup.service.js';

const actor = { id: 'owner-a' } as AuthenticatedUser;
const validOutput = {
  scientificNameSuggestion: 'Solanum lycopersicum',
  additionalParameters: [{ parameterKey: 'co2_level', label: 'CO2' }],
  growthStages: [
    { code: 'fruiting', label: 'Berbuah', sequence: 2 },
    { code: 'seedling', label: 'Bibit', sequence: 1 },
  ],
};

function harness(configured = true) {
  const authorization = { requireRole: vi.fn().mockResolvedValue({ role: UserRole.OWNER }) };
  const provider = {
    isConfigured: vi.fn().mockReturnValue(configured),
    getName: vi.fn().mockReturnValue('Google Gemini API'),
    getModel: vi.fn().mockReturnValue('configured-text-model'),
    generateJson: vi.fn().mockResolvedValue(validOutput),
  };
  return {
    authorization,
    provider,
    service: new PlantSetupService(authorization as never, provider as never),
  };
}

describe('PlantSetupService', () => {
  it('returns only parameter and stage candidates, without agronomic values or evidence claims', async () => {
    const h = harness();
    const result = await h.service.generate('org-a', {
      commonName: 'Tomat',
      cultivationMethod: 'hydroponic_tower',
    }, actor);

    expect(h.authorization.requireRole).toHaveBeenCalledWith('owner-a', 'org-a', [UserRole.OWNER, UserRole.ADMIN]);
    expect(h.provider.generateJson).toHaveBeenCalledOnce();
    expect(h.provider.generateJson.mock.calls[0][0]).toMatchObject({
      plant: { commonName: 'Tomat', cultivationMethod: 'hidroponik tower' },
      priorityParameters: expect.arrayContaining([expect.objectContaining({ parameterKey: 'nutrient_solution_ph' })]),
    });
    expect(result.status).toBe('CANDIDATES_FOR_REVIEW');
    expect(result.parameters.slice(0, 5).map((parameter) => parameter.parameterKey)).toEqual([
      'nutrient_solution_ph',
      'tds',
      'water_temperature',
      'air_temperature',
      'relative_humidity',
    ]);
    expect(result.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ parameterKey: 'nutrient_solution_ph', unit: null, evidenceStatus: 'NOT_ASSESSED' }),
      expect.objectContaining({ parameterKey: 'co2_level', unit: null, evidenceStatus: 'NOT_ASSESSED' }),
    ]));
    expect(result.growthStages.map((stage) => stage.sequence)).toEqual([1, 2]);
    expect(JSON.stringify(result)).not.toMatch(/recommendedValue|minimum|maximum|canonicalUrl|VERIFIED/);
  });

  it('fails with a structured error when Gemini is not configured', async () => {
    const h = harness(false);
    await expect(h.service.generate('org-a', { commonName: 'Tomat', cultivationMethod: 'hydroponic_tower' }, actor))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(h.provider.generateJson).not.toHaveBeenCalled();
  });

  it('rejects invalid provider parameter identities rather than persisting malformed candidates', async () => {
    const h = harness();
    h.provider.generateJson.mockResolvedValue({
      ...validOutput,
      additionalParameters: [{ parameterKey: 'nutrient_solution_ph', label: 'duplicate' }],
    });
    await expect(h.service.generate('org-a', { commonName: 'Tomat', cultivationMethod: 'hydroponic_tower' }, actor))
      .rejects.toBeInstanceOf(BadGatewayException);
  });

  it('rejects parameter keys that are not lowercase snake_case', async () => {
    const h = harness();
    h.provider.generateJson.mockResolvedValue({
      ...validOutput,
      additionalParameters: [{ parameterKey: 'co2Level', label: 'CO2' }],
    });
    await expect(h.service.generate('org-a', { commonName: 'Tomat', cultivationMethod: 'hydroponic_tower' }, actor))
      .rejects.toBeInstanceOf(BadGatewayException);
  });

  it('rejects a provider response that attempts to add agronomic values or source claims', async () => {
    const h = harness();
    h.provider.generateJson.mockResolvedValue({
      ...validOutput,
      additionalParameters: [{ parameterKey: 'co2_level', label: 'CO2', recommendedValue: 800, canonicalUrl: 'https://example.test' }],
    });
    await expect(h.service.generate('org-a', { commonName: 'Tomat', cultivationMethod: 'hydroponic_tower' }, actor))
      .rejects.toBeInstanceOf(BadGatewayException);
  });
});
