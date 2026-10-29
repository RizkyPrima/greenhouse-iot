import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PlantSetupService } from './plant-setup.service.js';

const actor = { id: 'owner-a' } as AuthenticatedUser;
const validOutput = {
  scientificNameSuggestion: 'Solanum lycopersicum',
  parameterRecommendations: [
    'nutrient_solution_ph',
    'tds',
    'water_temperature',
    'air_temperature',
    'relative_humidity',
    'light_intensity',
    'co2_level',
  ].map((parameterKey) => ({
    parameterKey,
    recommendedValue: 5,
    minimumValue: 4,
    maximumValue: 6,
    unit: parameterKey === 'light_intensity' ? 'lux' : 'unit',
    note: 'Kandidat awal, belum diverifikasi.',
  })),
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
    generateJsonWithMetadata: vi.fn(),
  };
  provider.generateJsonWithMetadata.mockImplementation(async (input, schema) => ({
    output: await provider.generateJson(input, schema),
    provider: { name: 'Google Gemini API', model: 'configured-text-model' },
  }));
  return {
    authorization,
    provider,
    service: new PlantSetupService(authorization as never, provider as never),
  };
}

describe('PlantSetupService', () => {
  it('returns provisional parameter values and real-source candidates without evidence claims', async () => {
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
    expect(result.provider).toEqual({ name: 'Google Gemini API', model: 'configured-text-model' });
    expect(result.parameters.slice(0, 6).map((parameter) => parameter.parameterKey)).toEqual([
      'nutrient_solution_ph',
      'tds',
      'water_temperature',
      'air_temperature',
      'relative_humidity',
      'light_intensity',
    ]);
    expect(result.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ parameterKey: 'nutrient_solution_ph', recommendedValue: 5, minimumValue: 4, maximumValue: 6, evidenceStatus: 'NOT_ASSESSED' }),
      expect.objectContaining({ parameterKey: 'light_intensity', label: 'Intensitas cahaya', unit: 'lux', recommendedValue: 5, evidenceStatus: 'NOT_ASSESSED' }),
      expect.objectContaining({ parameterKey: 'co2_level', recommendedValue: 5, evidenceStatus: 'NOT_ASSESSED' }),
    ]));
    expect(result.growthStages.map((stage) => stage.sequence)).toEqual([1, 2]);
    expect(JSON.stringify(result)).not.toMatch(/canonicalUrl|VERIFIED/);
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

  it('rejects inverted ranges', async () => {
    const h = harness();
    h.provider.generateJson.mockResolvedValue({
      ...validOutput,
      parameterRecommendations: validOutput.parameterRecommendations.map((item, index) => index === 0
        ? { ...item, minimumValue: 8, maximumValue: 4 }
        : item),
    });
    await expect(h.service.generate('org-a', { commonName: 'Tomat', cultivationMethod: 'hydroponic_tower' }, actor))
      .rejects.toBeInstanceOf(BadGatewayException);
  });

  it('rejects an AI-suggested light unit that does not match the firmware light telemetry', async () => {
    const h = harness();
    h.provider.generateJson.mockResolvedValue({
      ...validOutput,
      parameterRecommendations: validOutput.parameterRecommendations.map((item) => item.parameterKey === 'light_intensity'
        ? { ...item, unit: 'W/m2' }
        : item),
    });
    await expect(h.service.generate('org-a', { commonName: 'Tomat', cultivationMethod: 'hydroponic_tower' }, actor))
      .rejects.toBeInstanceOf(BadGatewayException);
  });

  it('rejects provisional values outside the AI-suggested range', async () => {
    const h = harness();
    h.provider.generateJson.mockResolvedValue({
      ...validOutput,
      parameterRecommendations: validOutput.parameterRecommendations.map((item, index) => index === 0
        ? { ...item, recommendedValue: 7 }
        : item),
    });
    await expect(h.service.generate('org-a', { commonName: 'Tomat', cultivationMethod: 'hydroponic_tower' }, actor))
      .rejects.toBeInstanceOf(BadGatewayException);
  });

});
