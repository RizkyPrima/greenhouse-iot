import { Injectable } from '@nestjs/common';
import type { MetadataRecord } from './research-source.util.js';
import { normalizeDoi } from './research-source.util.js';

export interface ResearchMetadataProvider {
  readonly name: 'crossref' | 'openalex';
  search(query: string, limit: number): Promise<MetadataRecord[]>;
}

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MIN_REQUEST_INTERVAL_MS = 1000;
const nextRequestAt = new Map<string, number>();

async function getJson(provider: string, url: URL): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const wait = Math.max(0, (nextRequestAt.get(provider) ?? 0) - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    nextRequestAt.set(provider, Date.now() + MIN_REQUEST_INTERVAL_MS);
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'GreenhouseIoT-ResearchRegistry/1.0' },
        signal: AbortSignal.timeout(8000),
      });
      const declaredLength = Number(response.headers.get('content-length') ?? 0);
      if (declaredLength > MAX_RESPONSE_BYTES) {
        await response.body?.cancel();
        throw new Error('Provider response too large');
      }
      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && attempt < 2) {
          await response.body?.cancel();
          await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
          continue;
        }
        throw new Error(`Provider returned HTTP ${response.status}`);
      }
      const chunks: Uint8Array[] = [];
      let byteLength = 0;
      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          byteLength += chunk.value.byteLength;
          if (byteLength > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            throw new Error('Provider response too large');
          }
          chunks.push(chunk.value);
        }
      }
      const text = new TextDecoder().decode(Buffer.concat(chunks));
      return JSON.parse(text) as unknown;
    } catch (error) {
      lastError = error;
      if (attempt < 2 && !(error instanceof SyntaxError) && !(error instanceof Error && error.message === 'Provider response too large')) {
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Provider unavailable');
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function httpUrl(value: unknown): string | undefined {
  const input = string(value);
  if (!input || input.length > 2048) return undefined;
  try {
    const url = new URL(input);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function safeAbstract(value: unknown): string | undefined {
  return string(value)?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 10000);
}

function mapLicenseStatus(value: string | undefined): MetadataRecord['licenseStatus'] {
  if (!value) return 'UNKNOWN';
  return /creativecommons\.org\/(?:licenses|publicdomain)|\bcc[-_ ]?by(?:[-_ ]|$)|\bcc0\b|public[ -]domain/i.test(value)
    ? 'OPEN_LICENSE'
    : 'RESTRICTED_LICENSE';
}

function yearFromDateParts(value: unknown): number | undefined {
  const outer = Array.isArray(value) ? value[0] : undefined;
  const year = Array.isArray(outer) ? outer[0] : undefined;
  return typeof year === 'number' && year >= 1000 && year <= 9999 ? year : undefined;
}

@Injectable()
export class CrossrefMetadataProvider implements ResearchMetadataProvider {
  readonly name = 'crossref' as const;

  async search(query: string, limit: number): Promise<MetadataRecord[]> {
    const url = new URL('https://api.crossref.org/works');
    url.searchParams.set('query.bibliographic', query);
    url.searchParams.set('rows', String(limit));
    const payload = record(await getJson(this.name, url));
    const message = record(payload?.message);
    if (!Array.isArray(message?.items)) throw new Error('Provider response invalid');
    return message.items.flatMap((item): MetadataRecord[] => {
      const data = record(item);
      const title = Array.isArray(data?.title) ? string(data.title[0]) : undefined;
      if (!data || !title || title.length > 1000) return [];
      const doi = string(data.DOI);
      const licenseArray = Array.isArray(data.license) ? data.license : [];
      const licenseUrl = licenseArray.map(record).map((entry) => string(entry?.URL)).find(Boolean);
      const license = mapLicenseStatus(licenseUrl);
      const authorItems = Array.isArray(data.author) ? data.author : [];
      const authors = authorItems.flatMap((entry) => {
        const author = record(entry);
        const name = [string(author?.given), string(author?.family)].filter(Boolean).join(' ');
        return name && name.length <= 500 ? [name] : [];
      }).slice(0, 100);
      return [{
        provider: this.name,
        doi: doi ? normalizeDoi(doi) : undefined,
        crossrefId: doi ? normalizeDoi(doi) : undefined,
        title,
        authors,
        publicationYear: yearFromDateParts(record(data['published-print'])?.['date-parts'] ?? record(data.published)?.['date-parts']),
        journal: Array.isArray(data['container-title']) ? string(data['container-title'][0])?.slice(0, 500) : undefined,
        publisher: string(data.publisher)?.slice(0, 500),
        abstract: license === 'OPEN_LICENSE' ? safeAbstract(data.abstract) : undefined,
        abstractLicenseStatus: license === 'OPEN_LICENSE' ? 'OPEN_LICENSE' : 'UNKNOWN',
        sourceUrl: httpUrl(data.URL),
        licenseUrl: httpUrl(licenseUrl),
        accessStatus: 'UNKNOWN',
        licenseStatus: license,
        providerMetadata: { type: data.type, indexed: data.indexed },
      }];
    });
  }
}

@Injectable()
export class OpenAlexMetadataProvider implements ResearchMetadataProvider {
  readonly name = 'openalex' as const;

  async search(query: string, limit: number): Promise<MetadataRecord[]> {
    const url = new URL('https://api.openalex.org/works');
    url.searchParams.set('search', query);
    url.searchParams.set('per-page', String(limit));
    const payload = record(await getJson(this.name, url));
    if (!Array.isArray(payload?.results)) throw new Error('Provider response invalid');
    return payload.results.flatMap((item): MetadataRecord[] => {
      const data = record(item);
      const title = string(data?.title);
      if (!data || !title || title.length > 1000) return [];
      const doiRaw = string(data.doi);
      const doi = doiRaw ? normalizeDoi(doiRaw) : undefined;
      const authorships = Array.isArray(data.authorships) ? data.authorships : [];
      const authors = authorships.flatMap((entry) => {
        const name = string(record(record(entry)?.author)?.display_name);
        return name && name.length <= 500 ? [name] : [];
      }).slice(0, 100);
      const primary = record(data.primary_location);
      const source = record(primary?.source);
      const oa = record(data.open_access);
      const bestLocation = record(data.best_oa_location);
      const license = string(bestLocation?.license);
      const openAlexId = string(data.id)?.toLowerCase();
      return [{
        provider: this.name,
        doi,
        openAlexId,
        title,
        authors,
        abstractLicenseStatus: 'UNKNOWN',
        publicationYear: typeof data.publication_year === 'number' && data.publication_year >= 1000 && data.publication_year <= 9999 ? data.publication_year : undefined,
        journal: string(source?.display_name)?.slice(0, 500),
        sourceUrl: httpUrl(primary?.landing_page_url) ?? httpUrl(doiRaw),
        licenseUrl: license && /^https?:\/\//i.test(license) ? license : undefined,
        accessStatus: oa?.is_oa === true ? 'OPEN' : 'UNKNOWN',
        licenseStatus: mapLicenseStatus(license),
        providerMetadata: { openAlexId, oaStatus: string(oa?.oa_status) },
      }];
    });
  }
}
