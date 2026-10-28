import { BadGatewayException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PLANT_RECOMMENDATION_PROVIDER } from './plant-recommendation-provider.js';
import type { PlantRecommendationProvider } from './plant-recommendation-provider.js';
import type { GeneratePlantSetupDto } from './plant-setup.dto.js';

const SETUP_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    scientificNameSuggestion: { type: ['string', 'null'] },
    additionalParameters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          parameterKey: { type: 'string' },
          label: { type: 'string' },
        },
        required: ['parameterKey', 'label'],
        additionalProperties: false,
      },
    },
    growthStages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          label: { type: 'string' },
          sequence: { type: 'integer' },
        },
        required: ['code', 'label', 'sequence'],
        additionalProperties: false,
      },
    },
  },
  required: ['scientificNameSuggestion', 'additionalParameters', 'growthStages'],
  additionalProperties: false,
};

const PRIORITY_PARAMETERS = [
  { parameterKey: 'nutrient_solution_ph', label: 'pH larutan nutrisi' },
  { parameterKey: 'tds', label: 'TDS' },
  { parameterKey: 'water_temperature', label: 'Suhu air' },
  { parameterKey: 'air_temperature', label: 'Suhu udara' },
  { parameterKey: 'relative_humidity', label: 'Kelembapan relatif' },
];

const CULTIVATION_LABELS: Record<GeneratePlantSetupDto['cultivationMethod'], string> = {
  hydroponic_tower: 'hidroponik tower',
  hydroponic_nft: 'hidroponik NFT',
  hydroponic_dwc: 'hidroponik DWC',
  soil: 'media tanah',
  other: 'metode lain',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

@Injectable()
export class PlantSetupService {
  constructor(
    private readonly authorization: AuthorizationService,
    @Inject(PLANT_RECOMMENDATION_PROVIDER) private readonly provider: PlantRecommendationProvider,
  ) {}

  async generate(organizationId: string, input: GeneratePlantSetupDto, actor: AuthenticatedUser) {
    await this.authorization.requireRole(actor.id, organizationId, [UserRole.OWNER, UserRole.ADMIN]);
    if (!this.provider.isConfigured()) {
      throw new ServiceUnavailableException({
        code: 'LLM_PROVIDER_NOT_CONFIGURED',
        message: 'Gemini plant setup provider is not configured',
      });
    }

    const prompt = {
      task: 'Suggest plant-parameter identities and growth-stage labels for a human-reviewed draft. Never return numeric values, ranges, units, source titles, URLs, citations, research findings, evidence status, schema bounds, or agronomic claims. A suggestion is not evidence. Return an empty additionalParameters list if no additional parameter is clearly relevant. Use only lowercase snake_case parameter keys.',
      plant: {
        commonName: input.commonName.trim(),
        ...(input.scientificName?.trim() ? { scientificName: input.scientificName.trim() } : {}),
        ...(input.cultivar?.trim() ? { cultivar: input.cultivar.trim() } : {}),
        cultivationMethod: CULTIVATION_LABELS[input.cultivationMethod],
        ...(input.growthStageContext?.trim() ? { growthStageContext: input.growthStageContext.trim() } : {}),
      },
      priorityParameters: PRIORITY_PARAMETERS,
      outputRequirements: {
        scientificNameSuggestion: 'A likely scientific name when the user omitted it; null when uncertain. This is an unverified suggestion.',
        additionalParameters: 'Only parameterKey and a concise display label. Do not duplicate priorityParameters.',
        growthStages: 'Suggest ordered stage identifiers and labels. These are editable workflow suggestions, not verified agronomic facts.',
      },
    };

    const generated = await this.provider.generateJson(prompt, SETUP_OUTPUT_SCHEMA);
    return this.validateOutput(generated);
  }

  private validateOutput(value: unknown) {
    if (!isRecord(value) || !(typeof value.scientificNameSuggestion === 'string' || value.scientificNameSuggestion === null)
      || !Array.isArray(value.additionalParameters) || !Array.isArray(value.growthStages)) {
      throw new BadGatewayException({ code: 'LLM_INVALID_RESPONSE', message: 'Gemini returned an invalid plant setup structure' });
    }
    if (typeof value.scientificNameSuggestion === 'string' && value.scientificNameSuggestion.trim().length > 180) {
      throw new BadGatewayException({ code: 'LLM_INVALID_RESPONSE', message: 'Gemini returned an invalid scientific-name candidate' });
    }

    const keys = new Set(PRIORITY_PARAMETERS.map(({ parameterKey }) => parameterKey));
    const additionalParameters = value.additionalParameters.map((raw) => {
      if (!isRecord(raw) || Object.keys(raw).some((key) => !['parameterKey', 'label'].includes(key))
        || typeof raw.parameterKey !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(raw.parameterKey)
        || typeof raw.label !== 'string' || !raw.label.trim() || raw.label.length > 128
        || keys.has(raw.parameterKey)) {
        throw new BadGatewayException({ code: 'LLM_INVALID_RESPONSE', message: 'Gemini returned an invalid or duplicate parameter candidate' });
      }
      if (keys.size >= 20) throw new BadGatewayException({ code: 'LLM_INVALID_RESPONSE', message: 'Gemini returned too many parameter candidates' });
      keys.add(raw.parameterKey);
      return { parameterKey: raw.parameterKey, label: raw.label.trim(), dataType: 'number' as const, unit: null, evidenceStatus: 'NOT_ASSESSED' as const };
    });

    if (value.growthStages.length < 1 || value.growthStages.length > 12) {
      throw new BadGatewayException({ code: 'LLM_INVALID_RESPONSE', message: 'Gemini returned an invalid number of growth stages' });
    }
    const stageCodes = new Set<string>();
    const sequences = new Set<number>();
    const growthStages = value.growthStages.map((raw) => {
      if (!isRecord(raw) || Object.keys(raw).some((key) => !['code', 'label', 'sequence'].includes(key))
        || typeof raw.code !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(raw.code)
        || typeof raw.label !== 'string' || !raw.label.trim() || raw.label.length > 128
        || !Number.isInteger(raw.sequence) || (raw.sequence as number) < 1
        || stageCodes.has(raw.code) || sequences.has(raw.sequence as number)) {
        throw new BadGatewayException({ code: 'LLM_INVALID_RESPONSE', message: 'Gemini returned invalid or duplicate growth stages' });
      }
      stageCodes.add(raw.code);
      sequences.add(raw.sequence as number);
      return { code: raw.code, label: raw.label.trim(), sequence: raw.sequence as number };
    }).sort((left, right) => left.sequence - right.sequence);

    return {
      status: 'CANDIDATES_FOR_REVIEW' as const,
      scientificNameSuggestion: typeof value.scientificNameSuggestion === 'string' && value.scientificNameSuggestion.trim()
        ? value.scientificNameSuggestion.trim()
        : null,
      parameters: [
        ...PRIORITY_PARAMETERS.map((parameter) => ({ ...parameter, dataType: 'number' as const, unit: null, evidenceStatus: 'NOT_ASSESSED' as const })),
        ...additionalParameters,
      ],
      growthStages,
      provider: { name: this.provider.getName(), ...(this.provider.getModel() ? { model: this.provider.getModel() } : {}) },
      findings: [{
        code: 'HUMAN_REVIEW_REQUIRED',
        explanation: 'Parameter and stage identities are AI candidates only. No agronomic values, units, sources, or evidence were generated or verified.',
      }],
    };
  }
}
