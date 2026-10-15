import { afterEach, describe, expect, it, vi } from 'vitest';
import { CrossrefMetadataProvider, OpenAlexMetadataProvider } from './research-metadata.providers.js';

afterEach(() => vi.unstubAllGlobals());

describe('research metadata providers', () => {
  it('maps Crossref metadata and records a license only when provider evidence exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: { items: [{ DOI: '10.1234/ABC', title: ['A study'], author: [{ given: 'A', family: 'Researcher' }, { family: 'Writer' }], publisher: 'Journal Group', 'container-title': ['Plant Science'], published: { 'date-parts': [[2024, 2, 1]] }, license: [{ URL: 'https://creativecommons.org/licenses/by/4.0/' }], URL: 'https://doi.org/10.1234/ABC' }] },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const results = await new CrossrefMetadataProvider().search('plant water', 5);
    expect(results).toMatchObject([{ doi: '10.1234/abc', title: 'A study', authors: ['A Researcher', 'Writer'], publicationYear: 2024, licenseStatus: 'OPEN_LICENSE', accessStatus: 'UNKNOWN' }]);
  });

  it('maps OpenAlex metadata without inventing license when only open-access evidence exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [{
      id: 'https://openalex.org/W123', doi: 'https://doi.org/10.1234/abc', title: 'A study', publication_year: 2022,
      authorships: [{ author: { display_name: 'A Researcher' } }], primary_location: { source: { display_name: 'Journal' }, landing_page_url: 'https://example.org/paper' },
      open_access: { is_oa: true, oa_status: 'green' }, best_oa_location: { landing_page_url: 'https://example.org/open' },
    }] }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const results = await new OpenAlexMetadataProvider().search('plant water', 3);
    expect(results).toMatchObject([{ openAlexId: 'https://openalex.org/w123', accessStatus: 'OPEN', licenseStatus: 'UNKNOWN', publicationYear: 2022 }]);
  });

  it('rejects malformed provider payloads without returning unvalidated metadata', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"message":{}}', { status: 200 })));
    await expect(new CrossrefMetadataProvider().search('query', 2)).rejects.toThrow('Provider response invalid');
  });
});
