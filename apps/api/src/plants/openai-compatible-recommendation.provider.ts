import { BadGatewayException, GatewayTimeoutException, HttpException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PlantRecommendationGeneration, PlantRecommendationProvider } from './plant-recommendation-provider.js';

const RECOMMENDATION_TOTAL_TIMEOUT_MS = 120_000;
const RECOMMENDATION_PROVIDER_TIMEOUT_MS = 30_000;
const PROVIDERS = {
  GEMINI: {
    name: 'Google Gemini API',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.8-flash',
    hostname: 'generativelanguage.googleapis.com',
    pathname: '/v1beta/openai',
  },
  OPENAI: {
    name: 'OpenAI API',
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-5.4-mini',
    hostname: 'api.openai.com',
    pathname: '/v1',
  },
} as const;

type ProviderName = keyof typeof PROVIDERS;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

@Injectable()
export class OpenAiCompatibleRecommendationProvider implements PlantRecommendationProvider {
  private readonly logger = new Logger(OpenAiCompatibleRecommendationProvider.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return this.configurations().length > 0;
  }

  getName(): string {
    return this.configurations()[0]?.provider.name ?? 'AI provider';
  }

  getModel(): string | undefined {
    return this.configurations()[0]?.model;
  }

  async generateJson(input: unknown, outputSchema: Record<string, unknown>): Promise<unknown> {
    return (await this.generateJsonWithMetadata(input, outputSchema)).output;
  }

