import { describe, expect, it } from 'vitest';
import { OpenAiCompatibleRecommendationProvider } from './openai-compatible-recommendation.provider.js';

const liveEnabled = process.env.LLM_LIVE_TEST === 'true'
  && Boolean(process.env.LLM_API_BASE_URL?.trim())
  && Boolean(process.env.LLM_API_KEY?.trim())
  && Boolean(process.env.LLM_MODEL?.trim());

describe.skipIf(!liveEnabled)('Gemini live integration (opt-in)', () => {
  it('returns a schema-conforming JSON response from the configured Gemini model', async () => {
    const config = { get: (key: string) => process.env[key] };
    const provider = new OpenAiCompatibleRecommendationProvider(config as never);
    const schema = {
      type: 'object',
      properties: { ready: { type: 'boolean' } },
      required: ['ready'],
      additionalProperties: false,
    };

    const result = await provider.generateJson({
      task: 'Return the required JSON object with ready set to true. Do not include any other text.',
    }, schema);

    expect(result).toEqual({ ready: expect.any(Boolean) });
  }, 45_000);
});
