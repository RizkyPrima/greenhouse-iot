import { validatePlantAiProposal, validateScientificEvidence, type PlantAiProposalContract, type ScientificEvidenceRecord } from './plant-proposal.contract.js';

function evidence(overrides: Partial<ScientificEvidenceRecord> = {}): ScientificEvidenceRecord {
  return {
    evidenceId: 'evidence-test-1', sourceId: 'source-test-1',
    title: { state: 'VALUE', value: 'Test-only source fixture' },
    authors: { state: 'UNKNOWN' }, publicationYear: { state: 'NOT_REPORTED' }, doi: { state: 'UNKNOWN' },
    canonicalUrl: { state: 'UNKNOWN' }, publisherOrJournal: { state: 'NOT_REPORTED' }, publicationType: { state: 'UNKNOWN' },
    retrievedAt: '2026-10-27T00:00:00.000Z', crop: { state: 'VALUE', value: 'tomato' }, cultivar: { state: 'UNKNOWN' },
    growthStage: { state: 'VALUE', value: 'vegetative' }, growingSystem: { state: 'VALUE', value: 'greenhouse substrate' },
    parameterKey: { state: 'VALUE', value: 'air_temperature' }, reportedValue: { state: 'VALUE', value: { minimum: 20, maximum: 25 } },
    unit: { state: 'VALUE', value: '°C' }, experimentalContext: { state: 'NOT_REPORTED' }, limitations: { state: 'UNKNOWN' },
    findingSummary: { state: 'VALUE', value: 'Fixture only; not a real scientific finding.' },
    extraction: { method: 'MANUAL', extractedAt: '2026-10-27T00:00:00.000Z', locator: 'test fixture' },
    quality: 'NOT_ASSESSED', verificationStatus: 'UNVERIFIED', ...overrides,
  };
}

function proposal(overrides: Partial<PlantAiProposalContract> = {}): PlantAiProposalContract {
  return {
    proposalId: 'proposal-test-1', organizationId: 'org-test-1', plantCatalogId: 'catalog-test-1',
    targetIntent: 'CREATE_DRAFT', cropIdentity: { scientificName: 'Solanum lycopersicum', commonName: 'tomato' },
    growingSystem: { state: 'VALUE', value: 'greenhouse substrate' }, environmentalAssumptions: [],
    parameterDefinitions: [{
      parameterKey: 'air_temperature', label: 'Air temperature', dataType: 'number', unit: '°C',
      valueSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'number' },
      recommendedOperatingRange: { minimum: 20, maximum: 25, unit: '°C' },
      applicability: { crop: { state: 'VALUE', value: 'tomato' }, cultivar: { state: 'UNKNOWN' }, growthStage: { state: 'VALUE', value: 'vegetative' }, growingSystem: { state: 'VALUE', value: 'greenhouse substrate' } },
      evidenceReferences: ['evidence-test-1'], uncertainty: { level: 'HIGH', explanation: 'Test fixture only' }, reviewStatus: 'SUPPORTED',
    }],
    profileDefaults: { air_temperature: 22 }, stageTemplates: [], edgeRequirements: {}, evidenceReferences: ['evidence-test-1'],
    validationFindings: [], unresolvedQuestions: [], createdAt: '2026-10-27T00:00:00.000Z', updatedAt: '2026-10-27T00:00:00.000Z', status: 'PROPOSED',
    ...overrides,
  };
}

describe('scientific evidence contract', () => {
  it('accepts records with partial metadata while retaining explicit unknown states', () => {
    expect(validateScientificEvidence(evidence()).valid).toBe(true);
  });

  it('requires provenance and does not treat source metadata as verified evidence', () => {
    const result = validateScientificEvidence(evidence({ sourceId: undefined, canonicalUrl: { state: 'NOT_REPORTED' }, extraction: { method: 'SOURCE_METADATA', extractedAt: '' } }));
    expect(result.status).toBe('INVALID');
    expect(result.findings.some(({ code }) => code === 'MISSING_EVIDENCE_REFERENCE')).toBe(true);
  });

  it('distinguishes unknown from unverified and flags missing numeric units for review', () => {
    const result = validateScientificEvidence(evidence({ verificationStatus: 'UNKNOWN', unit: { state: 'NOT_REPORTED' } }));
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.findings.map(({ code }) => code)).toContain('EVIDENCE_NOT_VERIFIED');
    expect(result.findings.map(({ code }) => code)).toContain('MISSING_UNIT');
  });

  it('rejects malformed values and reversed reported ranges', () => {
    const result = validateScientificEvidence(evidence({ reportedValue: { state: 'VALUE', value: { minimum: 30, maximum: 20 } } }));
    expect(result.status).toBe('INVALID');
    expect(result.findings.some(({ code }) => code === 'SCHEMA_INVALID')).toBe(true);
  });
});

