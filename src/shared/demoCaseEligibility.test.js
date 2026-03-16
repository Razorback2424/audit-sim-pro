const { evaluateDemoCaseEligibility, isCaseReadyForDemo } = require('./demoCaseEligibility');

test('evaluateDemoCaseEligibility rejects draft cases', () => {
  expect(
    evaluateDemoCaseEligibility({
      caseData: {
        _deleted: false,
        status: 'draft',
        referenceDocuments: [],
        invoiceMappings: [],
        cashArtifacts: [],
      },
    })
  ).toEqual({ eligible: false, reason: 'case_draft' });
});

test('evaluateDemoCaseEligibility rejects future-dated cases', () => {
  expect(
    evaluateDemoCaseEligibility({
      caseData: {
        _deleted: false,
        status: 'assigned',
        opensAt: { seconds: 1_900_000_000, nanoseconds: 0 },
        referenceDocuments: [],
        invoiceMappings: [],
        cashArtifacts: [],
      },
      nowMs: 1_800_000_000 * 1000,
    })
  ).toEqual({ eligible: false, reason: 'case_not_open' });
});

test('evaluateDemoCaseEligibility rejects cases with pending generated documents', () => {
  expect(
    evaluateDemoCaseEligibility({
      caseData: {
        _deleted: false,
        status: 'assigned',
        referenceDocuments: [{ fileName: 'invoice.pdf', generationSpecId: 'spec-1' }],
        invoiceMappings: [],
        cashArtifacts: [],
      },
    })
  ).toEqual({ eligible: false, reason: 'case_not_ready' });
});

test('isCaseReadyForDemo rejects missing typed cash artifacts', () => {
  expect(
    isCaseReadyForDemo({
      cashArtifacts: [{ type: 'bank_statement', fileName: 'bank.pdf' }],
    })
  ).toBe(false);
});

test('evaluateDemoCaseEligibility accepts open ready cases', () => {
  expect(
    evaluateDemoCaseEligibility({
      caseData: {
        _deleted: false,
        status: 'assigned',
        referenceDocuments: [{ fileName: 'invoice.pdf', storagePath: 'artifacts/app/case/file.pdf' }],
        invoiceMappings: [{ paymentId: 'P-1', storagePath: 'artifacts/app/case/map.pdf' }],
        cashArtifacts: [{ type: 'bank_statement', fileName: 'bank.pdf', storagePath: 'artifacts/app/case/bank.pdf' }],
      },
    })
  ).toEqual({ eligible: true, reason: null });
});