  async generateJsonWithMetadata(input: unknown, outputSchema: Record<string, unknown>): Promise<PlantRecommendationGeneration> {
    const providers = this.configurations();
    if (!providers.length) throw new ServiceUnavailableException({ code: 'LLM_PROVIDER_NOT_CONFIGURED', message: 'Layanan penyusunan rekomendasi belum siap.' });
    const deadline = Date.now() + RECOMMENDATION_TOTAL_TIMEOUT_MS;
    let lastRetryableError: HttpException | undefined;
    for (const [index, config] of providers.entries()) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      try {
        const providerTimeoutMs = providers.length === 1
          ? remainingMs
          : Math.min(RECOMMENDATION_PROVIDER_TIMEOUT_MS, remainingMs);
        const output = await this.generateWithProvider(input, outputSchema, config, providerTimeoutMs);
        return { output, provider: { name: config.provider.name, model: config.model } };
      } catch (error) {
        if (!(error instanceof HttpException) || !this.isRetryable(error)) throw error;
        lastRetryableError = error;
        if (index < providers.length - 1) {
          this.logger.warn(`${config.provider.name} request unavailable; trying next configured provider.`);
        }
      }
    }
    if (lastRetryableError) throw lastRetryableError;
    throw new GatewayTimeoutException({ code: 'LLM_PROVIDER_TIMEOUT', message: 'Proses penyusunan rekomendasi melewati batas waktu.' });
  }

  private async generateWithProvider(
    input: unknown,
    outputSchema: Record<string, unknown>,
    config: NonNullable<ReturnType<OpenAiCompatibleRecommendationProvider['configurationFor']>>,
    timeoutMs: number,
  ): Promise<unknown> {
    let response: Response;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    try {
      response = await fetch(`${config.endpoint}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          messages: [{
            role: 'user',
            content: config.providerName === 'OPENAI'
              ? `Return valid JSON matching this schema. Do not include markdown or commentary.\n${JSON.stringify({ input, outputSchema })}`
              : JSON.stringify(input),
          }],
          response_format: config.providerName === 'OPENAI'
            ? { type: 'json_object' }
            : { type: 'json_schema', json_schema: { name: 'plant_recommendations', strict: true, schema: outputSchema } },
        }),
        signal: timeoutSignal,
      });
    } catch (error) {
      if (timeoutSignal.aborted || error instanceof Error && error.name === 'TimeoutError') {
        throw new GatewayTimeoutException({ code: 'LLM_PROVIDER_TIMEOUT', message: 'Proses penyusunan rekomendasi melewati batas waktu.' });
      }
      throw new ServiceUnavailableException({ code: 'LLM_PROVIDER_UNAVAILABLE', message: 'Layanan penyusunan rekomendasi sementara tidak tersedia.' });
    }
    if (!response.ok) throw await this.mapProviderError(response, config.provider.name);
    let body: { choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }> };
    try {
      body = await response.json() as typeof body;
    } catch {
      throw new BadGatewayException({ code: 'LLM_INVALID_RESPONSE', message: 'Hasil rekomendasi belum dapat diproses.' });
    }
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || body.choices?.[0]?.finish_reason !== 'stop') {
      throw new BadGatewayException({ code: 'LLM_INVALID_RESPONSE', message: 'Hasil rekomendasi belum lengkap dan tidak dapat diproses.' });
    }
    try { return JSON.parse(content); } catch {
      throw new BadGatewayException({ code: 'LLM_INVALID_RESPONSE', message: 'Format hasil rekomendasi tidak valid.' });
    }
  }

  private isRetryable(error: HttpException): boolean {
    const response = error.getResponse();
    const code = isRecord(response) ? response.code : undefined;
    return [
      'LLM_QUOTA_EXCEEDED',
      'LLM_RATE_LIMITED',
      'LLM_PROVIDER_TIMEOUT',
      'LLM_PROVIDER_OVERLOADED',
      'LLM_PROVIDER_UNAVAILABLE',
      'LLM_MODEL_UNAVAILABLE',
    ].includes(String(code));
  }

  private async mapProviderError(response: Response, providerName: string): Promise<HttpException> {
    let providerCode = '';
    let providerStatus = '';
    let providerMessage = '';
    try {
      const body = await response.json() as { error?: { code?: string | number; status?: string; message?: string } };
      providerStatus = body.error?.status ?? '';
      providerMessage = body.error?.message ?? '';
      providerCode = `${providerStatus} ${body.error?.code ?? ''} ${providerMessage}`.toLocaleLowerCase();
    } catch { /* Map by HTTP status without exposing the upstream response. */ }

    if (response.status === 400 || response.status === 404) {
      const safeProviderMessage = providerMessage
        .replace(/AIza[\w-]{20,}/g, '[redacted-key]')
        .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[redacted-key]')
        .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
        .replace(/https?:\/\/\S+/gi, '[redacted-url]')
        .slice(0, 500);
      this.logger.warn(`${providerName} rejected request: httpStatus=${response.status}, providerStatus=${providerStatus || 'unknown'}, providerMessage=${safeProviderMessage || 'unavailable'}`);
    }

    if (response.status === 401 || response.status === 400 && /api[_ ]key|invalid[_ ]key|key not valid/.test(providerCode)) {
      return new BadGatewayException({ code: 'LLM_INVALID_API_KEY', message: `${providerName} menolak API key. Periksa key dan konfigurasi akun provider.` });
    }
    if (response.status === 403) return new BadGatewayException({ code: 'LLM_PROVIDER_ACCESS_DENIED', message: `Akun ${providerName} tidak memiliki izin untuk mengakses layanan atau model ini.` });
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      const retryAfterSeconds = retryAfter && Number.isFinite(Number(retryAfter)) ? Number(retryAfter) : undefined;
      const quota = /quota|daily limit|per day/.test(providerCode);
      return new HttpException({
        code: quota ? 'LLM_QUOTA_EXCEEDED' : 'LLM_RATE_LIMITED',
        message: quota ? `Kuota ${providerName} untuk penyusunan rekomendasi sudah tercapai.` : `Terlalu banyak permintaan ke ${providerName}.`,
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
      }, 429);
    }
    if (response.status === 400 || response.status === 404) {
      const modelUnavailable = response.status === 404
        || /(?:model|models)\b.{0,80}\b(?:not found|does not exist|is unavailable|is not available|not supported|unsupported)\b|\b(?:not found|does not exist|is unavailable|is not available)\b.{0,80}\b(?:model|models)\b/.test(providerCode);
      return new BadGatewayException({
        code: modelUnavailable ? 'LLM_MODEL_UNAVAILABLE' : 'LLM_REQUEST_REJECTED',
        message: modelUnavailable
          ? `Model ${providerName} yang dikonfigurasi tidak tersedia untuk akun ini. Periksa nama model atau akses akun.`
          : `${providerName} menolak format permintaan penyusunan parameter. Periksa schema output dan konfigurasi model.`,
      });
    }
    if (response.status === 408 || response.status === 504) return new GatewayTimeoutException({ code: 'LLM_PROVIDER_TIMEOUT', message: 'Proses penyusunan rekomendasi melewati batas waktu.' });
    if (response.status === 503) {
      const retryAfter = response.headers.get('retry-after');
      const retryAfterSeconds = retryAfter && Number.isFinite(Number(retryAfter)) ? Number(retryAfter) : undefined;
      return new ServiceUnavailableException({
        code: /high demand|overload|temporarily unavailable|unavailable/.test(providerCode)
          ? 'LLM_PROVIDER_OVERLOADED'
          : 'LLM_PROVIDER_UNAVAILABLE',
          message: 'Layanan penyusunan rekomendasi sedang sibuk atau sementara tidak tersedia.',
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
      });
    }
    if (response.status >= 500) return new ServiceUnavailableException({ code: 'LLM_PROVIDER_UNAVAILABLE', message: 'Layanan penyusunan rekomendasi sementara tidak tersedia.' });
    return new BadGatewayException({ code: 'LLM_PROVIDER_ERROR', message: 'Permintaan rekomendasi belum dapat diproses.' });
  }

  private configurationFor(providerName: ProviderName) {
    const provider = PROVIDERS[providerName];
    const configuredEndpoint = this.config.get<string>('LLM_API_BASE_URL')?.trim();
    const providerKey = this.config.get<string>(`${providerName}_API_KEY`)?.trim();
    const legacyKey = providerName === 'GEMINI' ? this.config.get<string>('LLM_API_KEY')?.trim() : undefined;
    const apiKey = providerKey || legacyKey;
    const providerModel = this.config.get<string>(`${providerName}_MODEL`)?.trim();
    const legacyModel = this.config.get<string>('LLM_MODEL')?.trim();
    if (!apiKey) return null;
    try {
      let baseUrl = new URL(configuredEndpoint || provider.endpoint);
      const matchesProvider = (url: URL, candidate: typeof provider) => url.protocol === 'https:'
        && url.hostname === candidate.hostname
        && url.pathname.replace(/\/+$/, '') === candidate.pathname
        && !url.username && !url.password && !url.search && !url.hash;
      if (!matchesProvider(baseUrl, provider)) {
        const belongsToSupportedProvider = Object.values(PROVIDERS).some((candidate) => matchesProvider(baseUrl, candidate));
        if (!belongsToSupportedProvider) return null;
        // Provider selection wins over a leftover official endpoint from the other provider.
        baseUrl = new URL(provider.endpoint);
      }
      const legacyModelMatchesProvider = providerName === 'OPENAI'
        ? Boolean(legacyModel?.startsWith('gpt-')) || /^o\d(?:-|$)/.test(legacyModel ?? '')
        : Boolean(legacyModel?.startsWith('gemini-'));
      const model = providerModel || (legacyModelMatchesProvider ? legacyModel : undefined) || provider.model;
      return { endpoint: `${baseUrl.origin}${provider.pathname}`, apiKey, model, provider, providerName };
    } catch {
      return null;
    }
  }

  private configurations() {
    const preferred = this.config.get<string>('LLM_PROVIDER')?.trim().toUpperCase() === 'OPENAI'
      ? 'OPENAI'
      : 'GEMINI';
    const order: ProviderName[] = [preferred, preferred === 'GEMINI' ? 'OPENAI' : 'GEMINI'];
    return order
      .map((providerName) => this.configurationFor(providerName))
      .filter((provider): provider is NonNullable<ReturnType<OpenAiCompatibleRecommendationProvider['configurationFor']>> => provider !== null);
  }
}