describe('AI proposal contract validator', () => {
  it('accepts a structurally valid proposal but returns review readiness, not scientific verification', () => {
    const result = validatePlantAiProposal(proposal());
    expect(result.valid).toBe(true);
    expect(result.status).toBe('READY_FOR_REVIEW');
  });

  it('rejects duplicate keys, invalid schemas, and dangling evidence references', () => {
    const initial = proposal();
    const duplicate = { ...initial.parameterDefinitions[0], evidenceReferences: ['absent-evidence'], valueSchema: { type: 'number' } };
    const result = validatePlantAiProposal({ ...initial, parameterDefinitions: [...initial.parameterDefinitions, duplicate] });
    expect(result.status).toBe('INVALID');
    expect(result.findings.map(({ code }) => code)).toEqual(expect.arrayContaining(['DUPLICATE_PARAMETER_KEY', 'SCHEMA_INVALID', 'MISSING_EVIDENCE_REFERENCE']));
  });

  it('preserves conflict findings, unsupported claims, and human review as findings', () => {
    const result = validatePlantAiProposal({
      ...proposal({ unresolvedQuestions: ['Confirm cultivar.'], parameterDefinitions: [{
        ...proposal().parameterDefinitions[0], evidenceReferences: [], reviewStatus: 'NEEDS_REVIEW',
      }], evidenceReferences: ['evidence-test-1', 'evidence-test-2'] }),
      validationFindings: [{ code: 'CONFLICTING_EVIDENCE', severity: 'WARNING', field: 'air_temperature', explanation: 'Sources report different ranges.', evidenceReferences: ['evidence-test-1', 'evidence-test-2'] }],
    });
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.findings.map(({ code }) => code)).toEqual(expect.arrayContaining(['UNSUPPORTED_CLAIM', 'CONFLICTING_EVIDENCE', 'HUMAN_REVIEW_REQUIRED']));
  });

  it('keeps biological ranges and hardware safety limits explicit and rejects invalid ranges', () => {
    const parameter = { ...proposal().parameterDefinitions[0], hardwareSafetyLimit: { minimum: 21, maximum: 18, unit: '°C', basis: 'test' } };
    const result = validatePlantAiProposal(proposal({ parameterDefinitions: [parameter] }));
    expect(result.status).toBe('INVALID');
    expect(result.findings.some(({ code, field }) => code === 'INVALID_RANGE' && field.includes('hardwareSafetyLimit'))).toBe(true);
  });

  it('rejects malformed stage template items', () => {
    const result = validatePlantAiProposal(proposal({ stageTemplates: [null as never] }));
    expect(result.status).toBe('INVALID');
    expect(result.findings.some(({ field }) => field === 'stageTemplates/0')).toBe(true);
  });

  it('rejects malformed environmental assumptions', () => {
    const result = validatePlantAiProposal(proposal({ environmentalAssumptions: [{ key: 'room_temp', value: { degrees: 22 }, evidenceReferences: [] } as never] }));
    expect(result.status).toBe('INVALID');
    expect(result.findings.some(({ field }) => field === 'environmentalAssumptions/0')).toBe(true);
  });

  it('rejects non-JSON edge requirement subvalues', () => {
    const result = validatePlantAiProposal(proposal({ edgeRequirements: { controller: { interval: Number.POSITIVE_INFINITY } } }));
    expect(result.status).toBe('INVALID');
    expect(result.findings.some(({ field }) => field === 'edgeRequirements')).toBe(true);
  });

  it('rejects unknown finding code and severity values', () => {
    for (const invalidFinding of [
      { code: 'MADE_UP', severity: 'WARNING', field: 'x', explanation: 'x', evidenceReferences: [] },
      { code: 'EDGE_CAPABILITY_MISMATCH', severity: 'ALERT', field: 'x', explanation: 'x', evidenceReferences: [] },
    ]) {
      const result = validatePlantAiProposal(proposal({ validationFindings: [invalidFinding as never] }));
      expect(result.status).toBe('INVALID');
      expect(result.findings.some(({ field }) => field === 'validationFindings/0')).toBe(true);
    }
  });

  it('rejects findings that point to an undefined parameter', () => {
    const result = validatePlantAiProposal(proposal({ validationFindings: [{
      code: 'HUMAN_REVIEW_REQUIRED', severity: 'WARNING', field: 'parameterDefinitions/missing', parameterKey: 'missing',
      explanation: 'Review this parameter.', evidenceReferences: [],
    }] }));
    expect(result.status).toBe('INVALID');
    expect(result.findings.some(({ field }) => field === 'validationFindings/0/parameterKey')).toBe(true);
  });

  it('rejects numeric ranges on nonnumeric parameters', () => {
    const parameter = { ...proposal().parameterDefinitions[0], dataType: 'string', unit: 'text', valueSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'string' } };
    const result = validatePlantAiProposal(proposal({ parameterDefinitions: [parameter], profileDefaults: { air_temperature: 'warm' } }));
    expect(result.status).toBe('INVALID');
    expect(result.findings.some(({ code }) => code === 'INVALID_RANGE')).toBe(true);
  });

  it('rejects range units that differ from the parameter unit', () => {
    const parameter = { ...proposal().parameterDefinitions[0], recommendedOperatingRange: { minimum: 68, maximum: 77, unit: '°F' } };
    const result = validatePlantAiProposal(proposal({ parameterDefinitions: [parameter] }));
    expect(result.status).toBe('INVALID');
    expect(result.findings.some(({ code, field }) => code === 'MISSING_UNIT' && field.endsWith('/unit'))).toBe(true);
  });

  it('rejects operating ranges outside valueSchema bounds', () => {
    const parameter = { ...proposal().parameterDefinitions[0], valueSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'number', minimum: 21, maximum: 24 } };
    const result = validatePlantAiProposal(proposal({ parameterDefinitions: [parameter] }));
    expect(result.status).toBe('INVALID');
    expect(result.findings.some(({ code }) => code === 'INVALID_RANGE')).toBe(true);
  });

  it('respects both inclusive and exclusive numeric schema constraints', () => {
    const parameter = { ...proposal().parameterDefinitions[0], valueSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'number', minimum: 30, exclusiveMinimum: 10 } };
    const result = validatePlantAiProposal(proposal({ parameterDefinitions: [parameter] }));
    expect(result.status).toBe('INVALID');
    expect(result.findings.some(({ code }) => code === 'INVALID_RANGE')).toBe(true);
  });

  it('rejects profile defaults that violate parameter schemas', () => {
    const result = validatePlantAiProposal(proposal({ profileDefaults: { air_temperature: 'warm' } }));
    expect(result.status).toBe('INVALID');
    expect(result.findings.some(({ field, code }) => field === 'profileDefaults/stageTemplates' && code === 'SCHEMA_INVALID')).toBe(true);
  });

  it('rejects stage values that violate parameter schemas', () => {
    const result = validatePlantAiProposal(proposal({ stageTemplates: [{ code: 'vegetative', label: 'Vegetative', sequence: 1, config: { air_temperature: 'warm' } }] }));
    expect(result.status).toBe('INVALID');
    expect(result.findings.some(({ field }) => field === 'profileDefaults/stageTemplates')).toBe(true);
  });

  it('rejects configuration keys with no parameter definition', () => {
    const result = validatePlantAiProposal(proposal({ profileDefaults: { air_temperature: 22, undeclared: true } }));
    expect(result.status).toBe('INVALID');
  });

  it('flags biological ranges outside device safety limits for human review without changing either range', () => {
    const parameter = {
      ...proposal().parameterDefinitions[0],
      biologicalRecommendation: { summary: 'Biological range from evidence', range: { minimum: 20, maximum: 25, unit: '°C' } },
      hardwareSafetyLimit: { minimum: 21, maximum: 24, unit: '°C', basis: 'Controller rating' },
    };
    const result = validatePlantAiProposal(proposal({ parameterDefinitions: [parameter] }));
    expect(result.valid).toBe(true);
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.findings.some(({ code, severity }) => code === 'HUMAN_REVIEW_REQUIRED' && severity === 'WARNING')).toBe(true);
    expect(parameter.biologicalRecommendation.range).toEqual({ minimum: 20, maximum: 25, unit: '°C' });
  });
});
