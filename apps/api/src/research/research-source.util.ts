export function normalizeDoi(value: string): string {
  let doi = value.trim();
  doi = doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi\s*:\s*/i, '');
  try { doi = decodeURIComponent(doi); } catch { /* Keep literal percent characters for validation below. */ }
  doi = doi.trim().replace(/[.,;]+$/, '').toLowerCase();
  if (!/^10\.\d{4,9}\/[^\s]+$/.test(doi)) throw new Error('DOI format is invalid');
  return doi;
}

export type MetadataRecord = {
  provider: 'crossref' | 'openalex';
  doi?: string;
  crossrefId?: string;
  openAlexId?: string;
  title: string;
  authors: string[];
  publicationYear?: number;
  journal?: string;
  publisher?: string;
  abstract?: string;
  abstractLicenseStatus: 'UNKNOWN' | 'OPEN_LICENSE' | 'RESTRICTED_LICENSE' | 'ALL_RIGHTS_RESERVED';
  sourceUrl?: string;
  licenseUrl?: string;
  accessStatus: 'UNKNOWN' | 'OPEN' | 'RESTRICTED' | 'CLOSED';
  licenseStatus: 'UNKNOWN' | 'OPEN_LICENSE' | 'RESTRICTED_LICENSE' | 'ALL_RIGHTS_RESERVED';
  providerMetadata: Record<string, unknown>;
};

export function deduplicateMetadata(records: MetadataRecord[]): MetadataRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = record.doi
      ? `doi:${normalizeDoi(record.doi)}`
      : record.openAlexId
        ? `openalex:${record.openAlexId.toLowerCase()}`
        : record.crossrefId
          ? `crossref:${record.crossrefId.toLowerCase()}`
          : null;
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
