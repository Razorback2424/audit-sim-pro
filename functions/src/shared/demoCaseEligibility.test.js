const assert = require('node:assert/strict');
const test = require('node:test');

const {
  evaluateDemoCaseEligibility,
  isCaseReadyForDemo,
} = require('./demoCaseEligibility');

test('deployed helper rejects draft cases', () => {
  assert.deepEqual(
    evaluateDemoCaseEligibility({ caseData: { status: 'draft' } }),
    { eligible: false, reason: 'case_draft' }
  );
});

test('deployed helper accepts ready cases with stored artifacts', () => {
  const caseData = {
    status: 'assigned',
    referenceDocuments: [{ storagePath: 'artifacts/app/reference.pdf' }],
    invoiceMappings: [{ storagePath: 'artifacts/app/invoice.pdf' }],
    cashArtifacts: [{ type: 'bank_statement', storagePath: 'artifacts/app/bank.pdf' }],
  };

  assert.equal(isCaseReadyForDemo(caseData), true);
  assert.deepEqual(evaluateDemoCaseEligibility({ caseData }), { eligible: true, reason: null });
});
