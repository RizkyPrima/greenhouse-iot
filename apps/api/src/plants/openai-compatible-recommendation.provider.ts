import { BadGatewayException, GatewayTimeoutException, HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PlantRecommendationProvider } from './plant-recommendation-provider.js';

@Injectable()
export class OpenAiCompatibleRecommendationProvider implements PlantRecommendationProvider {
  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.configuration());
  }

  getName(): string {
    return 'Google Gemini API';
  }

  getModel(): string | undefined {
    return this.configuration()?.model;
  }

  async generateJson(input: unknown, outputSchema: Record<string, unknown>): Promise<unknown> {
    const config = this.configuration();
    if (!config) throw new ServiceUnavailableException({ code: 'LLM_PROVIDER_NOT_CONFIGURED', message: 'Gemini recommendation provider is not configured' });
    let response: Response;
    const timeoutSignal = AbortSignal.timeout(30_000);
    try {
      response = await fetch(`${config.endpoint}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: 'user', content: JSON.stringify(input) }],
          response_format: { type: 'json_schema', json_schema: { name: 'plant_recommendations', strict: true, schema: outputSchema } },
        }),
        signal: timeoutSignal,
      });
    } catch (error) {
      if (timeoutSignal.aborted || error instanceof Error && error.name === 'TimeoutError') {
        throw new GatewayTimeoutException({ code: 'LLM_PROVIDER_TIMEOUT', message: 'Gemini recommendation request timed out' });
      }
      throw new ServiceUnavailableException({ code: 'LLM_PROVIDER_UNAVAILABLE', message: 'Gemini recommendation provider could not be reached' });
    }
    if (!response.ok) throw await this.mapProviderError(response);
    let body: { choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }> };
    try {
      body = await response.json() as typeof body;
    } catch {
      throw new BadGatewayException({ code: 'LLM_INVALID_RESPONSE', message: 'Gemini returned a non-JSON response' });
    }
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || body.choices?.[0]?.finish_reason !== 'stop') {
      throw new BadGatewayException({ code: 'LLM_INVALID_RESPONSE', message: 'Gemini did not return a complete structured recommendation' });
    }
    try { return JSON.parse(content); } catch {
      throw new BadGatewayException({ code: 'LLM_INVALID_RESPONSE', message: 'Gemini returned malformed structured JSON' });
    }
  }

  private async mapProviderError(response: Response): Promise<HttpException> {
    let providerCode = '';
    try {
      const body = await response.json() as { error?: { code?: string | number; status?: string; message?: string } };
      providerCode = `${body.error?.status ?? ''} ${body.error?.code ?? ''} ${body.error?.message ?? ''}`.toLocaleLowerCase();
    } catch { /* Map by HTTP status without exposing the upstream response. */ }

    if (response.status === 401 || response.status === 400 && /api[_ ]key|invalid[_ ]key|key not valid/.test(providerCode)) {
      return new BadGatewayException({ code: 'LLM_INVALID_API_KEY', message: 'Gemini rejected the configured API key' });
    }
    if (response.status === 403) return new BadGatewayException({ code: 'LLM_PROVIDER_ACCESS_DENIED', message: 'Gemini denied access for the configured API key or project' });
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      const retryAfterSeconds = retryAfter && Number.isFinite(Number(retryAfter)) ? Number(retryAfter) : undefined;
      const quota = /quota|daily limit|per day/.test(providerCode);
      return new HttpException({
        code: quota ? 'LLM_QUOTA_EXCEEDED' : 'LLM_RATE_LIMITED',
        message: quota ? 'Gemini project quota is exhausted' : 'Gemini request rate limit was reached',
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
      }, 429);
    }
    if (response.status === 400 || response.status === 404) {
      const modelUnavailable = /model|not found|unsupported/.test(providerCode) || response.status === 404;
      return new BadGatewayException({
        code: modelUnavailable ? 'LLM_MODEL_UNAVAILABLE' : 'LLM_REQUEST_REJECTED',
        message: modelUnavailable ? 'Configured Gemini model is unavailable to this project' : 'Gemini rejected the recommendation request',
      });
    }
    if (response.status === 408 || response.status === 504) return new GatewayTimeoutException({ code: 'LLM_PROVIDER_TIMEOUT', message: 'Gemini recommendation request timed out' });
    if (response.status >= 500) return new ServiceUnavailableException({ code: 'LLM_PROVIDER_UNAVAILABLE', message: 'Gemini recommendation provider is temporarily unavailable' });
    return new BadGatewayException({ code: 'LLM_PROVIDER_ERROR', message: 'Gemini recommendation request failed' });
  }

  private configuration() {
    const endpoint = this.config.get<string>('LLM_API_BASE_URL')?.trim();
    const apiKey = this.config.get<string>('LLM_API_KEY')?.trim();
    const model = this.config.get<string>('LLM_MODEL')?.trim();
    if (!endpoint || !apiKey || !model) return null;
    try {
      const baseUrl = new URL(endpoint);
      if (baseUrl.origin !== 'https://generativelanguage.googleapis.com'
        || baseUrl.pathname.replace(/\/+$/, '') !== '/v1beta/openai'
        || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) return null;
      return { endpoint: `${baseUrl.origin}/v1beta/openai`, apiKey, model };
    } catch {
      return null;
    }
  }
}
