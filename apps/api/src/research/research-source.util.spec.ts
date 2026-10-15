import { describe, expect, it } from 'vitest';
import { deduplicateMetadata, normalizeDoi } from './research-source.util.js';

describe('research source identity', () => {
  it('normalizes DOI prefixes, URL forms, case, and trailing punctuation', () => {
    expect(normalizeDoi(' https://doi.org/10.1234/AbC. ')).toBe('10.1234/abc');
    expect(normalizeDoi('DOI: 10.1234/AbC')).toBe('10.1234/abc');
  });

  it('rejects malformed DOI and does not collapse different non-DOI works by title', () => {
    expect(() => normalizeDoi('not-a-doi')).toThrow('DOI format is invalid');
    const records = [
      { provider: 'crossref' as const, title: 'Same title', authors: [], abstractLicenseStatus: 'UNKNOWN' as const, accessStatus: 'UNKNOWN' as const, licenseStatus: 'UNKNOWN' as const, providerMetadata: {} },
      { provider: 'crossref' as const, title: 'Same title', authors: [], abstractLicenseStatus: 'UNKNOWN' as const, accessStatus: 'UNKNOWN' as const, licenseStatus: 'UNKNOWN' as const, providerMetadata: {} },
      { provider: 'openalex' as const, title: 'Same title', authors: [], abstractLicenseStatus: 'UNKNOWN' as const, openAlexId: 'W123', accessStatus: 'UNKNOWN' as const, licenseStatus: 'UNKNOWN' as const, providerMetadata: {} },
      { provider: 'crossref' as const, title: 'Another title', doi: '10.1234/ABC', authors: [], abstractLicenseStatus: 'UNKNOWN' as const, accessStatus: 'UNKNOWN' as const, licenseStatus: 'UNKNOWN' as const, providerMetadata: {} },
      { provider: 'openalex' as const, title: 'Renamed title', doi: 'https://doi.org/10.1234/abc', authors: [], abstractLicenseStatus: 'UNKNOWN' as const, accessStatus: 'OPEN' as const, licenseStatus: 'UNKNOWN' as const, providerMetadata: {} },
    ];
    expect(deduplicateMetadata(records)).toHaveLength(4);
  });
});
