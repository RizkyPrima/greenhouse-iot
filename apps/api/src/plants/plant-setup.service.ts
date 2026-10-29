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
    parameterRecommendations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          parameterKey: { type: 'string' },
          recommendedValue: { type: ['number', 'null'] },
          minimumValue: { type: ['number', 'null'] },
          maximumValue: { type: ['number', 'null'] },
          unit: { type: ['string', 'null'] },
          note: { type: 'string' },
        },
        required: ['parameterKey', 'recommendedValue', 'minimumValue', 'maximumValue', 'unit', 'note'],
        additionalProperties: false,
      },
    },
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
  required: ['scientificNameSuggestion', 'parameterRecommendations', 'additionalParameters', 'growthStages'],
  additionalProperties: false,
};

const PRIORITY_PARAMETERS = [
  { parameterKey: 'nutrient_solution_ph', label: 'pH larutan nutrisi' },
  { parameterKey: 'tds', label: 'TDS' },
  { parameterKey: 'water_temperature', label: 'Suhu air' },
  { parameterKey: 'air_temperature', label: 'Suhu udara' },
  { parameterKey: 'relative_humidity', label: 'Kelembapan relatif' },
  { parameterKey: 'light_intensity', label: 'Intensitas cahaya', unit: 'lux' },
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
        message: 'AI provider untuk plant setup belum dikonfigurasi.',
      });
    }

    const prompt = {
      task: 'Suggest plant-parameter identities, provisional numeric recommendation values/ranges, and growth-stage labels for human review. Numeric suggestions may be based on general model knowledge only: they are unverified candidates, not evidence, not safe operating limits, and must never be described as source-supported or verified. Use null for values, bounds, or units you cannot confidently suggest. Never return source titles, URLs, citations, research findings, evidence status, or claims that a value is verified. Return an empty additionalParameters list if no additional parameter is clearly relevant. Use only lowercase snake_case parameter keys.',
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
        parameterRecommendations: 'Return one entry for every priority parameter and additional parameter. Include provisional value, minimum, maximum, and unit only when you can suggest them; otherwise use null. Use the specified unit for light_intensity (lux); the firmware reading is simulated or an uncalibrated LDR estimate, not a calibrated measurement. Keep notes concise and state important uncertainty. These are unverified AI candidates.',
        additionalParameters: 'Only parameterKey and a concise display label. Do not duplicate priorityParameters.',
        growthStages: 'Suggest ordered stage identifiers and labels. These are editable workflow suggestions, not verified agronomic facts.',
      },
    };

    const generated = await this.provider.generateJsonWithMetadata(prompt, SETUP_OUTPUT_SCHEMA);
    return this.validateOutput(generated.output, generated.provider);
  }

  private validateOutput(value: unknown, provider: { name: string; model: string }) {
    if (!isRecord(value) || Object.keys(value).some((key) => !['scientificNameSuggestion', 'parameterRecommendations', 'additionalParameters', 'growthStages'].includes(key))
      || !(typeof value.scientificNameSuggestion === 'string' || value.scientificNameSuggestion === null)
      || !Array.isArray(value.parameterRecommendations) || !Array.isArray(value.additionalParameters) || !Array.isArray(value.growthStages)) {
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

    const parameterKeys = new Set([
      ...PRIORITY_PARAMETERS.map(({ parameterKey }) => parameterKey),
      ...additionalParameters.map(({ parameterKey }) => parameterKey),
    ]);
    const recommendations = new Map<string, {
      recommendedValue: number | null;
      minimumValue: number | null;
      maximumValue: number | null;
      unit: string | null;
      note: string;
    }>();
    for (const raw of value.parameterRecommendations) {
      if (!isRecord(raw) || Object.keys(raw).some((key) => !['parameterKey', 'recommendedValue', 'minimumValue', 'maximumValue', 'unit', 'note'].includes(key))
        || typeof raw.parameterKey !== 'string' || !parameterKeys.has(raw.parameterKey)
        || recommendations.has(raw.parameterKey)
        || ![raw.recommendedValue, raw.minimumValue, raw.maximumValue].every((item) => item === null || typeof item === 'number' && Number.isFinite(item))
        || !(raw.unit === null || typeof raw.unit === 'string' && raw.unit.trim().length <= 32)
        || typeof raw.note !== 'string' || raw.note.trim().length > 500) {
        throw new BadGatewayException({ code: 'LLM_INVALID_RESPONSE', message: 'Gemini returned an invalid provisional parameter recommendation' });
      }
      if (typeof raw.minimumValue === 'number' && typeof raw.maximumValue === 'number' && raw.minimumValue > raw.maximumValue) {
        throw new BadGatewayException({ code: 'LLM_INVALID_RESPONSE', message: 'Gemini returned an inverted provisional parameter range' });
      }
      const priorityParameter = PRIORITY_PARAMETERS.find(({ parameterKey }) => parameterKey === raw.parameterKey);
      if (priorityParameter?.unit && typeof raw.unit === 'string' && raw.unit.trim() && raw.unit.trim() !== priorityParameter.unit) {
        throw new BadGatewayException({ code: 'LLM_INVALID_RESPONSE', message: `Gemini returned an unsupported unit for ${raw.parameterKey}` });
      }
      if (typeof raw.recommendedValue === 'number'
        && (typeof raw.minimumValue === 'number' && raw.recommendedValue < raw.minimumValue
          || typeof raw.maximumValue === 'number' && raw.recommendedValue > raw.maximumValue)) {
        throw new BadGatewayException({ code: 'LLM_INVALID_RESPONSE', message: 'Gemini returned a provisional value outside its suggested range' });
      }
      recommendations.set(raw.parameterKey, {
        recommendedValue: typeof raw.recommendedValue === 'number' ? raw.recommendedValue : null,
        minimumValue: typeof raw.minimumValue === 'number' ? raw.minimumValue : null,
        maximumValue: typeof raw.maximumValue === 'number' ? raw.maximumValue : null,
        unit: typeof raw.unit === 'string' && raw.unit.trim() ? raw.unit.trim() : null,
        note: raw.note.trim(),
      });
    }
    if (recommendations.size !== parameterKeys.size) {
      throw new BadGatewayException({ code: 'LLM_INVALID_RESPONSE', message: 'Gemini did not return a provisional recommendation entry for every parameter' });
    }
    const recommendationFor = (parameterKey: string) => {
      const recommendation = recommendations.get(parameterKey);
      if (!recommendation) throw new BadGatewayException({ code: 'LLM_INVALID_RESPONSE', message: 'Gemini omitted a provisional parameter recommendation' });
      return recommendation;
    };

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
        ...PRIORITY_PARAMETERS.map(({ unit: defaultUnit, ...parameter }) => ({
          ...parameter,
          dataType: 'number' as const,
          ...recommendationFor(parameter.parameterKey),
          unit: defaultUnit ?? recommendationFor(parameter.parameterKey).unit,
          evidenceStatus: 'NOT_ASSESSED' as const,
        })),
        ...additionalParameters.map((parameter) => ({
          ...parameter,
          ...recommendationFor(parameter.parameterKey),
        })),
      ],
      growthStages,
      provider,
      findings: [{
        code: 'HUMAN_REVIEW_REQUIRED',
        explanation: 'Nilai dan rentang adalah kandidat awal AI yang belum diverifikasi. Tidak ada evidence yang dibuat atau diverifikasi oleh generasi ini.',
      }],
      sourceCandidates: [],
      sourceSearchStatus: 'NOT_SEARCHED' as const,
    };
  }
}
