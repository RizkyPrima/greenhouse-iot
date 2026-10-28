import { describe, expect, it, vi } from 'vitest';
import { OpenAiCompatibleRecommendationProvider } from './openai-compatible-recommendation.provider.js';

function provider() {
  const config = { get: vi.fn((key: string) => ({
    LLM_API_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    LLM_API_KEY: 'test-key',
    LLM_MODEL: 'gemini-3.5-flash-lite',
  } as Record<string, string>)[key]) };
  return new OpenAiCompatibleRecommendationProvider(config as never);
}

function responseError(error: unknown): Record<string, unknown> {
  const exception = error as { getResponse?: () => unknown };
  return exception.getResponse?.() as Record<string, unknown>;
}

describe('OpenAiCompatibleRecommendationProvider', () => {
  it('sends Gemini OpenAI-compatible structured output without unsupported sampling options', async () => {
    const client = provider();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"recommendations":[]}' }, finish_reason: 'stop' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const schema = { type: 'object', properties: { recommendations: { type: 'array' } } };
      const result = await client.generateJson({ task: 'test prompt' }, schema);
      expect(result).toEqual({ recommendations: [] });
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
      expect((options.headers as Record<string, string>).authorization).toBe('Bearer test-key');
      const body = JSON.parse(String(options.body)) as Record<string, unknown>;
      expect(body.model).toBe('gemini-3.5-flash-lite');
      expect(body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'plant_recommendations', strict: true, schema } });
      expect(body).not.toHaveProperty('temperature');
      expect(body).not.toHaveProperty('max_tokens');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('maps invalid API key, quota exhaustion, and malformed response to structured errors', async () => {
    const client = provider();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'API_KEY_INVALID' } }), { status: 400 })));
    try {
      await expect(client.generateJson({}, {})).rejects.toSatisfy((error: unknown) => responseError(error).code === 'LLM_INVALID_API_KEY');
    } finally { vi.unstubAllGlobals(); }

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: 'quota exceeded' } }), { status: 429, headers: { 'retry-after': '30' } })));
    try {
      await expect(client.generateJson({}, {})).rejects.toSatisfy((error: unknown) => {
        const body = responseError(error);
        return body.code === 'LLM_QUOTA_EXCEEDED' && body.retryAfterSeconds === 30;
      });
    } finally { vi.unstubAllGlobals(); }

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{not-json' } }] }), { status: 200 })));
    try {
      await expect(client.generateJson({}, {})).rejects.toSatisfy((error: unknown) => responseError(error).code === 'LLM_INVALID_RESPONSE');
    } finally { vi.unstubAllGlobals(); }
  });

  it('distinguishes request rate limiting from exhausted project quota', async () => {
    const client = provider();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: 'Requests per minute limit exceeded' } }), { status: 429, headers: { 'retry-after': '15' } })));
    try {
      await expect(client.generateJson({}, {})).rejects.toSatisfy((error: unknown) => {
        const body = responseError(error);
        return body.code === 'LLM_RATE_LIMITED' && body.retryAfterSeconds === 15;
      });
    } finally { vi.unstubAllGlobals(); }
  });

  it('rejects non-completed model responses and does not send the key to a non-Gemini endpoint', async () => {
    const client = provider();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"recommendations":[]}' }, finish_reason: 'safety' }] }), { status: 200 })));
    try {
      await expect(client.generateJson({}, {})).rejects.toSatisfy((error: unknown) => responseError(error).code === 'LLM_INVALID_RESPONSE');
    } finally { vi.unstubAllGlobals(); }

    const config = { get: vi.fn((key: string) => ({
      LLM_API_BASE_URL: 'https://attacker.example/v1beta/openai/',
      LLM_API_KEY: 'test-key',
      LLM_MODEL: 'gemini-3.1-flash-lite',
    } as Record<string, string>)[key]) };
    const misconfiguredClient = new OpenAiCompatibleRecommendationProvider(config as never);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(misconfiguredClient.generateJson({}, {})).rejects.toSatisfy((error: unknown) => responseError(error).code === 'LLM_PROVIDER_NOT_CONFIGURED');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it('returns a structured timeout error', async () => {
    const client = provider();
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout));
    try {
      await expect(client.generateJson({}, {})).rejects.toSatisfy((error: unknown) => responseError(error).code === 'LLM_PROVIDER_TIMEOUT');
    } finally { vi.unstubAllGlobals(); }
  });
});
